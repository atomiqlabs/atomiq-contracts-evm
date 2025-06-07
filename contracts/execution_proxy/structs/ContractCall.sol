// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct ContractCall {
    address target;
    uint256 value;
    bytes data;
}
