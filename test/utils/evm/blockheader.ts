import { BitcoindBlockheader } from "../bitcoin_rpc_utils";


export function serializeBlockheader(
    version: number,
    merkleRoot: string | Buffer,
    timestamp: number,
    nbits: number | string,
    nonce: number
): Buffer {
    const buffer = Buffer.alloc(48);
    buffer.writeUInt32LE(version, 0);
    (typeof(merkleRoot)==="string" ? Buffer.from(merkleRoot, "hex") : Buffer.from([...merkleRoot])).reverse().copy(buffer, 4, 0, 32);
    buffer.writeUInt32LE(timestamp, 36);
    buffer.writeUInt32LE(typeof(nbits)==="string" ? parseInt(nbits, 16) : nbits, 40);
    buffer.writeUInt32LE(nonce, 44);
    return buffer;
}

export function serializeBitcoindBlockheader(data: BitcoindBlockheader): Buffer {
    return serializeBlockheader(data.version, data.merkleroot, data.time, data.bits, data.nonce);
}
