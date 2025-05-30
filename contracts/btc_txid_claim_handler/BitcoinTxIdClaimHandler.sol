// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../common/IClaimHandler.sol";
import "../btc_relay/structs/StoredBlockHeader.sol";
import "../btc_relay/BtcRelay.sol";
import "../btc_utils/BitcoinMerkleTree.sol";

//Claim handler for bitcoin chain txId locks based on light client verification
//Commitment: C = abi.encodePacked(bytes32 reversedTxId, uint32 confirmations, address btcRelayContract)
//Witness: W = C || StoredBlockHeader blockheader || uint32 position || bytes32[] merkleProof
contract BitcoinTxIdClaimHandler {
    
    using StoredBlockHeaderImpl for StoredBlockHeader;

    function claim(bytes32 claimData, bytes calldata witness) external view returns (bytes memory witnessResult) {
        //Commitment
        bytes32 reversedTxId; //32-bytes
        uint256 confirmations; //4-bytes
        address btcRelayContract; //20-bytes

        bytes32 commitmentHash;
        assembly ("memory-safe") {
            reversedTxId := calldataload(witness.offset)
            mstore(0, reversedTxId)
            let confirmationsAndBtcRelayContract := calldataload(add(witness.offset, 24))
            mstore(24, confirmationsAndBtcRelayContract)
            confirmations := and(shr(160 ,confirmationsAndBtcRelayContract), 0xffffffff)
            btcRelayContract := and(confirmationsAndBtcRelayContract, 0xffffffffffffffffffffffffffffffffffffffff)
            commitmentHash := keccak256(0, 56)
        }
        //Verify claim data commitment
        require(commitmentHash==claimData, "txidlock: invalid commitment");

        //Witness
        StoredBlockHeader memory blockheader = StoredBlockHeaderImpl.fromCalldata(witness, 56); //160-bytes
        uint256 position; //4-bytes
        bytes32[] calldata proof;
        assembly ("memory-safe") {
            position := and(calldataload(add(witness.offset, 188)), 0xffffffff)
            proof.offset := add(witness.offset, 220)
            proof.length := sub(witness.length, 220)    
        }

        //Verify blockheader against the light client
        uint256 blockConfirmations = IBtcRelayView(btcRelayContract).verifyBlockheaderHash(blockheader.blockHeight(), blockheader.hash());
        require(blockConfirmations >= confirmations, "txidlock: confirmations");

        //Verify merkle proof
        BitcoinMerkleTree.verify(blockheader.header_merkleRoot(), reversedTxId, proof, position);

        assembly ("memory-safe") {
            witnessResult := mload(0x40) //Free memory pointer
            mstore(0x40, add(witnessResult, 64)) //Allocate 64 bytes of memory
            mstore(witnessResult, 32)
            mstore(add(witnessResult, 32), reversedTxId)
        }
    }

}