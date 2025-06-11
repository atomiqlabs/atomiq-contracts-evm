// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./BlockHeader.sol";

contract BlockHeaderWrapper {
    function verifyOutOfBounds(bytes calldata value, uint256 offset) pure public {
        BlockHeaderUtils.verifyOutOfBounds(value, offset);
    }

    function timestamp(bytes calldata value, uint256 offset) pure public returns (uint32) {
        return BlockHeaderUtils.timestamp(value, offset);
    }

    function reversedNbits(bytes calldata value, uint256 offset) pure public returns (uint32) {
        return BlockHeaderUtils.reversedNbits(value, offset);
    }
}