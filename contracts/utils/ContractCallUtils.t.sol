// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ContractCallUtils.sol";

contract ContractCallUtilsWrapper {

    event ExecutionResult(bool indexed success, bytes callError);
    
    receive() external payable {}

    function safeCall(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) external {
        (bool success, bytes memory callError) = ContractCallUtils.safeCall(target, value, data, gasLimit);
        emit ExecutionResult(success, callError);
    }

    function safeCallNoEmit(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) external {
        ContractCallUtils.safeCall(target, value, data, gasLimit);
    }

    function safeCall(
        address target, uint256 value, bytes memory data
    ) external {
        (bool success, bytes memory result) = ContractCallUtils.safeCall(target, value, data);
        emit ExecutionResult(success, result);
    }

    function safeCallNoEmit(
        address target, uint256 value, bytes memory data
    ) external {
        ContractCallUtils.safeCall(target, value, data);
    }

    function standardCall(
        address target, uint256 value, bytes memory data
    ) external {
        (bool success, bytes memory result) = target.call{value: value, gas: gasleft()}(data);
        emit ExecutionResult(success, result);
    }

    function standardCallNoEmit(
        address target, uint256 value, bytes memory data
    ) external {
        target.call{value: value, gas: gasleft()}(data);
    }

}
