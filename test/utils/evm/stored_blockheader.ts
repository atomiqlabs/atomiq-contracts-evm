import { BitcoindBlockheader } from "../bitcoin_rpc_utils";
import {ethers} from "hardhat";

export function serializeStoredBlockheader(
    version: number,
    prevBlockHash: string | Buffer,
    merkleRoot: string | Buffer,
    timestamp: number,
    nbits: number | string,
    nonce: number,
    chainwork: string | bigint,
    blockHeight: number,
    lastDiffAdjustment?: number,
    prevBlockTimestamps?: number[]
): Buffer {
    const buffer = Buffer.alloc(160);
    buffer.writeUInt32LE(version, 0);
    (typeof(prevBlockHash)==="string" ? Buffer.from(prevBlockHash, "hex") : Buffer.from([...prevBlockHash])).reverse().copy(buffer, 4, 0, 32);
    (typeof(merkleRoot)==="string" ? Buffer.from(merkleRoot, "hex") : Buffer.from([...merkleRoot])).reverse().copy(buffer, 36, 0, 32);
    buffer.writeUInt32LE(timestamp, 68);
    buffer.writeUInt32LE(typeof(nbits)==="string" ? parseInt(nbits, 16) : nbits, 72);
    buffer.writeUInt32LE(nonce, 76);
    Buffer.from(chainwork.toString(16).padStart(64, "0"), "hex").copy(buffer, 80, 0, 32);
    buffer.writeUInt32BE(blockHeight, 112);
    buffer.writeUInt32BE(lastDiffAdjustment ?? timestamp, 116);
    for(let i=0;i<10;i++) {
        const num = prevBlockTimestamps?.[i] ?? timestamp - (i+1)*600;
        buffer.writeUInt32BE(num, 120+(i*4));
    }
    return buffer;
}

export function serializeBitcoindStoredBlockheader(
    data: BitcoindBlockheader & {epochstart?: number, previousBlockTimestamps?: number[]},
): Buffer {
    return serializeStoredBlockheader(data.version, data.previousblockhash, data.merkleroot, data.time, data.bits, data.nonce, data.chainwork, data.height, data.epochstart, data.previousBlockTimestamps);
}

export function serializeBitcoindStoredBlockheaderToStruct(
    data: BitcoindBlockheader & {epochstart?: number, previousBlockTimestamps?: number[]},
): {data: [string, string, string, string, string]} {
    const rawData = serializeStoredBlockheader(data.version, data.previousblockhash, data.merkleroot, data.time, data.bits, data.nonce, data.chainwork, data.height, data.epochstart, data.previousBlockTimestamps);

    return {
        data: [
            "0x"+rawData.slice(0, 32).toString("hex"),
            "0x"+rawData.slice(32, 64).toString("hex"),
            "0x"+rawData.slice(64, 96).toString("hex"),
            "0x"+rawData.slice(96, 128).toString("hex"),
            "0x"+rawData.slice(128, 160).toString("hex"),
        ]
    }
}

export function hashBitcoindStoredBlockheader(
    data: BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]}
) {
    return ethers.keccak256(serializeBitcoindStoredBlockheader(data));
}
