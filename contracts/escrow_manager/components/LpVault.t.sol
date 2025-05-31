// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./LpVault.sol";

contract LpVaultWrapper is LpVault {
    function LpVault_transferOut(address token, address dst, uint256 amount) external {
        _LpVault_transferOut(token, dst, amount);
    }
    function LpVault_transferIn(address token, address dst, uint256 amount) external {
        _LpVault_transferIn(token, dst, amount);
    }
}
