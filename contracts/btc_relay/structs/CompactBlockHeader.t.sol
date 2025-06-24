// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./CompactBlockHeader.sol";

contract CompactBlockHeaderWrapper {
    function verifyOutOfBounds(bytes calldata value, uint256 offset) pure public {
        CompactBlockHeaderImpl.verifyOutOfBounds(value, offset);
    }

    function timestamp(bytes calldata value, uint256 offset) pure public returns (uint32) {
        return CompactBlockHeaderImpl.timestamp(value, offset);
    }

    function nBitsLE(bytes calldata value, uint256 offset) pure public returns (uint32) {
        return CompactBlockHeaderImpl.nBitsLE(value, offset);
    }
}