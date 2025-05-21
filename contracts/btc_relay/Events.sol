pragma solidity ^0.8.28;

library Events {
    event StoreHeader(bytes32 indexed commitHash, bytes32 indexed blockHash);
    event StoreForkHeader(bytes32 indexed commitHash, bytes32 indexed blockHash, uint256 indexed forkId, bytes data);
    event ChainReorg(bytes32 indexed commitHash, bytes32 indexed blockHash, uint256 indexed forkId, address submitter, uint256 startHeight);
}
