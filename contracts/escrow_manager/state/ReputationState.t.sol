// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./ReputationState.sol";

contract ReputationStateWrapper {
    function update(ReputationState memory self, uint256 amount) pure external returns (ReputationState memory) {
        ReputationStateImpl.update(self, amount);
        return self;
    }
}
