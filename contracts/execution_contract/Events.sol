// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library Events {
    event ExecutionCreated(address indexed owner, bytes32 indexed salt, bytes32 indexed executionHash);
    event ExecutionProcessed(address indexed owner, bytes32 indexed salt, bytes32 indexed executionHash, bool success, bytes error);
}
