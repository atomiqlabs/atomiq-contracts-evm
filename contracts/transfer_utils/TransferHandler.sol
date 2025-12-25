// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDepositOnlyWETH} from "./interfaces/IDepositOnlyWETH.sol";
import {ContractCallUtils} from "../utils/ContractCallUtils.sol";

abstract contract TransferHandler {
    using SafeERC20 for IERC20;
    using SafeERC20 for IDepositOnlyWETH;

    IDepositOnlyWETH immutable _wrappedEthContract;
    uint256 immutable _transferOutGasForward;

    constructor(IDepositOnlyWETH wrappedEthContract, uint256 transferOutGasForward) {
        _wrappedEthContract = wrappedEthContract;
        _transferOutGasForward = transferOutGasForward;
    }

    //Re-implementation of the OpenZeppelin's `trySafeTransfer` function which uses the 
    // safe call util to execute the underlying call
    function trySafeTransfer(address token, address dst, uint256 amount) private returns (bool success) {
        //Attempt a transfer using the safe call
        (bool transferSuccess, bytes memory returnData) = ContractCallUtils.safeCall(
            token,
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, dst, amount)
        );
        //Do nothing, the success is set to false anyway
        if(!transferSuccess) return success;

        //This follows the checks from OpenZeppelin's trySafeFrom function:
        // - relaxes the requirement on the return value: the return value is optional (but if data is returned,
        //    it must not be true).
        assembly ("memory-safe") {
            let returnDataSize := mload(returnData)
            let returnValue := mload(add(returnData, 32))
            success := and(
                gt(returnDataSize, 31), //Return data size is at least 32 bytes
                eq(returnValue, 1) //Returned value is true (1)
            )
            //If call success all is good.
            //Otherwise (not success is not true), we need to perform further checks
            if iszero(success) {
                //If the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(iszero(returndatasize()), gt(extcodesize(token), 0))
            }
        }
    }

    //Transfer ERC20 tokens or native token to the current contract using transfer_from function
    //If native token transfer is used the src address needs to be the address of the transaction sender,
    // since the msg.value is checked
    //NOTE: Extra care needs to be taken to not call this function multiple times with native token address (0x0),
    // since this only checks msg.value and there is no way to decrement it during runtime
    function _TokenHandler_transferIn(address token, address src, uint256 amount) internal {
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
    //In case it fails to send out the native token it wraps it to a WETH erc20 token instead
    // and send this token to the dst
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function _TokenHandler_transferOut(address token, address dst, uint256 amount) internal {
        if(token==address(0x0)) {
            //Attempt native token transfer using safe call, so we can be sure that enough
            // gas is forwarded in the transfer, otherwise a malicious caller could intentionally
            // call with too little gas, making the transfer fail when it shouldn't
            (bool success, ) = ContractCallUtils.safeCall(dst, amount, "", _transferOutGasForward);
            //If failed, wrap the native token to the WETH contract and send it out
            if(!success) {
                _wrappedEthContract.deposit{value: amount}();   
                _wrappedEthContract.safeTransfer(dst, amount);
            }
        } else {
            //ERC20 token transfer
            IERC20(token).safeTransfer(dst, amount);
        }
    }

    //Sends out ERC20 tokens or native token from the current contract, doesn't revert on failure!
    //In case it fails to send out the native token it wraps it to a WETH erc20 token instead
    // and send this token to the dst
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function _TokenHandler_transferOutNoRevert(address token, address dst, uint256 amount) internal returns (bool success) {
        if(token==address(0x0)) {
            //Attempt native token transfer using safe call, so we can be sure that enough
            // gas is forwarded in the transfer, otherwise a malicious caller could intentionally
            // call with too little gas, making the transfer fail when it shouldn't
            (success, ) = ContractCallUtils.safeCall(dst, amount, "", _transferOutGasForward);
            if(success) return success;

            //If failed, wrap the native token to the WETH contract and send it out
            //Also use safe call for calling the WETH functions, this again makes sure
            // that no gas dependent branching is possible
            (bool wethDepositSuccess, ) = ContractCallUtils.safeCall(
                address(_wrappedEthContract),
                amount,
                abi.encodeWithSelector(IDepositOnlyWETH.deposit.selector)
            );
            //Do nothing, the success is set to false anyway
            if(!wethDepositSuccess) return success;

            //Attempt the transfer of WETH
            success = trySafeTransfer(address(_wrappedEthContract), dst, amount);
        } else {
            success = trySafeTransfer(address(token), dst, amount);
        }
    }

    //Sends out ERC20 tokens or native token from the current contract, forwards all available gas
    // in case of native transfer & doesn't do the WETH wrapping when native transfer fails
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function _TokenHandler_transferOutRawFullGas(address token, address dst, uint256 amount) internal {
        if(token==address(0x0)) {
            //Attempt native token transfer, since here the call is reverting, we don't
            // need to use the safe call utils
            (bool success, ) = payable(dst).call{value: amount, gas: gasleft()}("");
            require(success, "transferOutRaw: native xfer fail");
        } else {
            //ERC20 token transfer
            IERC20(token).safeTransfer(dst, amount);
        }
    }

    function _TokenHandler_approve(address token, address spender, uint256 amount) internal {
        IERC20(token).forceApprove(spender, amount);
    }

    function _TokenHandler_balanceOf(address token, address owner) view internal returns (uint256) {
        if(token==address(0x0)) {
            return owner.balance;
        } else {
            return IERC20(token).balanceOf(owner);
        }
    }

}