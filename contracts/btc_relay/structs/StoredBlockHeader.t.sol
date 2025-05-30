// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./StoredBlockHeader.sol";

contract StoredBlockHeaderWrapper {
    function fromCalldata(bytes calldata value, uint256 offset) pure external returns (StoredBlockHeader memory storedHeader) {
        return StoredBlockHeaderImpl.fromCalldata(value, offset);
    }
    function fromMemory(bytes memory value, uint256 offset) pure external returns (StoredBlockHeader memory storedHeader) {
        return StoredBlockHeaderImpl.fromMemory(value, offset);
    }
    function header_version(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.header_version(storedHeader);
    }
    function header_previousBlockhash(StoredBlockHeader memory storedHeader) pure external returns (bytes32) {
        return StoredBlockHeaderImpl.header_previousBlockhash(storedHeader);
    }
    function header_merkleRoot(StoredBlockHeader memory storedHeader) pure external returns (bytes32) {
        return StoredBlockHeaderImpl.header_merkleRoot(storedHeader);
    }
    function header_timestamp(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.header_timestamp(storedHeader);
    }
    function header_reversedNbits(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.header_reversedNbits(storedHeader);
    }
    function header_nonce(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.header_nonce(storedHeader);
    }
    function chainWork(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.chainWork(storedHeader);
    }
    function blockHeight(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.blockHeight(storedHeader);
    }
    function lastDiffAdjustment(StoredBlockHeader memory storedHeader) pure external returns (uint256) {
        return StoredBlockHeaderImpl.lastDiffAdjustment(storedHeader);
    }
    function previousBlockTimestamps(StoredBlockHeader memory storedHeader) pure external returns (uint256[10] memory) {
        return StoredBlockHeaderImpl.previousBlockTimestamps(storedHeader);
    }
    function header_blockhash(StoredBlockHeader memory storedHeader) view external returns (bytes32) {
        return StoredBlockHeaderImpl.header_blockhash(storedHeader);
    }
    function hash(StoredBlockHeader memory storedHeader) view external returns (bytes32) {
        return StoredBlockHeaderImpl.hash(storedHeader);
    }
    function updateChain(StoredBlockHeader memory storedHeader, bytes calldata headers, uint256 offset, uint256 timestamp, bool clampTarget) view external returns (bytes32, StoredBlockHeader memory) {
        bytes32 newBlockHash = StoredBlockHeaderImpl.updateChain(storedHeader, headers, offset, timestamp, clampTarget);
        return (newBlockHash, storedHeader);
    }
}