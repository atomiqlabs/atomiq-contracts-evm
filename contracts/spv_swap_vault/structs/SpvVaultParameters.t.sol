// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./SpvVaultParameters.sol";

contract SpvVaultParametersWrapper {
    
    function hash(SpvVaultParameters calldata self) pure external returns (bytes32 paramsHash) {
        paramsHash = SpvVaultParametersImpl.hash(self);
    }

    function fromRawToken0(SpvVaultParameters calldata self, uint64 amount0Raw) pure external returns (uint256 result) {
        result = SpvVaultParametersImpl.fromRawToken0(self, amount0Raw);
    }

    function fromRawToken1(SpvVaultParameters calldata self, uint64 amount1Raw) pure external returns (uint256 result) {
        result = SpvVaultParametersImpl.fromRawToken1(self, amount1Raw);
    }

    function fromRaw(SpvVaultParameters calldata self, uint64 amount0Raw, uint64 amount1Raw) pure external returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = SpvVaultParametersImpl.fromRaw(self, amount0Raw, amount1Raw);
    }

}
