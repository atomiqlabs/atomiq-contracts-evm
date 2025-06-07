// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../common/IClaimHandler.sol";

contract DummyClaimHandler is IClaimHandler {
    
    function claim(bytes32 claimData, bytes calldata witness) pure external returns (bytes memory witnessResult) {
        bytes32 witnessBytes;
        assembly {
            witnessBytes := calldataload(witness.offset)
        }
        require(claimData == witnessBytes, "dummyClaimHandler: bad witness");
        return witness;
    }

}
