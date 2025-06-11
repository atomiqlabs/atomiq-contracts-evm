// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Endianness.sol";

contract EndiannessWrapper {
    function reverseUint32(uint32 input) external pure returns (uint32) {
        return Endianness.reverseUint32(input);
    }
    function reverseUint64(uint64 input) external pure returns (uint64) {
        return Endianness.reverseUint64(input);
    }
    function reverseBytes32(bytes32 input) external pure returns (bytes32) {
        return Endianness.reverseBytes32(input);
    }
}
