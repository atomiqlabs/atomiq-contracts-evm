import {randomBytes} from "crypto";
import { toBuffer } from "../buffer_utils";
import { ethers } from "hardhat";

export function randomAddress(): string {
    return "0x"+randomBytes(20).toString("hex");
}

export function randomBytes32(): string {
    return "0x"+randomBytes(32).toString("hex");
}

export function toBytes32(value: bigint) {
    return "0x"+value.toString(16).padStart(64, "0");
}

export function structToArray(obj: any): any[] {
    return Object.keys(obj).map(key => obj[key]);
}

export function packAddressAndVaultId(address: string, vaultId: bigint): string {
    return "0x"+Buffer.concat([
        Buffer.from(address.substring(2), "hex"),
        toBuffer(vaultId, 12, "be")
    ]).toString("hex");
}

export function getExecutionSalt(address: string, creatorSalt: string | Buffer): string {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [address, creatorSalt]));
}

export const TRANSFER_OUT_MAX_GAS = 40_000;
