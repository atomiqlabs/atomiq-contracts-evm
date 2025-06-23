// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {SpvVaultParameters} from "./structs/SpvVaultParameters.sol";

library Events {
    event Opened(address indexed owner, uint96 indexed vaultId, bytes32 indexed btcTxHash, uint32 vout, SpvVaultParameters params);
    event Closed(address indexed owner, uint96 indexed vaultId, bytes32 indexed btcTxHash, bytes error);
    event Deposited(bytes32 indexed ownerAndVaultId, uint32 depositCount, uint64 amount0, uint64 amount1);
    event Claimed(bytes32 indexed ownerAndVaultId, address indexed recipient, bytes32 indexed btcTxHash, bytes32 executionHash, address frontingAddress, uint32 withdrawCount, uint64 amount0, uint64 amount1);
    event Fronted(bytes32 indexed ownerAndVaultId, address indexed recipient, bytes32 indexed btcTxHash, bytes32 executionHash, uint64 amount0, uint64 amount1);
}
