// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library ContractCallUtils {

    //Executes a call strictly with the provided gasLimit, if there is not enough gas left
    // in the current execution (less than provided gasLimit). It reverts without calling the
    // contract
    function safeCall(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) internal returns (bool success, bytes memory returnData) {
        //Assert the gasLimit is less than 2^248, so we can safely do the 63/64 arithmetic with it
        require(gasLimit < 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff, "safeCall: gasLimit too high");

        assembly ("memory-safe") {
            //The call to extcodesize also warms-up the target, so we can use warm access
            // costs in the subsequent approximations
            switch extcodesize(target)
            case 0 {
                //Target has no code, hence should consume 0 gas and only the intrinsic call
                // opcode costs is deducted, additionally we can be sure that no data is returned
                // so we can safely ignore all the return data
                success := call(0, target, value, add(data, 0x20), mload(data), 0, 0)
            }
            default {
                //Target has some code, hence we must make sure that we can forward the required
                // gasLimit to the contract
                //For this we need to get the cost of the CALL opcode intrinsic cost, we need to
                // consider that since extcodesize returned >0, the target is is definitely initialized
                // and we do a warm access now, since the extcodesize warmed up the contract
                //Checks are based on https://www.evm.codes/?fork=prague#f1
                /*
                    The different costs are:
                    - code_execution_cost is the cost of the called code execution (limited by the gas parameter).
                    - If address is warm, then address_access_cost is 100, otherwise it is 2600. See section access sets.
                    - If value is not 0, then positive_value_cost is 9000. In this case there is also a call stipend that is given to make sure that a basic fallback function can be called. 2300 is thus removed from the cost, and also added to the gas input.
                    - If value is not 0 and the address given points to an empty account, then value_to_empty_account_cost is 25000. An account is empty if its balance is 0, its nonce is 0 and it has no code.
                 */
                let callIntrinsicCost := sub(
                    9100, //This is the cost if value is positive (100 gas for warm access + 9000 gas for value transfer)
                    mul(iszero(value), 9000) //If the value is zero we deduct 9000 gas for value transfer, leaving just 100 gas cost
                )

                let requiredGas := add(
                    div(shl(6, gasLimit) /*mul(gasLimit, 64)*/, 63), // 63/64 eip-150 rule
                    add(
                        callIntrinsicCost, //Additional overhead due to intrinsic CALL costs
                        50 //Additional buffer for stack manipulation before CALL
                    )
                )

                //This part is not memory-safe, but it's fine because it's reverting
                if lt(gas(), requiredGas) {
                    //Write function selector: Error(string)
                    mstore(0, 0x08c379a000000000000000000000000000000000000000000000000000000000)
                    //Offset to string (always 32)
                    mstore(0x04, 32)
                    //String length: 26
                    mstore(0x24, 26)
                    //Error message
                    mstore(0x44, "safeCall(): not enough gas")
                    revert(0, 0x64)
                }
                
                //Execute low-level call
                success := call(gasLimit, target, value, add(data, 0x20), mload(data), 0, 0)
                
                //Copy the return data
                let returnDataSize := returndatasize()

                //Get free memory pointer
                let freeMemoryPointer := mload(0x40)
                returnData := freeMemoryPointer

                //Prepend the return data size to make it a valid bytes memory layout
                mstore(freeMemoryPointer, returnDataSize)
                freeMemoryPointer := add(freeMemoryPointer, 0x20)
                //Store returned data
                returndatacopy(freeMemoryPointer, 0, returnDataSize)
                
                //Adjust free memory pointer with returned data size
                mstore(0x40, add(freeMemoryPointer, returnDataSize))
            }
        }
    }

    //Executes the call by forwarding all the available gas and asserts that the
    // sender didn't intentionally use low gas limit to starve out the called
    // contract and make it run out of gas. This can open up gas-dependendnt
    // branching. I.e. a malicious actor can intentionally let the contract
    // call run out of gas, when it would've suceeded otherwise
    //WARNING: This doesn't protect against contracts which spend infinite gas!!! And
    // this would always revert for such contracts!
    function safeCall(
        address target, uint256 value, bytes memory data
    ) internal returns (bool success, bytes memory returnData) {
        //We leverage the EIP-150 63/64 rule, if the post-call gas is close 
        // to 1/64 of the original we rule that there is a malicously set
        // gas limit by the origin, which attempted to make the external call
        // maliciously fail by running out of gas
        
        assembly ("memory-safe") {
            //The call to extcodesize also warms-up the target, so we can use warm access
            // costs in the subsequent approximations
            switch extcodesize(target)
            case 0 {
                //Target has no code, hence should consume 0 gas and only the intrinsic call
                // opcode costs is deducted, additionally we can be sure that no data is returned
                // so we can safely ignore all the return data
                success := call(0, target, value, add(data, 0x20), mload(data), 0, 0)
            }
            default {
                //Save gas snapshot before execution
                let preExecutionGas := gas()
                
                //Execute low-level call, with all the available gas
                success := call(
                    0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff, 
                    target, value, add(data, 0x20), mload(data), 0, 0
                )

                //Capture remaining gas right after execution
                let postExecutionGas := gas()
                
                //Calculate intrinsic cost of the CALL opcode
                let callIntrinsicCost := sub(
                    9100, //This is the cost if value is positive (100 gas for warm access + 9000 gas for value transfer)
                    mul(iszero(value), 9000) //If the value is zero we deduct 9000 gas for value transfer, leaving just 100 gas cost
                )

                //This part is not memory-safe, but it's fine because it's reverting
                //Compare the pre-execution and post-execution gas
                //Use multiplier of 32 (instead of 64), to provide some reasonable buffer, and also
                // add 50 gas on top as a buffer for possible stack-shifting operations before CALL
                // opcode is executed
                if lt(
                    add(
                        shl(5, postExecutionGas), //Same as: mul(postExecutionGas, 32)
                        add(50, callIntrinsicCost) //50 gas buffer + intrinsic call gas cost
                    ),
                    preExecutionGas
                ) {
                    //Write function selector: Error(string)
                    mstore(0, 0x08c379a000000000000000000000000000000000000000000000000000000000)
                    //Offset to string (always 32)
                    mstore(0x04, 32)
                    //String length: 26
                    mstore(0x24, 26)
                    //Error message
                    mstore(0x44, "safeCall(): not enough gas")
                    revert(0, 0x64)
                }

                //Copy the call return data
                //Get free memory pointer
                let freeMemoryPointer := mload(0x40)
                returnData := freeMemoryPointer

                //Prepend the return data size to make it a valid bytes memory layout
                let returnDataSize := returndatasize()
                mstore(freeMemoryPointer, returnDataSize)
                freeMemoryPointer := add(freeMemoryPointer, 0x20)

                //Store returned data
                returndatacopy(freeMemoryPointer, 0, returnDataSize)
                
                //Adjust free memory pointer with returned data size
                mstore(0x40, add(freeMemoryPointer, returnDataSize))
            }
        }
    }
}