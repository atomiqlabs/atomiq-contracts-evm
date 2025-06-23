// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Utils.sol";

contract UtilsWrapper {

    function packAddressAndVaultId(address owner, uint96 vaultId) pure external returns (bytes32 packedValue) {
        packedValue = Utils.packAddressAndVaultId(owner, vaultId);
    }

    function calculateFee(uint64 baseAmount, uint24 feeSharePer100K) pure external returns (bool success, uint64 result) {
        (success, result) = Utils.calculateFee(baseAmount, feeSharePer100K);
    }

}