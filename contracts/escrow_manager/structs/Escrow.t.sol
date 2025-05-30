// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Escrow.sol";

contract EscrowDataWrapper {
    function getStructHash(EscrowData calldata self) pure external returns (bytes32 result) {
        return EscrowDataImpl.getStructHash(self);
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
