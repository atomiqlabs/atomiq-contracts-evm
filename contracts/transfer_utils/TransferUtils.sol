// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

library TransferUtils {

    using SafeERC20 for IERC20;

    function balanceOf(address token, address owner) view internal returns (uint256) {
        if(token==address(0x0)) {
            return owner.balance;
        } else {
            return IERC20(token).balanceOf(owner);
        }
    }

    //Transfer ERC20 tokens or native token to the current contract using transfer_from function
    //NOTE: Extra care needs to be taken to not call this function multiple times with native token address (0x0),
    // since this only checks msg.value and there is no way to decrement it during runtime
    function transferIn(address token, address src, uint256 amount) internal {
        if(token==address(0x0)) {
            //Native token transfer
            require(src==msg.sender, "transferIn: sender not src");
            require(msg.value >= amount, "transferIn: value too low");
        } else {
            //ERC20 token transfer
            IERC20(token).safeTransferFrom(src, address(this), amount);
        }
    }

    //Sends out ERC20 tokens or native token from the current contract
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOut(address token, address dst, uint256 amount) internal {
        if(token==address(0x0)) {
            //Native token transfer
            (bool success, ) = payable(dst).call{value: amount, gas: 5000}("");
            require(success, "transferOut: native xfer fail");
        } else {
            //ERC20 token transfer
            IERC20(token).safeTransfer(dst, amount);
        }
    }

    //Sends out ERC20 tokens or native token from the current contract, doesn't revert on failure!
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOutNoRevert(address token, address dst, uint256 amount) internal returns (bool success) {
        if(token==address(0x0)) {
            //Native token transfer
            (success, ) = payable(dst).call{value: amount, gas: 5000}("");
        } else {
            //ERC20 token transfer
            success = IERC20(token).trySafeTransfer(dst, amount);
        }
    }

}