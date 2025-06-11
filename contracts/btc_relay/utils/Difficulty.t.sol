// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Difficulty.sol";

contract DifficultyWrapper {

    function computeNewTarget(uint32 prevTimestamp, uint32 startTimestamp, uint256 prevTarget) view public returns (uint256, uint256) {
        uint256 gasStart = gasleft();
        uint256 newTarget = Difficulty.computeNewTarget(prevTimestamp, startTimestamp, prevTarget);
        return (newTarget, gasStart-gasleft());
    }
    function computeNewTargetAlt(uint32 prevTimestamp, uint32 startTimestamp, uint32 prevNbits, bool clampTarget) view public returns (uint256, uint32, uint256) {
        uint256 gasStart = gasleft();
        (uint256 newTarget, uint32 newNbits) = Difficulty.computeNewTargetAlt(prevTimestamp, startTimestamp, prevNbits, clampTarget);
        return (newTarget, newNbits, gasStart-gasleft());
    }
    function getChainWork(uint256 target) pure public returns (uint256) {
        return Difficulty.getChainWork(target);
    }

}
