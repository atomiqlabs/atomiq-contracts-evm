// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./state/SpvVaultState.sol";
import "./structs/SpvVaultParameters.sol";
import "./structs/BitcoinVaultTransactionData.sol";
import "./Events.sol";
import "./Utils.sol";

import "../btc_utils/BitcoinTx.sol";
import "../btc_utils/BitcoinMerkleTree.sol";

import {StoredBlockHeader, StoredBlockHeaderImpl} from "../btc_relay/structs/StoredBlockHeader.sol";
import {IBtcRelayView} from "../btc_relay/BtcRelay.sol";

import "../transfer_utils/TransferUtils.sol";

import "../execution_contract/structs/Execution.sol";
import {ExecutionContract} from "../execution_contract/ExecutionContract.sol";


interface ISpvVaultManager {
    //Creates the vault and initiates it with the first UTXO in the chain
    function open(uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 utxoTxHash, uint32 utxoVout) external;
    //Deposits funds into the specific vault
    function deposit(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint64 rawToken0, uint64 rawToken1) external payable;
    //Fronts the liquidity for a specific bitcoin transaction
    function front(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint32 withdrawalSequence, bytes32 btcTxHash, BitcoinVaultTransactionData memory data) external payable;
    //Claim funds from the vault, given a proper bitcoin transaction as verified through the relay contract
    function claim(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes calldata transaction, StoredBlockHeader calldata blockheader, bytes32[] calldata merkleProof, uint256 position) external;
}

interface ISpvVaultManagerView {
    //Returns the current LP vault state
    function getVault(address owner, uint96 vaultId) view external returns (SpvVaultState memory vault);
    //Returns the address of the fronter for a specific btc tx (if any)
    function getFronterAddress(address owner, uint96 vaultId, bytes32 btcTxHash, BitcoinVaultTransactionData memory data) view external returns (address fronter);
    //Returns the address of the fronter for a fronting id (if any)
    function getFronterById(address owner, uint96 vaultId, bytes32 frontingId) view external returns (address fronter);
    //Utility sanity call to check if the given bitcoin transaction is parsable
    function parseBitcoinTx(bytes calldata transaction) pure external returns (BitcoinVaultTransactionData memory vault);
}

contract SpvVaultManager {

    using SpvVaultParametersImpl for SpvVaultParameters;
    using SpvVaultStateImpl for SpvVaultState;
    using BitcoinVaultTransactionDataImpl for BitcoinVaultTransactionData;

    using StoredBlockHeaderImpl for StoredBlockHeader;
    using BitcoinTxImpl for BitcoinTx;

    ExecutionContract immutable executionContract;
    mapping(address => mapping(uint96 => SpvVaultState)) vaults;
    mapping(address => mapping(uint96 => mapping(bytes32 => address))) liquidityFronts;

    function open(uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 utxoTxHash, uint32 utxoVout) external {
        require(utxoTxHash != bytes32(0x00), "open: utxo is zero");

        //Check vault is not opened
        require(vaults[msg.sender][vaultId].utxoTxHash == bytes32(0x00), "open: already opened");

        //Initialize new vault
        vaults[msg.sender][vaultId].spvVaultParametersCommitment = vaultParams.hash();
        vaults[msg.sender][vaultId].utxoTxHash = utxoTxHash;
        vaults[msg.sender][vaultId].utxoVout = utxoVout;
        vaults[msg.sender][vaultId].openBlockheight = uint32(block.number);
        vaults[msg.sender][vaultId].withdrawCount = 0;
        vaults[msg.sender][vaultId].depositCount = 0;
        vaults[msg.sender][vaultId].token0Amount = 0;
        vaults[msg.sender][vaultId].token1Amount = 0;

        //Emit event
        emit Events.Opened(msg.sender, vaultId, utxoTxHash, utxoVout, vaultParams);
    }

    function deposit(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint64 rawToken0, uint64 rawToken1) external payable {
        //Check vault is opened
        require(vaults[owner][vaultId].utxoTxHash != bytes32(0x00), "deposit: vault closed");

        //Check valid params supplied
        require(vaults[owner][vaultId].spvVaultParametersCommitment == vaultParams.hash(), "deposit: invalid params");

        //Update the state with newly deposited tokens
        (bool success, uint256 amount0, uint256 amount1) = vaultParams.fromRaw(rawToken0, rawToken1);
        require(success, "deposit: amounts overflow");
        uint256 depositCount = vaults[owner][vaultId].deposit(rawToken0, rawToken1);

        //Transfer tokens in
        _transferIn(vaultParams.token0, amount0, vaultParams.token1, amount1);

        //Emit event
        emit Events.Deposited(Utils.packAddressAndVaultId(owner, vaultId), depositCount, rawToken0, rawToken1);
    }
    
    //Fronts the liquidity for a specific bitcoin transaction
    function front(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint32 withdrawalSequence, bytes32 btcTxHash, BitcoinVaultTransactionData memory data) external payable {
        //Check vault is opened
        require(vaults[owner][vaultId].utxoTxHash != bytes32(0x00), "front: vault closed");

        //Check valid params supplied
        require(vaults[owner][vaultId].spvVaultParametersCommitment == vaultParams.hash(), "front: invalid params");
        
        //This is to make sure that the caller doesn't front an already processed
        // withdraw, this would essentially make him loose funds
        require(vaults[owner][vaultId].withdrawCount <= withdrawalSequence, "front: already processed");

        bytes32 frontingId = data.hash(btcTxHash);
        
        //Check if this was already fronted
        require(liquidityFronts[owner][vaultId][frontingId] == address(0x0), "front: already fronted");

        //Mark as fronted
        liquidityFronts[owner][vaultId][frontingId] = msg.sender;

        uint256 rawAmount0 = data.amount[0] + data.executionHandlerFeeAmount0;
        uint256 rawAmount1 = data.amount[1];

        //Transfer funds from caller to contract
        (bool success, uint256 amount0, uint256 amount1) = vaultParams.fromRaw(rawAmount0, rawAmount1);
        require(success, "front: amounts overflow");
        _transferIn(vaultParams.token0, amount0, vaultParams.token1, amount1);

        //Transfer funds
        if(data.executionHash == bytes32(0x0)) {
            //Pass funds straight to recipient
            _transferOut(data.recipient, vaultParams.token0, amount0, vaultParams.token1, amount1);
        } else {
            //Amount1 of token1 goes directly to the recipient
            if(amount1 > 0) TransferUtils.transferOut(vaultParams.token1, data.recipient, amount1);
            //Rest is transfered to execution contract
            require(_toExecutionContract(vaultParams, data, btcTxHash), "front: exec deposit fail");
        }

        //Emit event
        emit Events.Fronted(Utils.packAddressAndVaultId(owner, vaultId), data.recipient, btcTxHash, data.executionHash, data.amount[0], data.amount[1]);
    }
    
    //Claim funds from the vault, given a proper bitcoin transaction as verified through the relay contract
    function claim(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes memory transaction, StoredBlockHeader memory blockheader, bytes32[] calldata merkleProof, uint256 position) external {
        //Check vault is opened
        bytes32 vaultUtxoTxHash = vaults[owner][vaultId].utxoTxHash;
        require(vaultUtxoTxHash != bytes32(0x00), "claim: vault closed");

        //Check valid params supplied
        require(vaults[owner][vaultId].spvVaultParametersCommitment == vaultParams.hash(), "claim: invalid params");

        //Bitcoin transaction parsing and checks
        //Parse transaction
        BitcoinTx memory btcTx = BitcoinTxImpl.fromMemory(transaction);

        //Make sure the transaction properly spends last vault UTXO
        (bytes32 utxoTxHash, uint32 utxoVout) = btcTx.getInputUtxo(0);

        //Verify blockheader against the light client
        uint256 confirmations = IBtcRelayView(vaultParams.btcRelayContract).verifyBlockheaderHash(blockheader.blockHeight(), blockheader.hash());
        require(confirmations >= vaultParams.confirmations, "claim: confirmations");

        bytes32 btcTxHash = btcTx.getHash();

        //Verify merkle proof
        BitcoinMerkleTree.verify(blockheader.header_merkleRoot(), btcTxHash, merkleProof, position);
        
        //IMPORTANT NOTE: It is very important that the following part has no way of reverting, since if this will revert
        // there is no way for LP to recover his funds, as he cannot just create an alternate transaction on BTC since the
        // previous vault UTXO is already spent and the transaction that should be used to withdraw funds was malformed, etc.
        // therefore we make sure that in case any error occurs we gracefully return all the funds to owner and close the
        // vault.

        //Make sure we send the funds to owner in the case when there is some issue with the transaction parsing or withdrawal,
        // such that funds don't get frozen
        //NOTE: Also verifies that full amounts are in bounds of u256 integer, such that we can use
        // .unwrap() on all .from_raw() calculations
        (bool success, BitcoinVaultTransactionData memory txData, string memory err) = BitcoinVaultTransactionDataImpl.fromTx(btcTx);
        if(!success) {
            _close(owner, vaultId, vaultParams, btcTxHash, err);
            return;
        }

    }

    //Internal functions
    function _close(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 btcTxHash, string memory err) internal {
        vaults[owner][vaultId].close();

        //Calculate amounts left in the vault
        (bool success, uint256 amount0, uint256 amount1) = vaultParams.fromRaw(vaults[owner][vaultId].token0Amount, vaults[owner][vaultId].token1Amount);
        require(success, "_close: amounts overflow");

        //Payout funds back to owner
        _transferOut(owner, vaultParams.token0, amount0, vaultParams.token1, amount1);

        emit Events.Closed(owner, vaultId, btcTxHash, bytes(err));
    }

    function _transferIn(address token0, uint256 amount0, address token1, uint256 amount1) internal {
        if(token0==token1) {
            //Transfer in one go, due to TransferUtils limitation when receiving native token
            TransferUtils.transferIn(msg.sender, token0, amount0 + amount1);
        } else {
            if(amount0 > 0) TransferUtils.transferIn(msg.sender, token0, amount0);
            if(amount1 > 0) TransferUtils.transferIn(msg.sender, token1, amount1);
        }
    }

    function _transferOut(address recipient, address token0, uint256 amount0, address token1, uint256 amount1) internal {
        if(token0==token1) {
            TransferUtils.transferOut(token0, recipient, amount0 + amount1);
        } else {
            if(amount0 > 0) TransferUtils.transferOut(token0, recipient, amount0);
            if(amount1 > 0) TransferUtils.transferOut(token1, recipient, amount1);
        }
    }

    function _toExecutionContract(SpvVaultParameters calldata vaultParams, BitcoinVaultTransactionData memory data, bytes32 btcTxHash) internal returns (bool success) {
        (bool success0, uint256 amount0) = vaultParams.fromRawToken0(data.amount[0]);
        (bool success1, uint256 executionHandlerFee) = vaultParams.fromRawToken0(data.executionHandlerFeeAmount0);
        if(!(success0 && success1)) return false;

        Execution memory execution = Execution({
            token: vaultParams.token0,
            executionActionHash: data.executionHash,
            amount: amount0,
            executionFee: executionHandlerFee,
            expiry: data.executionExpiry
        });
        if(vaultParams.token0 == address(0x0)) {
            executionContract.create{value: amount0 + executionHandlerFee}(data.recipient, btcTxHash, execution);
        } else {
            TransferUtils.approve(vaultParams.token0, address(executionContract), amount0 + executionHandlerFee);
            executionContract.create(data.recipient, btcTxHash, execution);
        }

        success = true;
    }

}

