// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ReputationState.sol";

contract ReputationStateWrapper {
    ReputationState _self;

    function update(ReputationState memory self, uint256 amount) external returns (ReputationState memory) {
        _self = self;
        ReputationStateImpl.update(_self, amount);
        return _self;
    }

    function read() external view returns (ReputationState memory) {
        return _self;
    }

}
