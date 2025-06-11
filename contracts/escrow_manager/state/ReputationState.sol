// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../utils/MathUtils.sol";

//On-chain saved reputation state
struct ReputationState {
    //Total amount of tokens processed
    uint224 amount;
    //Total count of swaps processed
    uint32 count;
}

library ReputationStateImpl {

    using MathUtils for uint32;
    using MathUtils for uint224;

    function read(ReputationState storage self) view internal returns (uint224 amount, uint32 count) {
        assembly {
            let value := sload(self.slot)
            amount := and(value, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
            count := shr(224, value)
        }
    }

    function write(ReputationState storage self, uint224 amount, uint32 count) internal {
        assembly {
            sstore(self.slot, or(amount, shl(224, count)))
        }
    }

    //Updates a reputation with the specified token amount and increment count by 1
    function update(ReputationState storage self, uint256 amount) internal {
        (uint224 _amount, uint32 _count) = read(self);
        write(self, _amount.saturatingAddUint224(amount), _count.saturatingAddOneUint32());
    }

}
