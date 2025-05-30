
export function toBuffer(value: number | bigint, length: number, endianness: "le" | "be"): Buffer {
    let result: Buffer = Buffer.from(value.toString(16).padStart(length*2, "0"), "hex");
    if(endianness==="le") result.reverse();
    return result;
}

export function fromBuffer(bufferOrString: Buffer | string, endianness: "le" | "be"): bigint {
    const buffer: Buffer = typeof(bufferOrString)==="string" ? Buffer.from(bufferOrString, "hex") : Buffer.from([...bufferOrString]);
    if(endianness==="le") buffer.reverse();
    return BigInt("0x"+buffer.toString("hex"));
}