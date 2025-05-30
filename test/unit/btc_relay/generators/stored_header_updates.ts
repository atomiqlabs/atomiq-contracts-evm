import {randomBytes} from "crypto";
import { randomUnsignedBigInt } from "../../../utils/random";
import { createBitcoinChain, mineBitcoinBlock } from "../../../utils/blockchain_utils";
import { BitcoindBlockheader, getBlockheader } from "../../../utils/bitcoin_rpc_utils";

function shuffle<T>(array: T[]): T[] {
    let currentIndex = array.length;
  
    // While there remain elements to shuffle...
    while (currentIndex != 0) {
  
      // Pick a remaining element...
      let randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
  
      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }

    return array;
}
const getRandomTimestamp = () => Math.floor(Math.random() * (Date.now()/1000));
const getRandomEpoch = () => Math.floor(500 * Math.random());
const getRandomnBits = () => {
    const randBytes = randomBytes(3);
    if(randBytes[0] >= 0x10) randBytes[0] = 0x10;
    return "1f"+randBytes.toString("hex");
};
const getRandomChainwork = () => randomUnsignedBigInt(256) >> BigInt(32 + Math.floor(224 * Math.random()));
const getRandomBlockheight = () => {
    let initialHeight = Math.floor(Math.random() * 1000000);
    if(initialHeight % 2016 === 2015) initialHeight++;
    return initialHeight;
};


export function generateRandomValidBlockUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const blocksFromEpochStart = initialHeight % 2016
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        getRandomnBits(), initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    const blocks = createBitcoinChain([initialBlock], 300 + Math.floor(1200 * Math.random()), 1);

    return [blocks[0], blocks[1]];
}

export function generateRandomPoWAdjustmentBlockUpdate(avgBlockTime = 550) {
    const initialTimestamp = getRandomTimestamp();
    const epoch = getRandomEpoch();
    const initialHeight = epoch * 2016 + 2015;

    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        getRandomnBits(), initialTimestamp - (2015 * avgBlockTime), getRandomChainwork(), initialHeight-1
    );
    const blocks = createBitcoinChain([initialBlock], 300 + Math.floor(1200 * Math.random()), 1);

    return [blocks[0], blocks[1]];
}

export function generateRandomInvalidPoWUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        "1f00ffff", initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    const endBlock = mineBitcoinBlock(
        initialBlock.hash, initialBlock.time + 300 + Math.floor(1200 * Math.random()),
        initialBlock.bits, initialBlock.epochstart, initialBlock.chainwork, initialBlock.height, "1f7fffff" //Use valid nBits in the blockheader but mine with lower difficulty
    );

    return [initialBlock, endBlock];
}

export function generateRandomInvalidnBitsUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        "1f19ffff", initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    const endBlock = mineBitcoinBlock(
        initialBlock.hash, initialBlock.time + 300 + Math.floor(1200 * Math.random()),
        "1f4fffff", initialBlock.epochstart, initialBlock.chainwork, initialBlock.height //Introduce invalid nbits to the blockheader
    );

    return [initialBlock, endBlock];
}

export function generateRandomInvalidnBitsDiffAdjustmentUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = (getRandomEpoch() * 2016) + 2015;

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        "1f19ffff", initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    const endBlock = mineBitcoinBlock(
        initialBlock.hash, initialBlock.time + 300 + Math.floor(1200 * Math.random()),
        "1f4fffff", initialBlock.epochstart, initialBlock.chainwork, initialBlock.height //Introduce invalid nbits to the blockheader
    );

    return [initialBlock, endBlock];
}

export function generateRandomInvalidPrevBlockhashUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        getRandomnBits(), initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    const endBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialBlock.time + 300 + Math.floor(1200 * Math.random()), //Don't reference the last block correctly
        initialBlock.bits, initialBlock.epochstart, initialBlock.chainwork, initialBlock.height
    );

    return [initialBlock, endBlock];
}

export function generateRandomValidTimestampMedianUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const previousBlockTimestamps = [];
    previousBlockTimestamps[9] = initialTimestamp - (300 + Math.floor(Math.random() * 900));
    for(let i=8;i>=0;i--) {
        previousBlockTimestamps[i] = previousBlockTimestamps[i+1] - (300 + Math.floor(Math.random() * 900));
    }
    const medianTimestamp = previousBlockTimestamps[5];

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        getRandomnBits(), initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    )
    initialBlock.previousBlockTimestamps = shuffle(previousBlockTimestamps);
    
    const endBlock = mineBitcoinBlock(
        initialBlock.hash, medianTimestamp + 300 + Math.floor(Math.random() * 200), //Make sure this block is mined after the median timestamp
        initialBlock.bits, initialBlock.epochstart, initialBlock.chainwork, initialBlock.height, undefined, undefined, previousBlockTimestamps, initialBlock.time
    );

    return [initialBlock, endBlock];
}

export function generateRandomInvalidTimestampMedianUpdate() {
    const initialTimestamp = getRandomTimestamp();
    const initialHeight = getRandomBlockheight();

    const previousBlockTimestamps = [];
    previousBlockTimestamps[9] = initialTimestamp - (300 + Math.floor(Math.random() * 900));
    for(let i=8;i>=0;i--) {
        previousBlockTimestamps[i] = previousBlockTimestamps[i+1] - (300 + Math.floor(Math.random() * 900));
    }
    const medianTimestamp = previousBlockTimestamps[5];

    const blocksFromEpochStart = initialHeight % 2016;
    const initialBlock = mineBitcoinBlock(
        randomBytes(32).toString("hex"), initialTimestamp, 
        getRandomnBits(), initialTimestamp - (blocksFromEpochStart*600), getRandomChainwork(), initialHeight-1
    );
    initialBlock.previousBlockTimestamps = shuffle(previousBlockTimestamps);

    const endBlock = mineBitcoinBlock(
        initialBlock.hash, medianTimestamp - 300 - Math.floor(Math.random() * 200), //Make sure this block is mined before the median timestamp, therefore invalid
        initialBlock.bits, initialBlock.epochstart, initialBlock.chainwork, initialBlock.height, undefined, undefined, previousBlockTimestamps, initialBlock.time
    );

    return [initialBlock, endBlock];
}

export async function generateRealValidBlockUpdate(initHeight: number): Promise<(BitcoindBlockheader & {epochstart: number})[]> {
    const startBlockheader: any = await getBlockheader(initHeight);
    const endBlockheader: any = await getBlockheader(initHeight+1);

    const epochStartHeight = Math.floor(initHeight / 2016) * 2016;
    let epochStartBlock = await getBlockheader(epochStartHeight);
    if(initHeight % 2016 == 2015) {
        startBlockheader.epochstart = epochStartBlock.time;
        endBlockheader.epochstart = endBlockheader.time;
    } else {
        startBlockheader.epochstart = epochStartBlock.time;
        endBlockheader.epochstart = epochStartBlock.time;
    }

    return [startBlockheader, endBlockheader];
}




