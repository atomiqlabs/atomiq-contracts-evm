
export function reverseUint32(value: number | bigint | string): bigint {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(Number(typeof(value)=="string" ? parseInt(value, 16) : value));
    return BigInt(buffer.readUInt32LE());
}
