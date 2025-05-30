// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../state/ReputationState.sol";
import "./ReputationTracker.sol";

contract ReputationTrackerWrapper is ReputationTracker {

    //Internal functions
    function ReputationTracker_updateReputation(uint256 reputationType, address claimer, address token, address claimHandler, uint256 amount) external {
        _ReputationTracker_updateReputation(reputationType, claimer, token, claimHandler, amount);
    }
    
}
