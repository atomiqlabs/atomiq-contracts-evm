import { fromBuffer, toBuffer } from "./buffer_utils";


const TIMESPAN_TARGET = 14n * 24n * 60n * 60n;
const TIMESPAN_TARGET_DIV4 = TIMESPAN_TARGET / 4n;
const TIMESPAN_TARGET_MUL4 = TIMESPAN_TARGET * 4n;

function unsignedNot(x: bigint, bits: number): bigint {
  const mask = (1n << BigInt(bits)) - 1n; // e.g., 0xFF for 8 bits
  return (~x) & mask;
}

export function nbitsToTarget(nbits: bigint | string | Buffer): bigint {
    const nbitsBuff = typeof(nbits)==="string" ? Buffer.from(nbits, "hex") :
        typeof(nbits)==="bigint" ? toBuffer(nbits, 4, "be") : nbits;
    
    let result = 0n;
    for(let i = 0; i<3; i++) {
        result |= BigInt(nbitsBuff[3-i]) << BigInt((nbitsBuff[0]+i-3)*8);
    }
    return result;
}

export function targetTonBits(target: bigint): bigint {
    const targetBuff = toBuffer(target, 32, "be");
    const nbitsBuff = Buffer.alloc(4);

    let firstNonZeroIndex = 0;
    for(let i=0;i<targetBuff.length;i++) {
        if(targetBuff[i] !== 0) {
            firstNonZeroIndex = i;
            break;
        }
    }

    if((targetBuff[firstNonZeroIndex] & 0x80) === 0x80) firstNonZeroIndex--;

    nbitsBuff[1] = targetBuff[firstNonZeroIndex];
    nbitsBuff[2] = targetBuff[firstNonZeroIndex+1];
    nbitsBuff[3] = targetBuff[firstNonZeroIndex+2];

    nbitsBuff[0] = targetBuff.length-firstNonZeroIndex;

    return BigInt("0x"+nbitsBuff.toString("hex"));
}

export function computeNewTarget(target: bigint, epochStartTimestamp: number, prevBlockTimestamp: number) {
    let timespan = BigInt(prevBlockTimestamp - epochStartTimestamp);

    //Difficulty increase/decrease multiples are clamped between 0.25 (-75%) and 4 (+300%)
    if(timespan < TIMESPAN_TARGET_DIV4) {
        timespan = TIMESPAN_TARGET_DIV4;
    }
    if(timespan > TIMESPAN_TARGET_MUL4) {
        timespan = TIMESPAN_TARGET_MUL4;
    }

    return target * timespan / TIMESPAN_TARGET;
}

//TODO: Check if this works
export function getDifficulty(target: bigint): bigint {
    return (unsignedNot(target, 256) / (target + 1n)) + 1n;
}
