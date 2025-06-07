// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

event Event(bytes data);
event PayableEvent(uint256 value, bytes data);

contract DummyContract {

    function call(bytes calldata data) external {
        emit Event(data);
    }

    function callPayable(bytes calldata data) external payable {
        emit PayableEvent(msg.value, data);
    }

    function callRevert(string calldata reason) pure external {
        revert(reason);
    }

    function outOfGas() pure external {
        uint256 i;
        while(true) i++;
    }

}