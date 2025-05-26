// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../state/ReputationState.sol";

struct ReputationQuery {
    address owner;
    address token;
    address claimHandler;
}

interface IReputationTracker {
    //Returns the LP reputations, data is in format (owner, token, claimHandler)
    function getState(ReputationQuery[] calldata data) external view returns (ReputationState[3][] memory result);
}

contract ReputationTracker is IReputationTracker {

    uint256 public constant REPUTATION_SUCCESS = 0;
    uint256 public constant REPUTATION_COOP_REFUND = 1;
    uint256 public constant REPUTATION_FAILED = 2;

    using ReputationStateImpl for ReputationState;

    mapping(address => mapping(address => mapping(address => ReputationState[3]))) _reputation;

    //Public external functions
    function getState(ReputationQuery[] calldata data) external view returns (ReputationState[3][] memory result) {
        result = new ReputationState[3][](data.length);
        for(uint i = 0; i < data.length; i++) {
            result[i] = _reputation[data[i].owner][data[i].token][data[i].claimHandler];
        }
    }

    //Internal functions
    function _ReputationTracker_updateReputation(uint256 reputationType, address claimer, address token, address claimHandler, uint256 amount) internal {
        ReputationState memory reputation = _reputation[claimer][token][claimHandler][reputationType];
        reputation.update(uint224(amount));
        _reputation[claimer][token][claimHandler][reputationType] = reputation;
    }
    
}
