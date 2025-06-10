// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct SpvVaultParameters {
    address btcRelayContract;
    address token0;
    address token1;

    uint256 token0Multiplier;
    uint256 token1Multiplier;
    
    uint8 confirmations;
}

library SpvVaultParametersImpl {
    
    function hash() pure internal returns (bytes32 paramsHash) {
        paramsHash = keccak256(abi.encode(paramsHash));
    }

}
