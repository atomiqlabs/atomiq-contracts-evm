// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct Execution {
    //erc20 token address locked
    address token;
    //keccak256 hash of the calls to be executed & tokens to be drained/withdrawn (ExecutionAction struct)
    bytes32 executionActionHash;
    
    //Total amount of tokens locked
    uint256 amount;

    //Execution fee paid to the caller
    uint256 executionFee;

    //After the expiry anyone can refund and claim the execution fee
    uint256 expiry;
}

library ExecutionImpl {

    function hash(Execution calldata self) pure internal returns (bytes32 executionHash) {
        executionHash = keccak256(abi.encode(self));
    }

}
