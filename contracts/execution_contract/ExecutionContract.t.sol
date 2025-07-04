// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ExecutionContract.sol";

contract ExecutionContractWrapper is ExecutionContract {
    
    receive() external payable {}

    function getExecutionProxy() view external returns (address) {
        return address(executionProxy);
    }

}
