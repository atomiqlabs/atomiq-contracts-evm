// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ContractCall.sol";

struct ExecutionAction {
    //Gas limit for the contract calls, 0 is a placeholder for forwarding all the available gas
    uint256 gasLimit;
    //Token addresses to drain from the contract after execution
    address[] drainTokens;
    //Contract calls to execute
    ContractCall[] calls;
}

library ExecutionActionImpl {

    function hash(ExecutionAction calldata self) pure internal returns (bytes32 executionActionHash) {
        executionActionHash = keccak256(abi.encode(self));
    }

}
