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
uint256 constant ExecutionByteLength = 160;

library ExecutionImpl {

    function hash(Execution calldata self) pure internal returns (bytes32 executionHash) {
        //The following assembly is equivalent to:
        // executionHash = keccak256(abi.encode(self));
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            //We don't need to allocate memory properly here (with mstore(0x40, newOffset)), 
            // since we only use it as scratch-space for hashing, we can keep the free memory
            // pointer as-is
            // mstore(0x40, add(ptr, ExecutionByteLength))
            calldatacopy(ptr, self, ExecutionByteLength)
            executionHash := keccak256(ptr, ExecutionByteLength)
        }
    }

}
