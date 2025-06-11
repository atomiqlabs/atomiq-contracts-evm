// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./structs/SpvVaultParameters.sol";

library Events {
    event Opened(address indexed owner, uint256 indexed vaultId, bytes32 indexed btcTxHash, uint256 vout, SpvVaultParameters params);
    event Deposited(bytes32 indexed ownerAndVaultId, uint256 depositCount, uint256 amount0, uint256 amount1);
    event Claimed(bytes32 indexed ownerAndVaultId, address indexed recipient, bytes32 indexed btcTxHash, bytes32 executionHash, address frontingAddress, uint256 withdrawCount, uint256 amount0, uint256 amount1);
    event Closed(address indexed owner, uint256 indexed vaultId, bytes32 indexed btcTxHash, bytes error);
    event Fronted(bytes32 indexed ownerAndVaultId, address indexed recipient, bytes32 indexed btcTxHash, bytes32 executionHash, uint256 amount0, uint256 amount1);
}
