// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ContractCall} from "./structs/ContractCall.sol";
import {TransferHandler} from "../transfer_utils/TransferHandler.sol";
import {IDepositOnlyWETH} from "../transfer_utils/interfaces/IDepositOnlyWETH.sol";

interface IExecutionProxy {
    function execute(ContractCall[] calldata data) external;
    function drainTokens(address mainToken, address[] calldata otherTokens, address recipient) external;
}

contract ExecutionProxy is IExecutionProxy, TransferHandler {

    receive() external payable {}

    constructor(IDepositOnlyWETH wrappedEthContract, uint256 transferOutGasForward) TransferHandler(wrappedEthContract, transferOutGasForward) {}

    function execute(ContractCall[] calldata data) external {
        for(uint256 i=0;i<data.length;i++) {
            (bool success, bytes memory returnData) = data[i].target.call{value: data[i].value}(data[i].data);
            // Bubble up the original revert reason using inline assembly
            if(!success) assembly ("memory-safe") {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function drainTokens(address mainToken, address[] calldata otherTokens, address recipient) external {
        uint256 balance = _TokenHandler_balanceOf(mainToken, address(this));
        if(balance > 0) {
            _TokenHandler_transferOut(mainToken, recipient, balance);
        }
        for(uint256 i=0;i<otherTokens.length;i++) {
            address otherToken = otherTokens[i];
            uint256 otherBalance = _TokenHandler_balanceOf(otherToken, address(this));
            if(otherBalance > 0) {
                _TokenHandler_transferOut(otherToken, recipient, otherBalance);
            }
        }
    }

}
