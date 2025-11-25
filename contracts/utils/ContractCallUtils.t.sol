// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ContractCallUtils.sol";

contract ContractCallUtilsWrapper {

    event ExecutionResult(bool indexed success, bytes callError);
    
    receive() external payable {}

    function strictCall(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) external {
        (bool success, bytes memory callError) = ContractCallUtils.strictCall(target, value, data, gasLimit);
        emit ExecutionResult(success, callError);
    }

    function strictCallNoEmit(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) external {
        ContractCallUtils.strictCall(target, value, data, gasLimit);
    }

}
