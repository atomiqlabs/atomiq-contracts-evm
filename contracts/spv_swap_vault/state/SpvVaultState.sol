// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct SpvVaultState {
    //Storage slot 0
    bytes32 spvVaultParametersCommitment;

    //Dynamic variables
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

    function withdraw(SpvVaultState storage self, bytes32 btcTxHash, uint32 vout, uint64 rawAmount0, uint64 rawAmount1) internal returns (bool success, string memory error) {
        //Make sure subtraction doesn't overflow
        uint64 token0Amount = self.token0Amount;
        uint64 token1Amount = self.token1Amount;
        if(token0Amount < rawAmount0) return (false, "withdraw: amount 0");
        token0Amount -= rawAmount0;
        if(token1Amount < rawAmount1) return (false, "withdraw: amount 1");
        token1Amount -= rawAmount1;

        uint256 withdrawCount = self.withdrawCount;

        //Update the state
        self.token0Amount = token0Amount;
        self.token1Amount = token1Amount;
        self.withdrawCount++;
        self.utxoVout = vout;

        self.utxoTxHash = btcTxHash;

        success = true;
    }

    function close(SpvVaultState storage self) internal {
        self.spvVaultParametersCommitment = bytes32(0x00);
    }

    function deposit(SpvVaultState storage self, uint64 rawAmount0, uint64 rawAmount1) internal returns (uint256 depositCount) {
        self.token0Amount += rawAmount0;
        self.token1Amount += rawAmount1;
        depositCount = ++self.depositCount;
    }

}
