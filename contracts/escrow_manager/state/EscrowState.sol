// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

//On-chain saved state of the escrow
struct EscrowState {
    //Escrow was initialized at this blockheight
    uint64 initBlockheight;
    //Escrow was finalized (claim/refund) at this blockheight
    uint64 finishBlockheight;
    //Current state of the escrow
    uint8 state;
}

library EscrowStateImpl {

    //Optimized read function, that reads all the values at once
    function read(EscrowState storage self) view internal returns (uint64 initBlockheight, uint64 finishBlockheight, uint8 state) {
        //The following assembly is equivalent to:
        // initBlockheight = self.initBlockheight;
        // finishBlockheight = self.finishBlockheight;
        // state = self.state;
        assembly {
            let value := sload(self.slot) //All the data is stored at slot 0
            initBlockheight := and(value, 0xffffffffffffffff)
            finishBlockheight := and(shr(64, value), 0xffffffffffffffff)
            state := byte(15, value)
        }
    }

    //Optimized write function that writes all the values at once
    function write(EscrowState storage self, uint64 initBlockheight, uint64 finishBlockheight, uint8 state) internal {
        //The following assembly is equivalent to:
        // self.initBlockheight = initBlockheight;
        // self.finishBlockheight = finishBlockheight;
        // self.state = state;
        assembly {
            let value := or(
                or(
                    initBlockheight,
                    shl(64, finishBlockheight)
                ),
                shl(128, state)
            )
            sstore(self.slot, value)
        }
    }

}