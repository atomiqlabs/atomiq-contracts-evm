// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {WETH9} from "./WETH9.sol";

// wake-disable-next-line
contract BrokenDepositWETH9 is WETH9 {
    /**
     * @notice Deposit ETH and mint WETH tokens
     */
    function deposit() override public payable {
        revert("cannot deposit");
    }
}
