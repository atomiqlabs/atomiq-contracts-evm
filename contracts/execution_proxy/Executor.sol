// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {TransferUtils} from "../transfer_utils/TransferUtils.sol";
import {ExecutionProxy} from "./ExecutionProxy.sol";
import {ExecutionAction, ExecutionActionImpl} from "./structs/ExecutionAction.sol";

abstract contract Executor {

    ExecutionProxy immutable executionProxy;

    constructor() {
        executionProxy = new ExecutionProxy();
    }

    function _execute(
        address token, uint256 value, ExecutionAction calldata executionAction, address tokensDestination
    ) internal returns (bool success, bytes memory callError) {
        //If the gas limit is 0 instantly fail and send the tokens directly to the tokensDestination
        if(executionAction.gasLimit == 0) {
            TransferUtils.transferOut(token, tokensDestination, value);
            return (false, "_execute(): gasLimit is zero");
        }

        //Transfer the token to the execution proxy
        TransferUtils.transferOut(token, address(executionProxy), value);
        
        //Try to execute calls
        (success, callError) = address(executionProxy).call{gas: executionAction.gasLimit}(
            abi.encodeWithSelector(ExecutionProxy.execute.selector, executionAction.calls)
        );

        //Drain the excess tokens
        executionProxy.drainTokens(token, executionAction.drainTokens, tokensDestination);
    }

}
