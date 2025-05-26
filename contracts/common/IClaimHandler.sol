// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

interface IClaimHandler {
    function claim(bytes32 claimData, bytes calldata witness) external view returns (bytes memory witnessResult);
}
