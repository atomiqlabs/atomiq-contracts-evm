// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library Events {
    event Initialize(address indexed offerer, address indexed claimer, bytes32 indexed escrowHash, address claimHandler, address refundHandler);
    event Claim(address indexed offerer, address indexed claimer, bytes32 indexed escrowHash, address claimHandler, bytes witnessResult);
    event Refund(address indexed offerer, address indexed claimer, bytes32 indexed escrowHash, address refundHandler, bytes witnessResult);
    event ExecutionError(bytes32 indexed escrowHash, bytes error);
}
