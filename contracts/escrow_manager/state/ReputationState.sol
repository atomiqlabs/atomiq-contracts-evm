// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

//On-chain saved reputation state
struct ReputationState {
    //Total amount of tokens processed
    uint224 amount;
    //Total count of swaps processed
    uint32 count;
}

library ReputationStateImpl {

    //Updates a reputation with the specified token amount and increment count by 1
    function update(ReputationState memory self, uint224 amount) pure internal {
        //Saturating add
        unchecked {
            uint224 result = self.amount + amount;
            if (result < amount) result = type(uint224).max;
            self.amount = result;
        }
        if(self.count < type(uint32).max) self.count++;
    }

}
