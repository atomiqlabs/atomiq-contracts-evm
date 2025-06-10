// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct SpvVaultState {
    //Storage slot 0-1
    address btcRelayContract;
    address token0;
    address token1;
    uint8 confirmations;

    //Storage slot 2-3
    uint256 token0Multiplier;
    uint256 token1Multiplier;

    //Dynamic variables
    //Storage slot 4
    bytes32 utxoTxId;

    //Storage slot 5
    uint32 utxoVout;
    uint32 withdrawCount;
    uint32 depositCount;
    uint64 token0Amount;
    uint64 token1Amount;
}

