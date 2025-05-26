// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

interface IRefundHandler {
    function refund(bytes32 refundData, bytes calldata witness) external view returns (bytes memory witnessResult);
}
