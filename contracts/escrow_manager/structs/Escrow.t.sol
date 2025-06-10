// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Escrow.sol";
// import "hardhat/console.sol";

contract EscrowDataWrapper {
    function hash(EscrowData calldata self) pure external returns (bytes32 result) {
        // uint256 initGas = gasleft();
        result = EscrowDataImpl.hash(self);
        // console.log("Gas used: %s", initGas-gasleft());
    }
    function isPayIn(EscrowData calldata self) pure external returns (bool result) {
        return EscrowDataImpl.isPayIn(self);
    }
    function isPayOut(EscrowData calldata self) pure external returns (bool result) {
        return EscrowDataImpl.isPayOut(self);
    }
    function isTrackingReputation(EscrowData calldata self) pure external returns (bool result) {
        return EscrowDataImpl.isTrackingReputation(self);
    }
    function getTotalDeposit(EscrowData calldata self) pure external returns (uint256 amount) {
        return EscrowDataImpl.getTotalDeposit(self);
    }
}
