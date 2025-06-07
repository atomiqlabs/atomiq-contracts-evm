// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./TransferUtils.sol";

event TransferNoRevertResult(bool success);

contract TransferUtilsWrapper {

    using SafeERC20 for IERC20;

    receive() payable external {}

    function balanceOf(address token, address owner) view external returns (uint256) {
        return TransferUtils.balanceOf(token, owner);
    }

    //Transfer ERC20 tokens or native token to the current contract using transfer_from function
    //NOTE: Extra care needs to be taken to not call this function multiple times with native token address (0x0),
    // since this only checks msg.value and there is no way to decrement it during runtime
    function transferIn(address token, address src, uint256 amount) external payable {
        TransferUtils.transferIn(token, src, amount);
    }

    //Sends out ERC20 tokens or native token from the current contract
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOut(address token, address dst, uint256 amount) external {
        TransferUtils.transferOut(token, dst, amount);
    }

    //Sends out ERC20 tokens or native token from the current contract, doesn't revert on failure!
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOutNoRevert(address token, address dst, uint256 amount) external {
        emit TransferNoRevertResult(TransferUtils.transferOutNoRevert(token, dst, amount));
    }

}