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

    function read(EscrowState storage self) view internal returns (uint64 initBlockheight, uint64 finishBlockheight, uint8 state) {
        assembly {
            let value := sload(self.slot)
            initBlockheight := and(value, 0xffffffffffffffff)
            finishBlockheight := and(shr(64, value), 0xffffffffffffffff)
            state := byte(15, value)
        }
    }

    function write(EscrowState storage self, uint64 initBlockheight, uint64 finishBlockheight, uint8 state) internal {
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