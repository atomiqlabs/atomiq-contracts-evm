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
