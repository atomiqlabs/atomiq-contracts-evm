
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

contract InfiniteLoopContract {

    fallback() payable external {
        uint256 i;
        while(true) i++;
    }

}