// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Nbits.sol";

contract NbitsWrapper {

    function toTarget(uint256 reversedNbits) pure public returns (uint256) {
        return Nbits.toTarget(reversedNbits);
    }
    function toReversedNbits(uint256 target) pure public returns (uint256) {
        return Nbits.toReversedNbits(target);
    }

}
