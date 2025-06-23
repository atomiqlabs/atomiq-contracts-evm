// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../utils/MathUtils.sol";
import "../structs/SpvVaultParameters.sol";

struct SpvVaultState {
    //Storage slot 0
    bytes32 spvVaultParametersCommitment;

    //Storage slot 1
    bytes32 utxoTxHash;

    //Storage slot 2
    uint32 utxoVout;
    uint32 openBlockheight; //Blockheight where this vault was opened, making it easy to then recover Opened event
    uint32 withdrawCount;
    uint32 depositCount;
    uint64 token0Amount;
    uint64 token1Amount;
}

library SpvVaultStateImpl {

    using MathUtils for uint32;
    using MathUtils for uint64;
    using SpvVaultParametersImpl for SpvVaultParameters;

    function isOpened(SpvVaultState storage self) view internal returns (bool opened) {
        opened = self.spvVaultParametersCommitment != bytes32(0x0);
    }

    function checkOpenedAndParams(SpvVaultState storage self, SpvVaultParameters calldata vaultParams) view internal {
        bytes32 commitment = self.spvVaultParametersCommitment;
        require(isOpened(self), "spvState: closed");
        require(commitment == vaultParams.hash(), "spvState: wrong params");
    }

    function open(SpvVaultState storage self, SpvVaultParameters calldata vaultParams, bytes32 utxoTxHash, uint32 utxoVout) internal {
        self.spvVaultParametersCommitment = vaultParams.hash();
        self.utxoTxHash = utxoTxHash;

        uint32 openBlockheight = uint32(block.number);
        uint256 value = uint256(utxoVout) | (uint256(openBlockheight) << 32);
        assembly {
            sstore(add(self.slot, 2), value)
        }

        // self.utxoVout = utxoVout;
        // self.openBlockheight = uint32(block.number);
        // self.withdrawCount = 0;
        // self.depositCount = 0;
        // self.token0Amount = 0;
        // self.token1Amount = 0;
    }

    function close(SpvVaultState storage self) internal {
        self.spvVaultParametersCommitment = bytes32(0x00);
    }

    function withdraw(SpvVaultState storage self, bytes32 btcTxHash, uint32 vout, uint64 rawAmount0, uint64 rawAmount1) internal returns (bool success, uint32 withdrawCount, string memory error) {
        uint256 value;
        uint64 _token0Amount;
        uint64 _token1Amount;
        uint32 _withdrawCount;
        assembly {
            value := sload(add(self.slot, 2))
            _token0Amount := and(shr(128, value), 0xffffffffffffffff)
            _token1Amount := and(shr(192, value), 0xffffffffffffffff)
            _withdrawCount := and(shr(64, value), 0xffffffff)
        }
        
        //Make sure subtraction doesn't overflow
        (bool token0AmountSuccess, uint64 token0Amount) = _token0Amount.checkedSubUint64(rawAmount0);
        if(!token0AmountSuccess) return (false, _withdrawCount, "withdraw: amount 0");
        (bool token1AmountSuccess, uint64 token1Amount) = _token1Amount.checkedSubUint64(rawAmount1);
        if(!token1AmountSuccess) return (false, _withdrawCount, "withdraw: amount 1");
        withdrawCount = _withdrawCount.saturatingAddOneUint32();

        //Mask and pack to the value
        value = (value & 0x00000000000000000000000000000000ffffffff00000000ffffffff00000000) |
            (uint256(token1Amount) << 192) |
            (uint256(token0Amount) << 128) |
            (uint256(withdrawCount) << 64) |
            uint256(vout);
        
        //Update the state
        assembly {
            sstore(add(self.slot, 2), value)
        }
        // self.token0Amount = token0Amount;
        // self.token1Amount = token1Amount;
        // self.withdrawCount = _withdrawCount.saturatingAddOneUint32();
        // self.utxoVout = vout;

        self.utxoTxHash = btcTxHash;

        success = true;
    }

    function deposit(SpvVaultState storage self, uint64 rawAmount0, uint64 rawAmount1) internal returns (uint32 depositCount) {
        uint256 value;
        uint64 _token0Amount;
        uint64 _token1Amount;
        uint32 _depositCount;
        assembly {
            value := sload(add(self.slot, 2))
            _token0Amount := and(shr(128, value), 0xffffffffffffffff)
            _token1Amount := and(shr(192, value), 0xffffffffffffffff)
            _depositCount := and(shr(96, value), 0xffffffff)
        }

        _token0Amount += rawAmount0;
        _token1Amount += rawAmount1;
        depositCount = ++_depositCount;

        //Mask and pack to the value
        value = (value & 0x0000000000000000000000000000000000000000ffffffffffffffffffffffff) |
            (uint256(_token1Amount) << 192) |
            (uint256(_token0Amount) << 128) |
            (uint256(_depositCount) << 96);

        //Update the state
        assembly {
            sstore(add(self.slot, 2), value)
        }
    }

}
