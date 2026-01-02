// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

event Event(bytes data);
event PayableEvent(uint256 value, bytes data);

contract DummyContract {

    function doNothing() external payable {}

    function call(bytes calldata data) external {
        emit Event(data);
    }

    function callReturning(bytes calldata data) external payable returns (bytes memory) {
        return data;
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

    function burnVariableCycles(uint256 iterations) external payable {
        assembly {
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

    function burn10k() external payable {
        assembly {
            let iterations := 276
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

    function burn100k() external payable {
        assembly {
            let iterations := 2849
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

    function burn1m() external payable {
        assembly {
            let iterations := 28565
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

    function burn5m() external payable {
        assembly {
            let iterations := 142857
            for { } gt(iterations, 0) { iterations := sub(iterations, 1) } {}
        }
    }

}