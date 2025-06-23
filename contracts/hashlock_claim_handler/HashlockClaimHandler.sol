// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IClaimHandler} from "../common/IClaimHandler.sol";

//Claim handler for hashlocks
//Claim data: C = bytes32 representation of the sha256 hash
//Witness: W = bytes32 representation of the preimage to the sha256 hash, sha256(W)==C
contract HashlockClaimHandler is IClaimHandler {
    
    function claim(bytes32 claimData, bytes calldata witness) external pure returns (bytes memory witnessResult) {
        require(witness.length==32, "hashlock: Invalid witness len");
        require(sha256(witness)==claimData, "hashlock: Invalid witness");
        witnessResult = witness;
    }

}
