// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Utils.sol";

contract UtilsWrapper {

    function packAddressAndVaultId(address owner, uint96 vaultId) pure external returns (bytes32 packedValue) {
        packedValue = Utils.packAddressAndVaultId(owner, vaultId);
    }

}