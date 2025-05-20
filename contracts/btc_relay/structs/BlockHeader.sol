pragma solidity ^0.8.28;

/**
 * Bitcoin blockheader decoding from bytes
 * Structure (total 80 bytes):
 * - uint32 reversedVersion
 * - bytes32 previousBlockhash
 * - bytes32 merkleRoot
 * - uint32 reversedTimestamp
 * - uint32 nbits
 * - uint32 nonce 
 */
library BlockHeader {

    function verifyOutOfBounds(bytes calldata self, uint256 offset) pure internal {
        require(self.length >= offset + 80, "BlockHeader: out of bounds");
    }

    //Getters
    function reversedVersion(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(self.offset, offset)))
        }
    }

    function previousBlockhash(bytes calldata self, uint256 offset) pure internal returns (bytes32 result) {
        assembly ("memory-safe") {
            result := calldataload(add(add(self.offset, offset), 4))
        }
    }

    function merkleRoot(bytes calldata self, uint256 offset) pure internal returns (bytes32 result) {
        assembly ("memory-safe") {
            result := calldataload(add(add(self.offset, offset), 36))
        }
    }

    function reversedTimestamp(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 68)))
        }
    }

    function nbits(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 72)))
        }
    }

    function nonce(bytes calldata self, uint256 offset) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 76)))
        }
    }

    //Functions
    function dblSha256Hash(bytes calldata self, uint256 offset) view internal returns (bytes32 result) {
        assembly ("memory-safe") {
            //Get location of empty memory
            let emptyMemPtr := mload(0x40)
            calldatacopy(emptyMemPtr, add(self.offset, offset), 80)

            //Invoke first sha256 hash on the memory region, destination is scratch space at 0x00
            pop(staticcall(gas(), 0x02, emptyMemPtr, 80, 0x00, 32))
            //Invoke seconds sha256 on the scratch space at 0x00
            pop(staticcall(gas(), 0x02, 0x00, 32, 0x00, 32))

            result := mload(0x00)
        }
    }
    
}