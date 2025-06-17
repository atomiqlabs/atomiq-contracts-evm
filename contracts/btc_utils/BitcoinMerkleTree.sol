// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library BitcoinMerkleTree {

    //Computes the merkle root from the provided leaf, with the proof and index (position of the leaf in the bottom layer of the tree)
    function getMerkleRoot(bytes32 leaf, bytes32[] calldata proof, uint256 index) view internal returns (bytes32 merkleRoot) {
        assembly ("memory-safe") {
            //if the least significant bit of index is set, store the hash on the right side (offset 32)
            // if bit is unset, store the hash on the left side (offset 0)
            mstore(shl(5, and(index, 0x01)), leaf) //mul(and(index, 0x01), 32) == shl(5, and(index, 0x01))
            
            let proofLength := shl(5, proof.length) //mul(proof.length, 32)
            let ptr := proof.offset
            let proofEnd := add(ptr, proofLength)
            for { } lt(ptr, proofEnd) { ptr := add(ptr, 32) } {
                //if the least significant bit of index is set (1), store the hash on the left side (offset 0)
                // if bit is unset (0), store the hash on the left side (offset 32)
                mstore(shl(5, iszero(and(index, 0x01))), calldataload(ptr)) //mul(iszero(and(index, 0x01)), 32) == shl(5, iszero(and(index, 0x01)))
                index := shr(1, index)
                
                //Invoke first sha256 hash on the memory region, destination is scratch space at 0x00
                pop(staticcall(gas(), 0x02, 0x00, 64, 0x00, 32))
                //Invoke second sha256 on the scratch space at 0x00, destination is determined by the
                // least significant bit of index, set (1) = offset 32, unset (0) = offset 0
                pop(staticcall(gas(), 0x02, 0x00, 32, shl(5, and(index, 0x01)), 32)) //mul(and(index, 0x01), 32) == shl(5, and(index, 0x01))
            }
            merkleRoot := mload(shl(5, and(index, 0x01))) //mul(and(index, 0x01), 32) == shl(5, and(index, 0x01)) 
        }
    }

    //Verifies the merkle root inclusion proof
    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof, uint256 index) view internal {
        require(getMerkleRoot(leaf, proof, index)==root, "merkleTree: verify failed");
    }

}

