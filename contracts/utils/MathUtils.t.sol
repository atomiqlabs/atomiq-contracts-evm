// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./MathUtils.sol";

contract MathUtilsWrapper {

    function castToUint64(uint256 value) pure external returns (bool success, uint64 result) {
        (success, result) = MathUtils.castToUint64(value);
    }

    function checkedSubUint64(uint64 a, uint256 b) pure external returns (bool success, uint64 result) {
        (success, result) = MathUtils.checkedSubUint64(a, b);
    }

    function saturatingAddOneUint32(uint32 a) pure external returns (uint32 result) {
        result = MathUtils.saturatingAddOneUint32(a);
    }

    function saturatingAddUint224(uint224 a, uint256 b) pure external returns (uint224 result) {
        result = MathUtils.saturatingAddUint224(a, b);
    }

    function maxUint256(uint256 a, uint256 b) pure external returns (uint256 result) {
        result = MathUtils.maxUint256(a, b);
    }

}