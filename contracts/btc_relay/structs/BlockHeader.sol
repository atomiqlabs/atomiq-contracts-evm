pragma solidity ^0.8.28;

/**
 * Bitcoin blockheader decoding from bytes
 * Structure (total 48 bytes):
 * - uint32 reversedVersion
 * - bytes32 previousBlockhash (omitted and taken from last)
 * - bytes32 merkleRoot
 * - uint32 reversedTimestamp
 * - uint32 nbits
 * - uint32 nonce 
 */
library BlockHeader {

    function verifyOutOfBounds(bytes calldata self, uint256 offset) pure internal {
        require(self.length >= offset + 48, "BlockHeader: out of bounds");
    }

    //Getters
    function reversedVersion(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(self.offset, offset)))
        }
    }

    function merkleRoot(bytes calldata self, uint256 offset) pure internal returns (bytes32 result) {
        assembly ("memory-safe") {
            result := calldataload(add(add(self.offset, offset), 4))
        }
    }

    function reversedTimestamp(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 36)))
        }
    }

    function nbits(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 40)))
        }
    }

    function nonce(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 44)))
        }
    }
    
}