// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./structs/ExecutionAction.sol";
import "./Executor.sol";

event ExecutorWrapperEvent(bool success, bytes callError);

contract ExecutorWrapper is Executor {

    receive() external payable {}

    constructor(IDepositOnlyWETH wrappedEthContract, uint256 transferOutGasForward) Executor(wrappedEthContract, transferOutGasForward) {}

    function execute(
        address token, uint256 value, ExecutionAction calldata executionAction, address tokensDestination
    ) external payable {
        (bool success, bytes memory callError) = _execute(token, value, executionAction, tokensDestination);
        emit ExecutorWrapperEvent(success, callError);
    }
    
    function getExecutionProxy() view external returns (address) {
        return address(executionProxy);
    }

}
