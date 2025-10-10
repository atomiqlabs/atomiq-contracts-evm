// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {TransferHandler} from "../transfer_utils/TransferHandler.sol";
import {IDepositOnlyWETH} from "../transfer_utils/interfaces/IDepositOnlyWETH.sol";
import {ExecutionProxy} from "./ExecutionProxy.sol";
import {ExecutionAction, ExecutionActionImpl} from "./structs/ExecutionAction.sol";

abstract contract Executor is TransferHandler {

    ExecutionProxy immutable executionProxy;

    constructor(IDepositOnlyWETH wrappedEthContract, uint256 transferOutGasForward) TransferHandler(wrappedEthContract, transferOutGasForward) {
        executionProxy = new ExecutionProxy(wrappedEthContract, transferOutGasForward);
    }

    function _execute(
        address token, uint256 value, ExecutionAction calldata executionAction, address tokensDestination
    ) internal returns (bool success, bytes memory callError) {
        //If the gas limit is 0 instantly fail and send the tokens directly to the tokensDestination
        if(executionAction.gasLimit == 0) {
            _TokenHandler_transferOut(token, tokensDestination, value);
            return (false, "_execute(): gasLimit is zero");
        }

        //Transfer the token to the execution proxy, we can forward with the full
        // available gas since we can trust the executionProxy deployed in constructor
        _TokenHandler_transferOutRawFullGas(token, address(executionProxy), value);
        
        //Try to execute calls
        (success, callError) = address(executionProxy).call{gas: executionAction.gasLimit}(
            abi.encodeWithSelector(ExecutionProxy.execute.selector, executionAction.calls)
        );

        //Drain the excess tokens
        executionProxy.drainTokens(token, executionAction.drainTokens, tokensDestination);
    }

}
