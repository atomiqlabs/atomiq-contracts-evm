// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {WETH9} from "./WETH9.sol";

// wake-disable-next-line
contract BrokenTransferWETH9 is WETH9 {
    /**
     * @notice Transfer WETH to another address
     */
    function transfer(address to, uint256 amount) public pure override returns (bool) {
        revert("cannot transfer");
    }
}
