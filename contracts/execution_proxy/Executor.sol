// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {TransferUtils} from "../transfer_utils/TransferUtils.sol";
import {ExecutionProxy} from "./ExecutionProxy.sol";
import {ExecutionAction, ExecutionActionImpl} from "./structs/ExecutionAction.sol";

contract Executor {

    ExecutionProxy immutable executionProxy;

    constructor() {
        executionProxy = new ExecutionProxy();
    }

    function _execute(
        address token, uint256 value, ExecutionAction calldata executionAction, address tokensDestination
    ) internal returns (bool success, bytes memory callError) {
        //Transfer the token to the execution proxy
        TransferUtils.transferOut(token, address(executionProxy), value);
        
        //Try to execute calls
        (success, callError) = address(executionProxy).call{gas: executionAction.gasLimit==0 ? gasleft() : executionAction.gasLimit}(
            abi.encodeWithSelector(ExecutionProxy.execute.selector, executionAction.calls)
        );

        //Drain the excess tokens
        executionProxy.drainTokens(token, executionAction.drainTokens, tokensDestination);
    }

}
