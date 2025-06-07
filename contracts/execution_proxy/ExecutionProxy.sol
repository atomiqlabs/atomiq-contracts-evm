// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./structs/ContractCall.sol";
import "../transfer_utils/TransferUtils.sol";

interface IExecutionProxy {
    function execute(ContractCall[] calldata data) external;
    function drainTokens(address mainToken, address[] calldata otherTokens, address recipient) external;
}

contract ExecutionProxy is IExecutionProxy {

    receive() external payable {}

    function execute(ContractCall[] calldata data) external {
        for(uint256 i=0;i<data.length;i++) {
            (bool success, bytes memory returnData) = data[i].target.call{value: data[i].value}(data[i].data);
            // Bubble up the original revert reason using inline assembly
            if(!success) assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function drainTokens(address mainToken, address[] calldata otherTokens, address recipient) external {
        uint256 balance = TransferUtils.balanceOf(mainToken, address(this));
        if(balance > 0) {
            TransferUtils.transferOut(mainToken, recipient, balance);
        }
        for(uint256 i=0;i<otherTokens.length;i++) {
            address otherToken = otherTokens[i];
            uint256 otherBalance = TransferUtils.balanceOf(otherToken, address(this));
            if(otherBalance > 0) {
                TransferUtils.transferOut(otherToken, recipient, otherBalance);
            }
        }
    }

}
