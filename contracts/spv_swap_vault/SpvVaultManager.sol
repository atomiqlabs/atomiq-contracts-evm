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
        SpvVaultState storage vault = vaults[msg.sender][vaultId];

        //Check vault is not opened
        require(!vault.isOpened(), "open: already opened");

        //Initialize new vault
        vault.open(vaultParams, utxoTxHash, utxoVout);

        //Emit event
        emit Events.Opened(msg.sender, vaultId, utxoTxHash, utxoVout, vaultParams);
    }

    function deposit(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, uint64 rawToken0, uint64 rawToken1) external payable {
        SpvVaultState storage vault = vaults[owner][vaultId];
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
        SpvVaultState storage vault = vaults[owner][vaultId];
        //Check vault is opened & valid params supplied
        vault.checkOpenedAndParams(vaultParams);
        
        //This is to make sure that the caller doesn't front an already processed
        // withdraw, this would essentially make him loose funds
        require(vault.withdrawCount <= withdrawalSequence, "front: already processed");

        bytes32 frontingId = data.hash(btcTxHash);
        
        //Check if this was already fronted
        require(liquidityFronts[owner][vaultId][frontingId] == address(0x0), "front: already fronted");

        //Mark as fronted
        liquidityFronts[owner][vaultId][frontingId] = msg.sender;

        (bool rawAmount0Success, uint64 rawAmount0) = MathUtils.castToUint64(data.amount0 + data.executionHandlerFeeAmount0);
        require(rawAmount0Success, "front: amount0 overflow");
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
        SpvVaultState storage vault = vaults[owner][vaultId];
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
        // use unsafe arithmetics when working with the amount & fees from now on
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

        //Transfer funds to caller
        (uint256 callerFeeToken0, uint256 callerFeeToken1) = vaultParams.fromRaw(txData.callerFee0, txData.callerFee1);
        _transferOut(msg.sender, vaultParams.token0, callerFeeToken0, vaultParams.token1, callerFeeToken1);

        //Check if this was already fronted
        address recipient = txData.recipient;
        bytes32 frontingId = txData.hash(btcTxHash);
        address frontingAddress = liquidityFronts[owner][vaultId][frontingId];
        if(frontingAddress != address(0x0)) {
            //Transfer funds to the account that fronted
            unchecked { //Unchecked arithmetics is fine, because we are summing 64-bit values using 256-bit arithmetics
                (,uint64 frontingAmount0Raw) = MathUtils.castToUint64(
                    uint256(txData.amount0) + uint256(txData.frontingFee0) + uint256(txData.executionHandlerFeeAmount0)
                ); //We can ignore the success flag, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                
                (,uint64 frontingAmount1Raw) = MathUtils.castToUint64(
                    uint256(txData.amount1) + uint256(txData.frontingFee1)
                ); //We can ignore the success flag, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                
                (uint256 frontingAmount0, uint256 frontingAmount1) = vaultParams.fromRaw(frontingAmount0Raw, frontingAmount1Raw);
                
                //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
                // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
                // currency deposits at all. We silently ignore this error if it happens.
                _transferOutNoRevert(frontingAddress, vaultParams.token0, frontingAmount0, vaultParams.token1, frontingAmount1);
            }
        } else {
            if(txData.executionHash == bytes32(0x0)) {
                unchecked { //Unchecked arithmetics is fine, because we are summing 64-bit values using 256-bit arithmetics
                    (,uint64 payoutAmount0Raw) = MathUtils.castToUint64(
                        uint256(txData.amount0) + uint256(txData.frontingFee0) + uint256(txData.executionHandlerFeeAmount0)
                    ); //We can ignore the success flag, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                    
                    (,uint64 payoutAmount1Raw) = MathUtils.castToUint64(
                        uint256(txData.amount1) + uint256(txData.frontingFee1)
                    ); //We can ignore the success flag, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                    
                    (uint256 payoutAmount0, uint256 payoutAmount1) = vaultParams.fromRaw(payoutAmount0Raw, payoutAmount1Raw);
                    
                    //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
                    // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
                    // currency deposits at all. We silently ignore this error if it happens.
                    _transferOutNoRevert(recipient, vaultParams.token0, payoutAmount0, vaultParams.token1, payoutAmount1);
                }
            } else {
                unchecked { //Unchecked arithmetics is fine, because we are summing 64-bit values using 256-bit arithmetics
                    //Pay out the gas token & fronting fee (in both, token0 and token1) straight to recipient
                    (,uint64 payoutAmount1Raw) = MathUtils.castToUint64(
                        uint256(txData.amount1) + uint256(txData.frontingFee1)
                    ); //We can ignore the success flag, since all sums will surely be in the uint64 range, because of the prior txData.getFullAmounts() call
                    (uint256 payoutAmount0, uint256 payoutAmount1) = vaultParams.fromRaw(txData.frontingFee0, payoutAmount1Raw);
                    
                    //Use non-reverting transfer function, since we also support paying out native currency (ETH), the transfer out can
                    // fail if the destination is a malicious contract that e.g. runs out of gas when called, or doesn't allow native
                    // currency deposits at all. We silently ignore this error if it happens.
                    _transferOutNoRevert(recipient, vaultParams.token0, payoutAmount0, vaultParams.token1, payoutAmount1);

                    //Rest is transfered to execution contract
                    _toExecutionContract(vaultParams, txData, btcTxHash);
                }
            }
        }

        //Emit event
        emit Events.Claimed(Utils.packAddressAndVaultId(owner, vaultId), recipient, btcTxHash, txData.executionHash, frontingAddress, withdrawCount, amount0Raw, amount1Raw);
    }

    //Internal functions
    function _close(address owner, uint96 vaultId, SpvVaultParameters calldata vaultParams, bytes32 btcTxHash, string memory err) internal {
        vaults[owner][vaultId].close();

        //Calculate amounts left in the vault
        (uint256 amount0, uint256 amount1) = vaultParams.fromRaw(vaults[owner][vaultId].token0Amount, vaults[owner][vaultId].token1Amount);

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
            executionContract.create{value: amount0 + executionHandlerFee}(data.recipient, btcTxHash, execution);
        } else {
            TransferUtils.approve(vaultParams.token0, address(executionContract), amount0 + executionHandlerFee);
            executionContract.create(data.recipient, btcTxHash, execution);
        }
    }

}

