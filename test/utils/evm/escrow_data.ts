import { randomUnsignedBigInt } from "../random";
import { randomAddress, randomBytes32 } from "./utils";
import hre from "hardhat";

export type EscrowDataType = {
    offerer: string,
    claimer: string,
    token: string,
    refundHandler: string,
    claimHandler: string,
    flags: bigint,
    claimData: string,
    refundData: string,
    amount: bigint,
    depositToken: string,
    securityDeposit: bigint,
    claimerBounty: bigint,
    successActionCommitment: string
};

export function getRandomEscrowData() {
    return {
        offerer: randomAddress(),
        claimer: randomAddress(),
        token: randomAddress(),
        refundHandler: randomAddress(),
        claimHandler: randomAddress(),
        flags: randomUnsignedBigInt(256),
        claimData: randomBytes32(),
        refundData: randomBytes32(),
        amount: randomUnsignedBigInt(256),
        depositToken: randomAddress(),
        securityDeposit: randomUnsignedBigInt(256),
        claimerBounty: randomUnsignedBigInt(256),
        successActionCommitment: randomBytes32()
    };
}

export function getEscrowHash(escrowData: EscrowDataType): string {
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address offerer, address claimer, uint256 amount, address token, uint256 flags, address claimHandler, bytes32 claimData, address refundHandler, bytes32 refundData, uint256 securityDeposit, uint256 claimerBounty, address depositToken, bytes32 successActionCommitment)"],
        [escrowData]
    );
    return hre.ethers.keccak256(encoded);
}
