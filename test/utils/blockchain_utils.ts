
import {createHash, randomBytes} from "crypto";
import { fromBuffer, toBuffer } from "./buffer_utils";
import { computeNewTarget, getDifficulty, nbitsToTarget, targetTonBits } from "./nbits";
import { BitcoindBlockheader } from "./bitcoin_rpc_utils";

export function mineBitcoinBlock(
    previousBlockhash: string, 
    timestampNumber: number,
    nbits: string | bigint,
    epochStartTimestamp: number, 
    previousChainwork: string | bigint = "0", 
    previousBlockheight: number = -1, 
    targetnBits: string | bigint = nbits, 
    merkleRoot: string = randomBytes(32).toString("hex"),
    previousBlockTimestamps?: number[],
    previousTimestamp?: number
): BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]} {
    const nbitsBuffer = Buffer.from(nbits.toString(16), "hex");
    const realTarget = nbitsToTarget(nbitsBuffer);
    const target = nbitsToTarget(Buffer.from(targetnBits.toString(16), "hex"));

    const previousChainworkBN = typeof(previousChainwork)==="bigint" ? previousChainwork : BigInt("0x"+previousChainwork);

    const blockheaderBuffer = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from(previousBlockhash, "hex").reverse(),
        Buffer.from(merkleRoot, "hex").reverse(),
        toBuffer(timestampNumber, 4, "le"),
        Buffer.from(nbitsBuffer).reverse(),
        Buffer.alloc(4)
    ]);

    let hash: Buffer = Buffer.alloc(0);
    let found = false;
    let version: number = 0;
    for(let e=0;e<Math.pow(2, 32);e++) {
        blockheaderBuffer.writeUint32LE(e, 0);
        version = e;
        for(let i=0;i<Math.pow(2, 32);i++) {
            blockheaderBuffer.writeUInt32LE(i, 76);
            hash = createHash("sha256").update(createHash("sha256").update(blockheaderBuffer).digest()).digest();
            const hashBN = fromBuffer(hash, "le");
            if(hashBN < target) {
                found = true;
                break;
            }
        }
        if(found) break;
    }
    // console.log("blockheader: ", blockheaderBuffer.toString("hex"));

    const height = previousBlockheight+1;

    const difficulty = getDifficulty(realTarget);

    if(previousBlockTimestamps!=null) {
        previousBlockTimestamps = [...previousBlockTimestamps];
        previousBlockTimestamps.shift();
        previousBlockTimestamps.push(previousTimestamp);
    }

    return {
        hash: hash.reverse().toString("hex"),
        version,
        previousblockhash: previousBlockhash,
        merkleroot: merkleRoot,
        time: timestampNumber,
        bits: nbitsBuffer.toString("hex"),
        nonce: blockheaderBuffer.readUInt32LE(76),
        chainwork: (previousChainworkBN + difficulty).toString(16).padStart(64, "0"),
        height,
        epochstart: height % 2016 === 0 ? timestampNumber : epochStartTimestamp,
        confirmations: null,
        versionHex: toBuffer(version, 4, "le").toString("hex"),
        mediantime: null,
        difficulty: Number(difficulty),
        nTx: null,
        nextblockhash: null,
        previousBlockTimestamps
    };
}

export function mineBitcoinBlockAfter(previousBlock: BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]}, timestampNumber: number): BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]} {
    return mineBitcoinBlock(previousBlock.hash, timestampNumber, previousBlock.bits, previousBlock.epochstart, previousBlock.chainwork, previousBlock.height, undefined, undefined, previousBlock.previousBlockTimestamps, previousBlock.time);
}

export function createBitcoinChain(blocks: (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]})[], deltaTimestamp: number, length: number): (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]})[] {
    let startingBlock = blocks[blocks.length-1];
    let timestamp = startingBlock.time;

    for(let i=0;i<length;i++) {
        timestamp += deltaTimestamp;
        if(startingBlock.height % 2016 === 2015) {
            const oldTarget = nbitsToTarget(Buffer.from(startingBlock.bits, "hex"));
            const newTarget = computeNewTarget(oldTarget, startingBlock.epochstart, startingBlock.time);
            const newnBits = targetTonBits(newTarget);
            startingBlock = mineBitcoinBlock(startingBlock.hash, timestamp, newnBits, startingBlock.epochstart, startingBlock.chainwork, startingBlock.height, undefined, undefined, startingBlock.previousBlockTimestamps, startingBlock.time)
        } else {
            startingBlock = mineBitcoinBlockAfter(startingBlock, timestamp);
        }

        blocks.push(startingBlock);
    }

    return blocks;
}

export function getPrevBlockTimestamps(headers: BitcoindBlockheader[], height: number): number[] {
    const timestamps: number[] = [];
    for(let i=height-10;i<height;i++) {
        timestamps.push(i<0 ? headers[0].time : headers[i].time);
    }
    return timestamps;
}

