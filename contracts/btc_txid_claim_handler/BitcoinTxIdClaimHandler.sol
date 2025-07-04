// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IClaimHandler} from "../common/IClaimHandler.sol";
import {StoredBlockHeader, StoredBlockHeaderImpl, StoredBlockHeaderByteLength} from "../btc_relay/structs/StoredBlockHeader.sol";
import {IBtcRelayView} from "../btc_relay/BtcRelay.sol";
import {BitcoinMerkleTree} from "../btc_utils/BitcoinMerkleTree.sol";

//Claim handler for bitcoin chain txId locks based on light client verification
//Commitment: C = abi.encodePacked(bytes32 txHash, uint32 confirmations, address btcRelayContract)
//Witness: W = C || StoredBlockHeader blockheader || uint32 position || bytes32[] merkleProof
contract BitcoinTxIdClaimHandler is IClaimHandler {
    
    using StoredBlockHeaderImpl for StoredBlockHeader;

    function claim(bytes32 claimData, bytes calldata witness) external view returns (bytes memory witnessResult) {
        require(witness.length >= 56 + StoredBlockHeaderByteLength + 4 + 32, "txidlock: witness length");

        //Commitment
        bytes32 txHash; //32-bytes
        uint32 confirmations; //4-bytes
        address btcRelayContract; //20-bytes

        bytes32 commitmentHash;
        assembly ("memory-safe") {
            txHash := calldataload(witness.offset)
            //Load both confirmations and btcRelayContract address at offset 32
            let confirmationsAndBtcRelayContract := calldataload(add(witness.offset, 32))
            confirmations := shr(224 ,confirmationsAndBtcRelayContract) //Extract first 4-bytes
            btcRelayContract := and(shr(64, confirmationsAndBtcRelayContract), 0xffffffffffffffffffffffffffffffffffffffff) //Next 20-bytes

            calldatacopy(0, witness.offset, 56) //Copy to scratch space (0-64)
            commitmentHash := keccak256(0, 56)
        }
        //Verify claim data commitment
        require(commitmentHash==claimData, "txidlock: invalid commitment");

        //Witness
        StoredBlockHeader memory blockheader = StoredBlockHeaderImpl.fromCalldata(witness, 56); //160-bytes
        uint32 position; //4-bytes
        bytes32[] calldata proof; //32-byte length prefix + merkle proof hashes
        assembly ("memory-safe") {
            position := shr(224, calldataload(add(witness.offset, add(56, StoredBlockHeaderByteLength)))) //Read 4-byte position
            proof.length := calldataload(add(witness.offset, add(60, StoredBlockHeaderByteLength))) //Read length prefix
            proof.offset := add(witness.offset, add(92, StoredBlockHeaderByteLength)) //Offset 220 + 32-byte length prefix
        }

        //Verify blockheader against the light client
        uint256 blockConfirmations = IBtcRelayView(btcRelayContract).verifyBlockheaderHash(blockheader.blockHeight(), blockheader.hash());
        require(blockConfirmations >= confirmations, "txidlock: confirmations");

        //Verify merkle proof
        BitcoinMerkleTree.verify(blockheader.header_merkleRoot(), txHash, proof, position);

        //Return txHash as result
        assembly ("memory-safe") {
            witnessResult := mload(0x40) //Free memory pointer
            mstore(0x40, add(witnessResult, 64)) //Allocate 64 bytes of memory
            mstore(witnessResult, 32)
            mstore(add(witnessResult, 32), txHash)
        }
    }

}