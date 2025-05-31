import {randomBytes} from "crypto";

export function randomAddress(): string {
    return "0x"+randomBytes(20).toString("hex");
}

export function randomBytes32(): string {
    return "0x"+randomBytes(32).toString("hex");
}

export function toBytes32(value: bigint) {
    return "0x"+value.toString(16).padStart(64, "0");
}
