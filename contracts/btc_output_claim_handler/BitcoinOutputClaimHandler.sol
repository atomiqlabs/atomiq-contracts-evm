// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../common/IClaimHandler.sol";
import "../btc_relay/structs/StoredBlockHeader.sol";
import "../btc_relay/BtcRelay.sol";
import "../btc_utils/BitcoinMerkleTree.sol";
import "../btc_utils/BitcoinTx.sol";

//Claim handler for bitcoin chain, requiring a pre-specified output script with a pre-specified amount
// as one of the outputs of the transaction.

//txoHash = keccak256(uint64 outputAmount || keccak256(bytes outputScript))
//Commitment: C = abi.encodePacked(bytes32 txoHash, uint32 confirmations, address btcRelayContract)
//Witness: W = C || StoredBlockHeader blockheader || uint32 vout || bytes transaction || uint32 position || bytes32[] merkleProof
contract BitcoinOutputClaimHandler {
    
    using StoredBlockHeaderImpl for StoredBlockHeader;
    using BitcoinTxImpl for BitcoinTx;

    function claim(bytes32 claimData, bytes calldata witness) external view returns (bytes memory witnessResult) {
        require(witness.length >= 288, "btcoutlock: witness length");

        //Commitment
        bytes32 expectedTxoHash; //32-bytes
        uint32 confirmations; //4-bytes
        address btcRelayContract; //20-bytes

        bytes32 commitmentHash;
        assembly ("memory-safe") {
            expectedTxoHash := calldataload(witness.offset)
            let confirmationsAndBtcRelayContract := calldataload(add(witness.offset, 24))
            confirmations := and(shr(160 ,confirmationsAndBtcRelayContract), 0xffffffff)
            btcRelayContract := and(confirmationsAndBtcRelayContract, 0xffffffffffffffffffffffffffffffffffffffff)

            calldatacopy(0, witness.offset, 56)
            commitmentHash := keccak256(0, 56)
        }
        //Verify claim data commitment
        require(commitmentHash==claimData, "btcoutlock: invalid commitment");

        //Witness
        StoredBlockHeader memory blockheader = StoredBlockHeaderImpl.fromCalldata(witness, 56); //160-bytes
        uint32 vout; //4-bytes
        bytes memory rawTransaction;
        uint32 position; //4-bytes
        bytes32[] calldata proof;
        assembly ("memory-safe") {
            let calldataPtr := add(witness.offset, 188)
            vout := and(calldataload(calldataPtr), 0xffffffff)
            calldataPtr := add(calldataPtr, 32)

            let transactionLength := calldataload(calldataPtr)
            let totalCopyLength := add(transactionLength, 32)
            rawTransaction := mload(0x40) //Free memory pointer
            mstore(0x40, add(rawTransaction, totalCopyLength))
            calldatacopy(rawTransaction, calldataPtr, totalCopyLength)

            calldataPtr := add(calldataPtr, totalCopyLength)

            position := and(calldataload(sub(calldataPtr, 28)), 0xffffffff)
            calldataPtr := add(calldataPtr, 4)
            proof.length := calldataload(calldataPtr)
            calldataPtr := add(calldataPtr, 32)
            proof.offset := calldataPtr
        }

        //Parse transaction
        BitcoinTx memory transaction = BitcoinTxImpl.fromMemory(rawTransaction);
        //Check output is valid
        uint64 outputValue = transaction.getOutputValue(vout);
        bytes32 scriptHash = transaction.getOutputScriptHash(vout);

        bytes32 txoHash;
        assembly {
            mstore(0x00, outputValue)
            mstore(0x20, scriptHash)
            txoHash := keccak256(24, 40)
        }
        require(expectedTxoHash==txoHash, "btcoutlock: Invalid output");

        //Verify blockheader against the light client
        uint256 blockConfirmations = IBtcRelayView(btcRelayContract).verifyBlockheaderHash(blockheader.blockHeight(), blockheader.hash());
        require(blockConfirmations >= confirmations, "btcoutlock: confirmations");

        //Verify merkle proof
        bytes32 txHash = transaction.getHash();
        BitcoinMerkleTree.verify(blockheader.header_merkleRoot(), txHash, proof, position);

        assembly ("memory-safe") {
            witnessResult := mload(0x40) //Free memory pointer
            mstore(0x40, add(witnessResult, 64)) //Allocate 64 bytes of memory
            mstore(witnessResult, 32)
            mstore(add(witnessResult, 32), txHash)
        }
    }

}
