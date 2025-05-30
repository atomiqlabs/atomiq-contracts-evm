import { getBlockheader } from "../../../utils/bitcoin_rpc_utils";
import { getDifficulty, nbitsToTarget } from "../../../utils/nbits";
import {randomBytes} from "crypto";

export async function generateComputeNewTargetTest(epoch: number): Promise<{
    timestampStart: number,
    timestampEnd: number,
    oldNbits: bigint,
    oldTarget: bigint,
    newNbits: bigint
}> {
    const epochStartHeight = epoch * 2016;
    const epochEndHeight = epochStartHeight + 2015;
    const nextEpochHeight = epochEndHeight + 1;

    const epochStart = await getBlockheader(epochStartHeight);
    const epochEnd = await getBlockheader(epochEndHeight);
    const nextEpoch = await getBlockheader(nextEpochHeight);

    const timestampStart = epochStart.time;
    const timestampEnd = epochEnd.time;

    const epochTarget = nbitsToTarget(epochStart.bits);

    return {
        timestampStart,
        timestampEnd,
        oldNbits: BigInt("0x"+epochStart.bits),
        oldTarget: epochTarget,
        newNbits: BigInt("0x"+nextEpoch.bits)
    }
}

export async function generateGetChainworkTest(height: number): Promise<{
    nbits: bigint,
    target: bigint,
    chainwork: bigint
}> {
    const initial = await getBlockheader(height - 1);
    const next = await getBlockheader(height);

    const initialChainwork = BigInt("0x"+initial.chainwork);
    const nextChainwork = BigInt("0x"+next.chainwork);
    const chainwork = nextChainwork - initialChainwork;

    const nextBlockTarget = nbitsToTarget(Buffer.from(next.bits, "hex"));
    
    return {
        nbits: BigInt("0x"+next.bits),
        target: nextBlockTarget,
        chainwork: chainwork
    };
}

export function generateGetChainworkRandomTest(): {
    target: bigint,
    chainwork: bigint
} {
    const target = BigInt("0x"+randomBytes(32).toString("hex")) >> BigInt(Math.floor(224 * Math.random()));
    const chainwork = getDifficulty(target);
    
    return {
        target,
        chainwork
    };
}
