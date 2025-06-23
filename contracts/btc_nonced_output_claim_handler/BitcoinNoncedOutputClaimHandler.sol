// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IClaimHandler} from "../common/IClaimHandler.sol";
import {StoredBlockHeader, StoredBlockHeaderImpl} from "../btc_relay/structs/StoredBlockHeader.sol";
import {IBtcRelayView} from "../btc_relay/BtcRelay.sol";
import {BitcoinMerkleTree} from "../btc_utils/BitcoinMerkleTree.sol";
import {BitcoinTx, BitcoinTxImpl} from "../btc_utils/BitcoinTx.sol";

//Claim handler for bitcoin chain, requiring a pre-specified output script with a pre-specified amount
// as one of the outputs of the transaction. The transaction also needs to be marked with a specific nonce
// a nonce in this context is derived from the the transaction's timelock & input 0 nSequence.
//Nonce n is computed as n = ((locktime - 500,000,000) << 24) | (nSequence & 0x00FFFFFF)
//First 4 bits of the nSequence need to be set for the first input (input 0) (ensuring nSequence has no consensus meaning)
//NOTE: This is different from Starknet and Solana implementations and only takes into account nSequence of the first input (input 0) !!!

//txoHash = keccak256(uint64 nonce || uint64 outputAmount || keccak256(bytes outputScript))
//Commitment: C = abi.encodePacked(bytes32 txoHash, uint32 confirmations, address btcRelayContract)
//Witness: W = C || StoredBlockHeader blockheader || uint32 vout || bytes transaction || uint32 position || bytes32[] merkleProof
contract BitcoinNoncedOutputClaimHandler is IClaimHandler {
    
    using StoredBlockHeaderImpl for StoredBlockHeader;
    using BitcoinTxImpl for BitcoinTx;

    function claim(bytes32 claimData, bytes calldata witness) external view returns (bytes memory witnessResult) {
        require(witness.length >= 288, "btcnoutlock: witness length");

        //Commitment
        bytes32 expectedTxoHash; //32-bytes
        uint32 confirmations; //4-bytes
        address btcRelayContract; //20-bytes

        bytes32 commitmentHash;
        assembly ("memory-safe") {
            expectedTxoHash := calldataload(witness.offset)
            //Load both confirmations and btcRelayContract address at offset 32
            let confirmationsAndBtcRelayContract := calldataload(add(witness.offset, 32))
            confirmations := shr(224 ,confirmationsAndBtcRelayContract) //Extract first 4-bytes
            btcRelayContract := and(shr(64, confirmationsAndBtcRelayContract), 0xffffffffffffffffffffffffffffffffffffffff) //Next 20-bytes

            calldatacopy(0, witness.offset, 56) //Copy to scratch space (0-64)
            commitmentHash := keccak256(0, 56)
        }
        //Verify claim data commitment
        require(commitmentHash==claimData, "btcnoutlock: invalid commitment");

        //Witness
        StoredBlockHeader memory blockheader = StoredBlockHeaderImpl.fromCalldata(witness, 56); //160-bytes
        uint32 vout; //4-bytes
        bytes memory rawTransaction;
        uint32 position; //4-bytes
        bytes32[] calldata proof;
        assembly ("memory-safe") {
            let calldataPtr := add(witness.offset, 216) //Offset of 56-bytes commitment + 160-bytes blockheader
            //Read 4-byte vout
            vout := shr(224, calldataload(calldataPtr))
            calldataPtr := add(calldataPtr, 4)

            let transactionLength := calldataload(calldataPtr)
            let totalCopyLength := add(transactionLength, 32) //Byte length + 32-bytes length prefix
            //Allocate memory
            rawTransaction := mload(0x40)
            mstore(0x40, add(rawTransaction, totalCopyLength))
            calldatacopy(rawTransaction, calldataPtr, totalCopyLength) //Copy data with the length prefix
            calldataPtr := add(calldataPtr, totalCopyLength)

            position := shr(224, calldataload(calldataPtr)) //4-byte position
            calldataPtr := add(calldataPtr, 4)

            proof.length := calldataload(calldataPtr) //32-byte proof length
            calldataPtr := add(calldataPtr, 32) //Offset the start to be after the proof length prefix
            proof.offset := calldataPtr
        }

        //Parse transaction
        BitcoinTx memory transaction = BitcoinTxImpl.fromMemory(rawTransaction);
        //Check output is valid
        uint64 outputValue = transaction.getOutputValue(vout);
        bytes32 scriptHash = transaction.getOutputScriptHash(vout);

        //Get the tx locktime
        uint32 locktimeSub500M = transaction.getLocktime() - 500_000_000;
        
        //Check the nSequence is correct
        uint256 firstNSequence = transaction.getInputNSequence(0);
        require(firstNSequence & 0xF0000000 == 0xF0000000, "btcnoutlock: nSequence bits"); //Ensure first 4 bits are set, such that the nSequence has no consensus meaning
        
        //Don't enforce that all inputs need to have the same last 3 bytes of nSequence
        // uint256 nSequenceMasked = firstNSequence & 0xF0FFFFFF; //Isolate the important bytes of the nSequence
        // //Other inputs
        // uint256 insCount = transaction.inputsCount();
        // for(uint256 index = 1; index < insCount; index++) {
        //     require(transaction.getInputNSequence(index) & 0xF0FFFFFF == nSequenceMasked, "btcnoutlock: nSequence match");
        // }

        bytes32 txoHash;
        assembly ("memory-safe") {
            let nonce := or(shl(24, locktimeSub500M), and(firstNSequence, 0x00FFFFFF)) // (locktime << 24) | (firstNSequence & 0x00ffffff)
            mstore(0x00, or(shl(64, nonce), outputValue)) //This stores 2 x 8-byte values in the least significant bits
            mstore(0x20, scriptHash)
            txoHash := keccak256(16, 48) //Hash starting at offset 16, so we only hash the 2 x 8-bytes values
        }
        require(expectedTxoHash==txoHash, "btcnoutlock: Invalid output");

        //Verify blockheader against the light client
        uint256 blockConfirmations = IBtcRelayView(btcRelayContract).verifyBlockheaderHash(blockheader.blockHeight(), blockheader.hash());
        require(blockConfirmations >= confirmations, "btcnoutlock: confirmations");

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
