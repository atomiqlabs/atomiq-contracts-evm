// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library Utils {

    function packAddressAndVaultId(address owner, uint96 vaultId) pure internal returns (bytes32 packedValue) {
        assembly {
            packedValue := or(shl(96, owner), vaultId)
        }
    }

}