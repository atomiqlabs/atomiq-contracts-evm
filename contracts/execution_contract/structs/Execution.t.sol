// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Execution.sol";

contract ExecutionWrapper {

    function hash(Execution calldata self) pure external returns (bytes32 executionHash) {
        executionHash = ExecutionImpl.hash(self);
    }

}
