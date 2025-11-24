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

    function burn1m() pure external {
        assembly {
            let iterations := 28565
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

    function burn5m() pure external {
        assembly {
            let iterations := 142857
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

}