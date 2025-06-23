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

contract SpvVaultManager is ISpvVaultManager, ISpvVaultManagerView {

    using SpvVaultParametersImpl for SpvVaultParameters;
    using SpvVaultStateImpl for SpvVaultState;
    using BitcoinVaultTransactionDataImpl for BitcoinVaultTransactionData;

    using StoredBlockHeaderImpl for StoredBlockHeader;
    using BitcoinTxImpl for BitcoinTx;
    using MathUtils for uint64;

    ExecutionContract immutable _executionContract;
    mapping(address => mapping(uint96 => SpvVaultState)) _vaults;
    mapping(address => mapping(uint96 => mapping(bytes32 => address))) _liquidityFronts;

    constructor(ExecutionContract executionContract) {
        _executionContract = executionContract;
    }

    //Returns the current LP vault state
    function getVault(address owner, uint96 vaultId) view external returns (SpvVaultState memory vault) {
        vault = _vaults[owner][vaultId];
    }

    //Returns the address of the fronter for a specific btc tx (if any)
    function getFronterAddress(address owner, uint96 vaultId, bytes32 btcTxHash, BitcoinVaultTransactionData memory data) view external returns (address fronter) {
        fronter = _liquidityFronts[owner][vaultId][data.hash(btcTxHash)];
    }

    //Returns the address of the fronter for a fronting id (if any)
    function getFronterById(address owner, uint96 vaultId, bytes32 frontingId) view external returns (address fronter) {
        fronter = _liquidityFronts[owner][vaultId][frontingId];
    }
    
    //Utility sanity call to check if the given bitcoin transaction is parsable
    function parseBitcoinTx(bytes memory transaction) pure external returns (BitcoinVaultTransactionData memory data) {
        bool success;
        string memory err;
        (success, data, err) = BitcoinVaultTransactionDataImpl.fromTx(BitcoinTxImpl.fromMemory(transaction));
        require(success, err);
    }

    function open(uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 utxoTxHash, uint32 utxoVout) external {
        SpvVaultState storage vault = _vaults[msg.sender][vaultId];

        //Check vault is not opened
        require(!vault.isOpened(), "open: already opened");

        //Initialize new vault
        vault.open(vaultParams, utxoTxHash, utxoVout);

        //Emit event
        emit Events.Opened(msg.sender, vaultId, utxoTxHash, utxoVout, vaultParams);
    }

    function deposit(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint64 rawToken0, uint64 rawToken1) external payable {
        SpvVaultState storage vault = _vaults[owner][vaultId];
        //Check vault is opened & valid params supplied
        vault.checkOpenedAndParams(vaultParams);

        //Update the state with newly deposited tokens
        (uint256 amount0, uint256 amount1) = vaultParams.fromRaw(rawToken0, rawToken1);
        uint32 depositCount = vault.deposit(rawToken0, rawToken1);

        //Transfer tokens in
        _transferIn(vaultParams.token0, amount0, vaultParams.token1, amount1);

        //Emit event
        emit Events.Deposited(Utils.packAddressAndVaultId(owner, vaultId), depositCount, rawToken0, rawToken1);
    }
    
    //Fronts the liquidity for a specific bitcoin transaction
    function front(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint32 withdrawalSequence, bytes32 btcTxHash, BitcoinVaultTransactionData memory data) external payable {
        SpvVaultState storage vault = _vaults[owner][vaultId];
        //Check vault is opened & valid params supplied
        vault.checkOpenedAndParams(vaultParams);
        
        //This is to make sure that the caller doesn't front an already processed
        // withdraw, this would essentially make him loose funds
        require(vault.withdrawCount <= withdrawalSequence, "front: already processed");

        bytes32 frontingId = data.hash(btcTxHash);
        
        //Check if this was already fronted
        require(_liquidityFronts[owner][vaultId][frontingId] == address(0x0), "front: already fronted");

        //Mark as fronted
        _liquidityFronts[owner][vaultId][frontingId] = msg.sender;

        uint64 rawAmount0 = data.amount0 + data.executionHandlerFeeAmount0;
        uint64 rawAmount1 = data.amount1;

        //Transfer funds from caller to contract
        (uint256 amount0, uint256 amount1) = vaultParams.fromRaw(rawAmount0, rawAmount1);
        _transferIn(vaultParams.token0, amount0, vaultParams.token1, amount1);

        //Transfer funds
        if(data.executionHash == bytes32(0x0)) {
            //Pass funds straight to recipient
            _transferOut(data.recipient, vaultParams.token0, amount0, vaultParams.token1, amount1);
        } else {
            //Amount1 of token1 goes directly to the recipient
            if(amount1 > 0) TransferUtils.transferOut(vaultParams.token1, data.recipient, amount1);
            //Rest is transfered to execution contract
            _toExecutionContract(vaultParams, data, btcTxHash);
        }

        //Emit event
        emit Events.Fronted(Utils.packAddressAndVaultId(owner, vaultId), data.recipient, btcTxHash, data.executionHash, data.amount0, data.amount1);
    }
    
    //Claim funds from the vault, given a proper bitcoin transaction as verified through the relay contract
    function claim(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes memory transaction, StoredBlockHeader memory blockheader, bytes32[] calldata merkleProof, uint256 position) external {
        SpvVaultState storage vault = _vaults[owner][vaultId];
        //Check vault is opened & valid params supplied
        vault.checkOpenedAndParams(vaultParams);

        //Bitcoin transaction parsing and checks
        //Parse transaction
        BitcoinTx memory btcTx = BitcoinTxImpl.fromMemory(transaction);

        //Make sure the transaction properly spends last vault UTXO
        (bytes32 utxoTxHash, uint32 utxoVout) = btcTx.getInputUtxo(0);
        require(utxoTxHash == vault.utxoTxHash && utxoVout == vault.utxoVout, "claim: incorrect in_0 utxo");

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
        (bool successParse, BitcoinVaultTransactionData memory txData, string memory errParse) = BitcoinVaultTransactionDataImpl.fromTx(btcTx);
        if(!successParse) {
            _close(owner, vaultId, vaultParams, btcTxHash, errParse);
            return;
        }

        //This also makes sure that the sum of all the amounts + fees, is in the bounds of 64-bit integer, hence we can
        // use unchecked arithmetics when working with (summing) the amount & fees from now on
        (bool successAmounts, uint64 amount0Raw, uint64 amount1Raw) = txData.getFullAmounts();
        if(!successAmounts) {
            _close(owner, vaultId, vaultParams, btcTxHash, "claim: full amounts");
            return;
        }

        (bool successWithdraw, uint32 withdrawCount, string memory errWithdraw) = vault.withdraw(btcTxHash, 0, amount0Raw, amount1Raw);
        if(!successWithdraw) {
            _close(owner, vaultId, vaultParams, btcTxHash, errWithdraw);
            return;
        }

        //Check if this was already fronted
        address recipient = txData.recipient;
        bytes32 frontingId = txData.hash(btcTxHash);
        address frontingAddress = _liquidityFronts[owner][vaultId][frontingId];
        if(frontingAddress != address(0x0)) {
            //Transfer funds to caller
            (uint256 callerAmount0, uint256 callerAmount1) = vaultParams.fromRaw(txData.callerFee0, txData.callerFee1);
            _transferOut(msg.sender, vaultParams.token0, callerAmount0, vaultParams.token1, callerAmount1);

            //Transfer funds to the account that fronted

            //We can use uncheckedAddUint64, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
            (uint256 frontingAmount0, uint256 frontingAmount1) = vaultParams.fromRaw(
                txData.amount0.uncheckedAddUint64(txData.frontingFee0).uncheckedAddUint64(txData.executionHandlerFeeAmount0),
                txData.amount1.uncheckedAddUint64(txData.frontingFee1)
            );
            
            //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
            // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
            // currency deposits at all. We silently ignore this error if it happens.
            _transferOutNoRevert(frontingAddress, vaultParams.token0, frontingAmount0, vaultParams.token1, frontingAmount1);
        } else {
            //Transfer caller fee + fronting fee to caller
            //NOTE: The reason we are also sending fronting fee to the caller here is that even if we wouldn't an
            // economically rational caller would just do a multical with front() & claim() in a single transaction
            // essentially claiming both fees anyway, we therefore align this functionality with the economically
            // rational behaviour of the caller

            //We can use uncheckedAddUint64, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
            (uint256 callerAmount0, uint256 callerAmount1) = vaultParams.fromRaw(
                txData.frontingFee0.uncheckedAddUint64(txData.callerFee0),
                txData.frontingFee1.uncheckedAddUint64(txData.callerFee1)
            );
            _transferOut(msg.sender, vaultParams.token0, callerAmount0, vaultParams.token1, callerAmount1);

            if(txData.executionHash == bytes32(0x0)) {
                //We can use uncheckedAddUint64, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                (uint256 payoutAmount0, uint256 payoutAmount1) = vaultParams.fromRaw(
                    txData.amount0.uncheckedAddUint64(txData.executionHandlerFeeAmount0), 
                    txData.amount1
                );
                
                //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
                // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
                // currency deposits at all. We silently ignore this error if it happens.
                _transferOutNoRevert(recipient, vaultParams.token0, payoutAmount0, vaultParams.token1, payoutAmount1);
            } else {
                if(txData.amount1 > 0) {
                    //Pay out the gas token straight to recipient
                    uint256 payoutAmount1 = vaultParams.fromRawToken1(txData.amount1);
                    
                    //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
                    // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
                    // currency deposits at all. We silently ignore this error if it happens.
                    TransferUtils.transferOutNoRevert(vaultParams.token1, recipient, payoutAmount1);
                }

                //Rest is transfered to execution contract
                _toExecutionContract(vaultParams, txData, btcTxHash);
            }
        }

        //Emit event
        emit Events.Claimed(Utils.packAddressAndVaultId(owner, vaultId), recipient, btcTxHash, txData.executionHash, frontingAddress, withdrawCount, amount0Raw, amount1Raw);
    }

    //Internal functions
    function _close(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 btcTxHash, string memory err) internal {
        SpvVaultState storage vault = _vaults[owner][vaultId];
        vault.close();

        //Calculate amounts left in the vault
        (uint256 amount0, uint256 amount1) = vaultParams.fromRaw(vault.token0Amount, vault.token1Amount);

        //Payout funds back to owner
        _transferOut(owner, vaultParams.token0, amount0, vaultParams.token1, amount1);

        emit Events.Closed(owner, vaultId, btcTxHash, bytes(err));
    }

    function _transferIn(address token0, uint256 amount0, address token1, uint256 amount1) internal {
        if(token0==token1) {
            //Transfer in one go, due to TransferUtils limitation when receiving native token
            TransferUtils.transferIn(token0, msg.sender, amount0 + amount1);
        } else {
            if(amount0 > 0) TransferUtils.transferIn(token0, msg.sender, amount0);
            if(amount1 > 0) TransferUtils.transferIn(token1, msg.sender, amount1);
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

    function _transferOutNoRevert(address recipient, address token0, uint256 amount0, address token1, uint256 amount1) internal returns (bool success) {
        if(token0==token1) {
            success = TransferUtils.transferOutNoRevert(token0, recipient, amount0 + amount1);
        } else {
            bool success0 = true;
            if(amount0 > 0) success0 = TransferUtils.transferOutNoRevert(token0, recipient, amount0);
            bool success1 = true;
            if(amount1 > 0) success1 = TransferUtils.transferOutNoRevert(token1, recipient, amount1);
            success = success0 && success1;
        }
    }

    function _toExecutionContract(SpvVaultParameters calldata vaultParams, BitcoinVaultTransactionData memory data, bytes32 btcTxHash) internal {
        uint256 amount0 = vaultParams.fromRawToken0(data.amount0);
        uint256 executionHandlerFee = vaultParams.fromRawToken0(data.executionHandlerFeeAmount0);
        
        Execution memory execution = Execution({
            token: vaultParams.token0,
            executionActionHash: data.executionHash,
            amount: amount0,
            executionFee: executionHandlerFee,
            expiry: data.executionExpiry
        });
        if(vaultParams.token0 == address(0x0)) {
            _executionContract.create{value: amount0 + executionHandlerFee}(data.recipient, btcTxHash, execution);
        } else {
            TransferUtils.approve(vaultParams.token0, address(_executionContract), amount0 + executionHandlerFee);
            _executionContract.create(data.recipient, btcTxHash, execution);
        }
    }

}

