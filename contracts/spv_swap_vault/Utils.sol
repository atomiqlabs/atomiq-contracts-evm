// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../utils/MathUtils.sol";

library Utils {

    function packAddressAndVaultId(address owner, uint96 vaultId) pure internal returns (bytes32 packedValue) {
        assembly {
            packedValue := or(shl(96, owner), vaultId)
        }
    }

    function calculateFee(uint64 baseAmount, uint24 feeSharePer100K) pure internal returns (bool success, uint64 result) {
        //This is safe, since we only multiply 64-bit values with 20-bit values, therefore no overflow will ever happen with 256-bit numbers
        unchecked {
            (success, result) = MathUtils.castToUint64(uint256(baseAmount) * uint256(feeSharePer100K) / 100_000);
        }
    }

}