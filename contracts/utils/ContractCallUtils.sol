// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library ContractCallUtils {

    //Used to estimate the intrinsic cost of the CALL opcode
    //Checks are based on https://www.evm.codes/?fork=prague#f1
    /*
        The different costs are:
        - code_execution_cost is the cost of the called code execution (limited by the gas parameter).
        - If address is warm, then address_access_cost is 100, otherwise it is 2600. See section access sets.
        - If value is not 0, then positive_value_cost is 9000. In this case there is also a call stipend that is given to make sure that a basic fallback function can be called. 2300 is thus removed from the cost, and also added to the gas input.
        - If value is not 0 and the address given points to an empty account, then value_to_empty_account_cost is 25000. An account is empty if its balance is 0, its nonce is 0 and it has no code.
    */
    function calculateCallIntrinsicCost(
        address target, uint256 value
    ) view private returns (uint256) {
        uint256 intrinsicCost = 2600;
        assembly ("memory-safe") {
            if gt(value, 0) {
                //An account is empty if its balance is 0, its nonce is 0 and it has no code.
                // In the EVM context we can only check the balance and codesize, so we use
                // that as an optimistic approximation. This is fine, since we can only get
                // false positives.
                let isAccountEmpty := and(iszero(extcodesize(target)), iszero(balance(target)))
                intrinsicCost := add(intrinsicCost, mul(isAccountEmpty, 25000)) //For empty account we add value_to_empty_account_cost

                //This also warmed-up (calls to extcodesize & balance) the `target` address
                // overhead := sub(overhead, 2500) //Since the account will be warmed up, we can subtract the cold-access gas cost
                // overhead := add(overhead, 9000) //The value is non-zero, so we need to increase by positive_value_cost
                //The following line is an equivalent of the above 2 lines
                intrinsicCost := add(intrinsicCost, 6500)
            }
        }
        return intrinsicCost;
    }

    //Executes a call strictly with the provided gasLimit, if there is not enough gas left
    // in the current execution (less than provided gasLimit). It reverts without calling the
    // contract
    function strictCall(
        address target, uint256 value, bytes memory data, uint256 gasLimit
    ) internal returns (bool success, bytes memory callError) {
        uint256 requiredGas = 
            (gasLimit * 64 / 63) + // 63/64 eip-150 rule
            calculateCallIntrinsicCost(target, value) + //Additional overhead due to intrinsic CALL costs
            50 + //Additional buffer for stack manipulation before CALL
            200; //Additional buffer for return or revert data (should be enough to return up to 2kB of data)

        //Execute the following with Yul assembly, such that we can have more control of the gas costs
        // leading up to the CALL opcode and we don't let the Solidity compiler do something stupid
        assembly ("memory-safe") {
            //This part is not memory-safe, but it's fine because it's reverting
            if lt(gas(), requiredGas) {
                //Write function selector: Error(string)
                mstore(0, 0x08c379a000000000000000000000000000000000000000000000000000000000)
                //Offset to string (always 32)
                mstore(0x04, 32)
                //String length: 28
                mstore(0x24, 28)
                //Error message
                mstore(0x44, "strictCall(): not enough gas")
                revert(0, 0x64)
            }

            //Execute low-level call
            success := call(
                gasLimit,
                target,
                value,
                add(data, 0x20),
                mload(data),
                0,
                0
            )

            if iszero(success) {
                let returnDataSize := returndatasize()

                //Get free memory pointer
                let freeMemoryPointer := mload(0x40)
                callError := freeMemoryPointer

                //Prepend the return data size to make it a valid bytes memory layout
                mstore(freeMemoryPointer, returnDataSize)
                freeMemoryPointer := add(freeMemoryPointer, 0x20)
                //Store returned data
                returndatacopy(freeMemoryPointer, 0, returnDataSize)
                
                //Adjust free memory pointer with returned data size
                mstore(0x40, add(freeMemoryPointer, returnDataSize))
            } //Otherwise we don't care about return data, hence don't return anything
        }
    }

    //Executes the call by forwarding all the available gas and asserts that the
    // origin didn't intentionally use low gas limit to starve out the called
    // contract and make it run out of gas. This can open up gas-dependendnt
    // branching (i.e. a malicious actor can intentionally) let the contract
    // call (run out of gas), when it would've suceeded otherwise
    //WARNING: This doesn't protect against contracts which spend infinite gas!!! And
    // this would always revert for such contracts!
    function safeCall(
        address target, uint256 value, bytes memory data
    ) internal returns (bool success, bytes memory returnData) {
        //We leverage the EIP-150 63/64 rule, if the post-call gas is close 
        // to 1/64 of the original we rule that there is a malicously set
        // gas limit by the origin, which attempted to make the external call
        // maliciously fail by running out of gas

        //Also need to consider the intrinsic cost of the CALL opcode
        uint256 intrinsicCallCost = calculateCallIntrinsicCost(target, value);

        //Execute the following with Yul assembly, such that we can have more control of the gas costs
        // leading up to the CALL opcode and we don't let the Solidity compiler do something stupid
        assembly ("memory-safe") {
            //Save gas snapshot before execution
            let preExecutionGas := gas()
            
            //Execute low-level call
            success := call(
                gas(),
                target,
                value,
                add(data, 0x20),
                mload(data),
                0,
                0
            )

            //Capture remaining gas right after execution
            let postExecutionGas := gas()

            //This part is not memory-safe, but it's fine because it's reverting
            //Compare the pre-execution and post-execution gas
            //Use multiplier of 32 (instead of 64), to provide some reasonable buffer, and also
            // add 50 gas on top as a buffer for possible stack-shifting operations before CALL
            // opcode is executed
            if lt(
                add(
                    shl(5, postExecutionGas), //Same as: mul(postExecutionGas, 32)
                    add(50, intrinsicCallCost) //50 gas buffer + intrinsic call gas cost
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