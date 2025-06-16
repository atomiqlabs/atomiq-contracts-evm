// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct SpvVaultParameters {
    address btcRelayContract;
    address token0;
    address token1;

    uint192 token0Multiplier;
    uint192 token1Multiplier;
    
    uint256 confirmations;
}
uint256 constant SpvVaultParametersByteLength = 192;

library SpvVaultParametersImpl {
    
    function hash(SpvVaultParameters calldata self) pure internal returns (bytes32 paramsHash) {
        //The following assembly block is an equivalent to:
        // paramsHash = keccak256(abi.encode(self));
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            //We don't need to allocate memory properly here (with mstore(0x40, newOffset)), 
            // since we only use it as scratch-space for hashing, we can keep the free memory
            // pointer as-is
            // mstore(0x40, add(ptr, SpvVaultParametersByteLength))
            calldatacopy(ptr, self, SpvVaultParametersByteLength)
            paramsHash := keccak256(ptr, SpvVaultParametersByteLength)
        }
    }

    function fromRawToken0(SpvVaultParameters calldata self, uint64 amount0Raw) pure internal returns (uint256 result) {
        unchecked {
            result = uint256(self.token0Multiplier) * uint256(amount0Raw); //Cannot overflow due to multiplication between uint192 & uint64
        }
    }

    function fromRawToken1(SpvVaultParameters calldata self, uint64 amount1Raw) pure internal returns (uint256 result) {
        unchecked {
            result = uint256(self.token1Multiplier) * uint256(amount1Raw); //Cannot overflow due to multiplication between uint192 & uint64
        }
    }

    function fromRaw(SpvVaultParameters calldata self, uint64 amount0Raw, uint64 amount1Raw) pure internal returns (uint256 amount0, uint256 amount1) {
        amount0 = fromRawToken0(self, amount0Raw);
        amount1 = fromRawToken1(self, amount1Raw);
    }

}
