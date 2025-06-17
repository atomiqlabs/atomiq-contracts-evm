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

    //Optimized read function, that reads all the values at once
    function read(ReputationState storage self) view internal returns (uint224 amount, uint32 count) {
        //The following assembly is equivalent to:
        // count = self.count;
        // amount = self.amount;
        assembly {
            let value := sload(self.slot)
            count := shr(224, value)
            amount := and(value, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
        }
    }

    //Optimized write function that writes all the values at once
    function write(ReputationState storage self, uint224 amount, uint32 count) internal {
        //The following assembly is equivalent to:
        // self.count = count;
        // self.amount = amount;
        assembly {
            sstore(self.slot, or(
                shl(224, count),
                amount
            ))
        }
    }

    //Updates a reputation with the specified token amount and increment count by 1
    function update(ReputationState storage self, uint256 amount) internal {
        (uint224 _amount, uint32 _count) = read(self);
        write(self, _amount.saturatingAddUint224(amount), _count.saturatingAddOneUint32());
    }

}
