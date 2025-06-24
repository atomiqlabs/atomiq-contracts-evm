import { createBitcoinChain, mineBitcoinBlock } from "../../utils/blockchain_utils";


export function generateMainChain() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000);

    return createBitcoinChain(
        [genesis],
        600,
        20
    );
}

export function generateMainChainWithDiffAdjustment() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000-(1900*600), undefined, 1900);

    return createBitcoinChain(
        [genesis],
        600,
        130
    );
}

export function generateSuccessfulFork() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000);

    //Create canonical chain of 20 blocks
    const cannonicalChain = createBitcoinChain(
        [genesis],
        600,
        20
    );

    //Create fork at blockheight 4, i.e. block 5 is the first different block
    const forkChain = createBitcoinChain(
        cannonicalChain.slice(0, 5),
        600,
        20
    );

    return {cannonicalChain, forkChain: forkChain.slice(4)};
}

export function generateSuccessfulForkWithMoreChainwork() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000-(1900*600), undefined, 1900);

    //Create a canonical chain of 2201 blocks mined at usual speed
    //Total timespan = 600 * 2015 = 1209000
    const cannonicalChain = createBitcoinChain(
        [genesis],
        600,
        115 + 20
    );

    //Create fork at blockheight 1900, i.e. block 1901 is the first different block
    //The fork is mined extremely fast compared to cannonical chain
    //Total timestpan = 600 * 1900 + 1 * 115 = 1140115
    //The difficulty should be ~5% higher here, so we can ovewrite a chain of 20 blocks, with 19 blocks
    const forkChain = createBitcoinChain(
        [genesis],
        1,
        115 + 19
    );

    return {cannonicalChain: cannonicalChain, forkChain: forkChain};
}

export function generateSuccessfulForkWithMoreChainworkAndForkFromFutureHeight() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000-(1900*600), undefined, 1900);

    //Create a canonical chain of 2201 blocks mined at usual speed
    //Total timespan = 600 * 2015 = 1209000
    const cannonicalChain = createBitcoinChain(
        [genesis],
        600,
        115 + 20
    );

    //Create fork at blockheight 1900, i.e. block 1901 is the first different block
    //The fork is mined extremely fast compared to cannonical chain
    //Total timestpan = 600 * 1900 + 1 * 115 = 1140115
    //The difficulty should be ~5% higher here, so we can ovewrite a chain of 20 blocks, with 19 blocks
    const forkChain1 = createBitcoinChain(
        [genesis],
        1,
        115 + 19
    );

    //Now create a second fork, starting from the tip of the previous cannonical chain, which is now a future blockheight after the 1st reorg
    const forkChain2 = createBitcoinChain(
        [cannonicalChain[cannonicalChain.length-1]],
        600,
        5
    );

    return {cannonicalChain: cannonicalChain, forkChain1, forkChain2};
}

export function generateInvalidForkNotEnoughLength() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000);

    //Create canonical chain of 20 blocks
    const cannonicalChain = createBitcoinChain(
        [genesis],
        600,
        20
    );

    //Create fork at blockheight 9, i.e. block 10 is the first different block
    const forkChain = createBitcoinChain(
        cannonicalChain.slice(0, 10),
        600,
        5
    );

    return {cannonicalChain, forkChain: forkChain.slice(9)};
}

export function generateInvalidForkNotEnoughChainwork() {
    const genesis = mineBitcoinBlock(Buffer.alloc(32).toString("hex"), 1500000000, "1f7fffff", 1500000000-(600*1900), undefined, 1900);

    //Create a canonical chain of 2201 blocks mined at usual speed
    //Total timespan = 600 * 2015 = 1209000
    const cannonicalChain = createBitcoinChain(
        [genesis],
        600,
        115 + 8
    );

    //Create fork at blockheight 1900, i.e. block 1901 is the first different block
    //The fork is mined extremely slowly compared to cannonical chain
    //Total timespan = 600 * 1900 + 2400 * 115 = 1416000
    //The difficulty should therefore be ~14% lower here, so we need a chain of 10 blocks,
    // to overwrite a cannonical chain with 8 blocks
    //So if we mine just 9 blocks on the fork, it should not be enough to overrun
    // the canonical chain with 8 blocks, even though fork is longer
    const forkChain = createBitcoinChain(
        [genesis],
        2400,
        115+9
    );

    return {cannonicalChain: cannonicalChain, forkChain: forkChain};
}
