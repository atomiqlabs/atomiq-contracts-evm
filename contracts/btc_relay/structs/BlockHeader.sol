// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../btc_utils/Endianness.sol";

/**
 * Bitcoin blockheader decoding from bytes (previous block hash is not included and is instead
 *  fetched from latest stored blockheader)
 * Structure (total 48 bytes):
 * - uint32 reversedVersion
 * - bytes32 merkleRoot
 * - uint32 reversedTimestamp
 * - uint32 nbits
 * - uint32 nonce
 */
library BlockHeaderUtils {

    function verifyOutOfBounds(bytes calldata self, uint256 offset) pure internal {
        require(self.length >= offset + 48, "BlockHeader: out of bounds");
    }

    //Getters
    function timestamp(bytes calldata self, uint256 offset) pure internal returns (uint32 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 36)))
        }
        result = Endianness.reverseUint32(result);
    }

    function reversedNbits(bytes calldata self, uint256 offset) pure internal returns (uint32 result) {
        assembly ("memory-safe") {
            result := shr(224, calldataload(add(add(self.offset, offset), 40)))
        }
    }
    
}