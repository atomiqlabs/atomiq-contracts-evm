// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./TransferHandler.sol";

event TransferNoRevertResult(bool success);

contract TransferHandlerWrapper is TransferHandler {

    using SafeERC20 for IERC20;

    receive() payable external {}

    constructor(IDepositOnlyWETH wrappedEthContract, uint256 transferOutGasForward) TransferHandler(wrappedEthContract, transferOutGasForward) {}

    function balanceOf(address token, address owner) view external returns (uint256) {
        return _TokenHandler_balanceOf(token, owner);
    }

    //Transfer ERC20 tokens or native token to the current contract using transfer_from function
    //NOTE: Extra care needs to be taken to not call this function multiple times with native token address (0x0),
    // since this only checks msg.value and there is no way to decrement it during runtime
    function transferIn(address token, address src, uint256 amount) external payable {
        _TokenHandler_transferIn(token, src, amount);
    }

    //Sends out ERC20 tokens or native token from the current contract
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOut(address token, address dst, uint256 amount) external {
        _TokenHandler_transferOut(token, dst, amount);
    }

    //Sends out ERC20 tokens or native token from the current contract, doesn't revert on failure!
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOutNoRevert(address token, address dst, uint256 amount) external {
        emit TransferNoRevertResult(_TokenHandler_transferOutNoRevert(token, dst, amount));
    }
    
    //Sends out ERC20 tokens or native token from the current contract, forwards all available gas
    // in case of native transfer & doesn't do the WETH wrapping when native transfer fails
    //NOTE: Extra care needs to be taken when sending out native token as to not introduce
    // re-entrancy, the transferOut should therefore be done after the state is already updated
    function transferOutRawFullGas(address token, address dst, uint256 amount) external {
        _TokenHandler_transferOutRawFullGas(token, dst, amount);
    }

}