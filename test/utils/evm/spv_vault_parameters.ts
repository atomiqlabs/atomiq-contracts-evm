import hre from "hardhat";
import { randomAddress } from "./utils";
import { randomUnsignedBigInt } from "../random";

export type SpvVaultParameters = {
    btcRelayContract: string;
    token0: string;
    token1: string;

    token0Multiplier: bigint;
    token1Multiplier: bigint;

    confirmations: bigint;
};

export function getSpvVaultParametersHash(struct: SpvVaultParameters) {
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address btcRelayContract, address token0, address token1, uint192 token0Multiplier, uint192 token1Multiplier, uint256 confirmations)"],
        [struct]
    );
    return hre.ethers.keccak256(encoded);
}

export function getRandomSpvVaultParameters(): SpvVaultParameters {
    return {
        btcRelayContract: hre.ethers.getAddress(randomAddress()),
        token0: hre.ethers.getAddress(randomAddress()),
        token1: hre.ethers.getAddress(randomAddress()),
        token0Multiplier: randomUnsignedBigInt(192),
        token1Multiplier: randomUnsignedBigInt(192),
        confirmations: randomUnsignedBigInt(256)
    };
}
