import {randomBytes} from "crypto";

export function randomUnsigned(bits: number): number {
    if(bits > 52) throw new Error("Maximum 52 bit numbers supported, use randomUnsignedBigInt() instead");
    return Math.floor(Math.random() * Math.pow(2, bits));
}

export function randomUnsignedBigInt(bits: number): bigint {
    return BigInt("0x"+randomBytes(Math.ceil(bits / 8)).toString("hex")) >> BigInt(bits % 8);
}
