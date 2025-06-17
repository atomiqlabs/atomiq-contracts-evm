import hre from "hardhat";
import { randomAddress, randomBytes32 } from "./utils";
import { randomUnsignedBigInt } from "../random";

export type Execution = {
    token: string,
    executionActionHash: string,
    amount: bigint,
    executionFee: bigint,
    expiry: bigint
}

export function getExecutionHash(execution: Execution) {
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address token, bytes32 executionActionHash, uint256 amount, uint256 executionFee, uint256 expiry)"],
        [execution]
    );
    return hre.ethers.keccak256(encoded);
}

export function getRandomExecution(): Execution {
    return {
        token: randomAddress(),
        executionActionHash: randomBytes32(),
        amount: randomUnsignedBigInt(256),
        executionFee: randomUnsignedBigInt(256),
        expiry: randomUnsignedBigInt(256)
    }
}