import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre, { ethers } from "hardhat";
import {randomBytes} from "crypto";
import { serializeBitcoindBlockheader, serializeBlockheader } from "../../utils/evm/blockheader";
import { BitcoindBlockheader, getBlockheader, randomBitcoinEpoch, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { reverseUint32 } from "../../utils/endianness";
import { generateComputeNewTargetTest, generateGetChainworkRandomTest, generateGetChainworkTest } from "./generators/difficulty";
import { nbitsToTarget, targetTonBits } from "../../utils/nbits";
import type {BtcRelay} from "../../../typechain-types/contracts/btc_relay/BtcRelay.sol/BtcRelay";
import { hashBitcoindStoredBlockheader, serializeBitcoindStoredBlockheader, serializeBitcoindStoredBlockheaderToStruct } from "../../utils/evm/stored_blockheader";
import { mineBitcoinBlock, mineRandomBitcoinBlock } from "../../utils/blockchain_utils";
import { generateInvalidForkNotEnoughChainwork, generateInvalidForkNotEnoughLength, generateMainChain, generateMainChainWithDiffAdjustment, generateSuccessfulFork, generateSuccessfulForkWithMoreChainwork, generateSuccessfulForkWithMoreChainworkAndForkFromFutureHeight } from "./generators/chains";
import { generateRandomInvalidnBitsDiffAdjustmentUpdate, generateRandomInvalidnBitsUpdate, generateRandomInvalidPoWUpdate, generateRandomInvalidPrevBlockhashUpdate, generateRandomInvalidTimestampMedianUpdate } from "./generators/stored_header_updates";

describe("BtcRelay", function () {
    async function deploy() {
        const BtcRelay = await hre.ethers.getContractFactory("BtcRelay");

        const [account1] = await hre.ethers.getSigners();

        function getMainKey(height: number) {
            return ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [
                    BigInt(height), 1n
                ])
            );
        }

        async function getMainCommitment(contract: BtcRelay, height: number) {
            return ethers.provider.getStorage(await contract.getAddress(), getMainKey(height));
        }

        function getForkKey(forkId: bigint) {
            return ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [
                    forkId, 
                    ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account1.address, 2n]))
                ])
            );
        }

        function getForkCommitmentKey(forkId: bigint, height: number) {
            return ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [
                    BigInt(height), getForkKey(forkId)
                ])
            );
        }

        async function getForkCommitment(contract: BtcRelay, forkId: bigint, height: number) {
            return ethers.provider.getStorage(await contract.getAddress(), getForkCommitmentKey(forkId, height));
        }

        async function getForkData(contract: BtcRelay, forkId: bigint): Promise<{startHeight: number, endHeight: number}> {
            const result = await ethers.provider.getStorage(await contract.getAddress(), BigInt(getForkKey(forkId)) + 1n);
            const buffer = Buffer.from(result.substring(2), "hex");
            return {
                startHeight: buffer.readUint32BE(28),
                endHeight: buffer.readUint32BE(24),
            }
        }

        async function submitMainAndAssert(contract: BtcRelay, headers: (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]})[]) {
            const promise = contract.submitMainBlockheaders(Buffer.concat([
                serializeBitcoindStoredBlockheader(headers[0]),
                ...headers.slice(1).map(header => serializeBitcoindBlockheader(header))
            ]));

            const lastHeader = headers[headers.length-1];

            //Make sure all events are emitted
            for(let i=1;i<headers.length;i++) {
                const header = headers[i];
                const commitHash = hashBitcoindStoredBlockheader(header);
                await expect(promise).to.emit(contract, "StoreHeader").withArgs(commitHash, "0x"+Buffer.from(header.hash, "hex").reverse().toString("hex"));
                assert.strictEqual(await contract.getCommitHash(header.height), commitHash);
                assert.strictEqual(await getMainCommitment(contract, header.height), commitHash);
                assert.strictEqual(await contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(header)), BigInt(lastHeader.height - header.height + 1));
                assert.strictEqual(await contract.verifyBlockheaderHash(header.height, commitHash), BigInt(lastHeader.height - header.height + 1));
            }

            const totalGas = (await (await promise).wait()).gasUsed;
            const headerLength = headers.length - 1;
            console.debug("[submitMainAndAssert] Gas usage, num headers: "+headerLength+" gas used: "+totalGas+" gas per header: "+(Number(totalGas)/headerLength).toFixed(0));

            //Valid state of the tip data
            assert.strictEqual(await contract.getBlockheight(), BigInt(lastHeader.height));
            assert.strictEqual(await contract.getTipCommitHash(), hashBitcoindStoredBlockheader(lastHeader));
            assert.strictEqual(await contract.getChainwork(), BigInt("0x"+lastHeader.chainwork));
        }

        async function submitShortForkAndAssert(contract: BtcRelay, headers: (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]})[]) {
            const promise = contract.submitShortForkBlockheaders(Buffer.concat([
                serializeBitcoindStoredBlockheader(headers[0]),
                ...headers.slice(1).map(header => serializeBitcoindBlockheader(header))
            ]));

            const lastHeader = headers[headers.length-1];

            //Make sure all events are emitted
            for(let i=1;i<headers.length;i++) {
                const header = headers[i];
                const commitHash = hashBitcoindStoredBlockheader(header);
                await expect(promise).to.emit(contract, "StoreHeader").withArgs(commitHash, "0x"+Buffer.from(header.hash, "hex").reverse().toString("hex"));
                assert.strictEqual(await contract.getCommitHash(header.height), commitHash);
                assert.strictEqual(await getMainCommitment(contract, header.height), commitHash);
                assert.strictEqual(await contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(header)), BigInt(lastHeader.height - header.height + 1));
                assert.strictEqual(await contract.verifyBlockheaderHash(header.height, commitHash), BigInt(lastHeader.height - header.height + 1));
            }

            const totalGas = (await (await promise).wait()).gasUsed;
            const headerLength = headers.length - 1;
            console.debug("[submitShortForkAndAssert] Gas usage, num headers: "+headerLength+" gas used: "+totalGas+" gas per header: "+(Number(totalGas)/headerLength).toFixed(0));

            //Re-org event emitted
            await expect(promise).to.emit(contract, "ChainReorg").withArgs(
                hashBitcoindStoredBlockheader(lastHeader), 
                "0x"+Buffer.from(lastHeader.hash, "hex").reverse().toString("hex"),
                0n,
                account1.address,
                BigInt(headers[0].height + 1)
            );

            //Valid state of the tip data
            assert.strictEqual(await contract.getBlockheight(), BigInt(lastHeader.height));
            assert.strictEqual(await contract.getTipCommitHash(), hashBitcoindStoredBlockheader(lastHeader));
            assert.strictEqual(await contract.getChainwork(), BigInt("0x"+lastHeader.chainwork));
        }

        async function submitLongForkAndAssert(
            contract: BtcRelay,
            headers: (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]})[],
            shouldFork: boolean,
            forkStartHeight: number
        ) {
            const forkId = 1n;
            const promise = contract.submitForkBlockheaders(forkId, Buffer.concat([
                serializeBitcoindStoredBlockheader(headers[0]),
                ...headers.slice(1).map(header => serializeBitcoindBlockheader(header))
            ]));

            const lastHeader = headers[headers.length-1];

            //Make sure all events are emitted
            for(let i=1;i<headers.length;i++) {
                const header = headers[i];
                const commitHash = hashBitcoindStoredBlockheader(header);
                await expect(promise).to.emit(contract, "StoreForkHeader").withArgs(commitHash, "0x"+Buffer.from(header.hash, "hex").reverse().toString("hex"), 1n);
                if(shouldFork) {
                    assert.strictEqual(await contract.getCommitHash(header.height), commitHash);
                    assert.strictEqual(await getMainCommitment(contract, header.height), commitHash);
                    assert.strictEqual(await contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(header)), BigInt(lastHeader.height - header.height + 1));
                    assert.strictEqual(await contract.verifyBlockheaderHash(header.height, commitHash), BigInt(lastHeader.height - header.height + 1));
                } else {
                    assert.strictEqual(await getForkCommitment(contract, forkId, header.height), commitHash);
                }
            }

            const totalGas = (await (await promise).wait()).gasUsed;
            const headerLength = headers.length - 1;
            console.debug("[submitLongForkAndAssert] Gas usage, num headers: "+headerLength+" gas used: "+totalGas+" gas per header: "+(Number(totalGas)/headerLength).toFixed(0));

            //Valid state of the tip data
            if(shouldFork) {
                assert.strictEqual(await contract.getBlockheight(), BigInt(lastHeader.height));
                assert.strictEqual(await contract.getTipCommitHash(), hashBitcoindStoredBlockheader(lastHeader));
                assert.strictEqual(await contract.getChainwork(), BigInt("0x"+lastHeader.chainwork));
                await expect(promise).to.emit(contract, "ChainReorg").withArgs(
                    hashBitcoindStoredBlockheader(lastHeader), 
                    "0x"+Buffer.from(lastHeader.hash, "hex").reverse().toString("hex"),
                    forkId,
                    account1.address,
                    BigInt(forkStartHeight + 1)
                );
                const forkData = await getForkData(contract, forkId);
                assert.strictEqual(forkData.startHeight, 0);
                assert.strictEqual(forkData.endHeight, 0);
            } else {
                await expect(promise).to.not.emit(contract, "ChainReorg");
                const forkData = await getForkData(contract, forkId);
                assert.strictEqual(forkData.startHeight, forkStartHeight + 1);
                assert.strictEqual(forkData.endHeight, lastHeader.height);
            }
        }

        return {BtcRelay, submitMainAndAssert, submitShortForkAndAssert, submitLongForkAndAssert, getMainCommitment, getForkCommitment};
    }

    it("Valid constructor", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const block = mineRandomBitcoinBlock(1_700_000_000, "1f7fffff");
        const commitHash = hashBitcoindStoredBlockheader(block);

        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block), false);
        await expect(contract.deploymentTransaction()).to.emit(contract, "StoreHeader").withArgs(hashBitcoindStoredBlockheader(block), "0x"+Buffer.from(block.hash, "hex").reverse().toString("hex"));

        assert.strictEqual(await contract.getCommitHash(block.height), commitHash);
        assert.strictEqual(await contract.getBlockheight(), BigInt(block.height));
        assert.strictEqual(await contract.getTipCommitHash(), commitHash);
        assert.strictEqual(await contract.getChainwork(), BigInt("0x"+block.chainwork));
        assert.strictEqual(await contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(block)), 1n);
        assert.strictEqual(await contract.verifyBlockheaderHash(block.height, commitHash), 1n);
    });

    it("Invalid block PoW (blockhash not lower than target)", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidPoWUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: invalid PoW");
    });

    it("Invalid block nbits (not same as last block)", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidnBitsUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: nbits");
    });

    it("Invalid block nbits at difficulty adjustment (invalidly computed)", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidnBitsDiffAdjustmentUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: new nbits");
    });

    it("Invalid block previous blockhash", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidPrevBlockhashUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: invalid PoW");
    });

    it("Invalid block median timestamps", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidTimestampMedianUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: timestamp median");
    });

    it("Invalid block future timestamp", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const [block1, block2] = generateRandomInvalidTimestampMedianUpdate();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block1), false);

        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(block1),
            serializeBitcoindBlockheader(block2)
        ]))).to.be.revertedWith("updateChain: timestamp future");
    });

    it("Valid main chain", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const mainChain = generateMainChain();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(mainChain[0]), false);

        await submitMainAndAssert(contract, mainChain);
    });

    it("Invalid main chain, stored blockheader not committed", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const mainChain = generateMainChain();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(mainChain[0]), false);

        //Malleate the stored blockheader
        mainChain[0].time++;

        //Should fail because blockheader not committed
        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(mainChain[0]),
            ...mainChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("submitMain: block commitment");
    });

    it("Invalid main chain, stored header is not the tip", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const mainChain = generateMainChain();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(mainChain[0]), false);

        await submitMainAndAssert(contract, mainChain.slice(0, 5));

        //Should fail because submitted stored blockheader is not the tip
        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(mainChain[2]),
            ...mainChain.slice(3).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("submitMain: block height");
    });

    it("Invalid short fork, stored header not in main chain", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);

        //Malleate the stored blockheader of forkChain
        forkChain[0].time++;

        //Should fail because submitted stored blockheader is not the tip
        expect(contract.submitShortForkBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain[0]),
            ...forkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("shortFork: block commitment");
    });

    it("Invalid long fork, stored header not in main chain", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);

        //Malleate the stored blockheader of forkChain
        forkChain[0].time++;

        //Should fail because submitted stored blockheader is not the tip
        expect(contract.submitForkBlockheaders(1n, Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain[0]),
            ...forkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("fork: block commitment");
    });

    it("Invalid long fork, stored header not in fork state", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain.slice(0, 5), false, forkChain[0].height);

        const restOfForkChain = forkChain.slice(4);

        //Malleate the stored blockheader of forkChain
        restOfForkChain[0].time++;

        //Should fail because submitted stored blockheader is not the tip
        expect(contract.submitForkBlockheaders(1n, Buffer.concat([
            serializeBitcoindStoredBlockheader(restOfForkChain[0]),
            ...restOfForkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("fork: fork block commitment");
    });

    it("Invalid long fork, stored header not fork state tip", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain.slice(0, 5), false, forkChain[0].height);

        const restOfForkChain = forkChain.slice(3); //Take 1 more blockheader here, so we are not using the fork's tip

        //Should fail because submitted stored blockheader is not the tip
        expect(contract.submitForkBlockheaders(1n, Buffer.concat([
            serializeBitcoindStoredBlockheader(restOfForkChain[0]),
            ...restOfForkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("fork: fork block commitment");
    });

    it("Invalid main chain, re-org & try to build on top of now future blockheight", async function() {
        const {BtcRelay, submitMainAndAssert, submitShortForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain1, forkChain2} = generateSuccessfulForkWithMoreChainworkAndForkFromFutureHeight();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);

        //Re-org the chain with new fork which has higher total chainwork but is shorter, the blockheight at the tip of `cannonicalChain` is now in the future
        await submitShortForkAndAssert(contract, forkChain1);

        //Should fail because submitted stored blockheader is now at the greater height than the main chain
        expect(contract.submitMainBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain2[0]),
            ...forkChain2.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("submitMain: block height");
    }).timeout(2*60*1000);

    it("Invalid short fork, re-org & try to fork again from now future blockheight", async function() {
        const {BtcRelay, submitMainAndAssert, submitShortForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain1, forkChain2} = generateSuccessfulForkWithMoreChainworkAndForkFromFutureHeight();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);

        //Re-org the chain with new fork which has higher total chainwork but is shorter, the blockheight at the tip of `cannonicalChain` is now in the future
        await submitShortForkAndAssert(contract, forkChain1);

        //Should fail because submitted stored blockheader is now at the greater height than the main chain
        expect(contract.submitShortForkBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain2[0]),
            ...forkChain2.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("shortFork: future block");
    }).timeout(2*60*1000);

    it("Invalid long fork, re-org & try to fork again from now future blockheight", async function() {
        const {BtcRelay, submitMainAndAssert, submitShortForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain1, forkChain2} = generateSuccessfulForkWithMoreChainworkAndForkFromFutureHeight();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);

        //Re-org the chain with new fork which has higher total chainwork but is shorter, the blockheight at the tip of `cannonicalChain` is now in the future
        await submitShortForkAndAssert(contract, forkChain1);

        //Should fail because submitted stored blockheader is now at the greater height than the main chain
        expect(contract.submitForkBlockheaders(1n, Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain2[0]),
            ...forkChain2.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("fork: future block");
    }).timeout(2*60*1000);

    it("Valid short fork", async function() {
        const {BtcRelay, submitMainAndAssert, submitShortForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitShortForkAndAssert(contract, forkChain);
    });

    it("Valid long fork", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain, true, forkChain[0].height);
    });

    it("Valid long fork in 2 txns", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert, getMainCommitment} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulFork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain.slice(0, 5), false, forkChain[0].height);
        await submitLongForkAndAssert(contract, forkChain.slice(4), true, forkChain[0].height);

        const lastHeader = forkChain[forkChain.length-1];

        //Ensure all the blockheaders are part of the cannonical chain now
        for(let header of forkChain) {
            const commitHash = hashBitcoindStoredBlockheader(header);
            assert.strictEqual(await contract.getCommitHash(header.height), commitHash);
            assert.strictEqual(await getMainCommitment(contract, header.height), commitHash);
            assert.strictEqual(await contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(header)), BigInt(lastHeader.height - header.height + 1));
            assert.strictEqual(await contract.verifyBlockheaderHash(header.height, commitHash), BigInt(lastHeader.height - header.height + 1));
        }
    });

    it("Valid short fork, higher chainwork but shorter chain", async function() {
        const {BtcRelay, submitMainAndAssert, submitShortForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateSuccessfulForkWithMoreChainwork();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        const preForkHeight = Number(await contract.getBlockheight());
        await submitShortForkAndAssert(contract, forkChain);
        const postForkHeight = Number(await contract.getBlockheight());

        //The blockheight of the relay has decreased
        assert.isBelow(postForkHeight, preForkHeight);

        //We shouldn't be able to do anything with block at `preForkHeight` because the chain is now shorter
        const lastPreviousCannonicalBlock = cannonicalChain[cannonicalChain.length-1];
        await expect(contract.verifyBlockheader(serializeBitcoindStoredBlockheaderToStruct(lastPreviousCannonicalBlock))).to.be.revertedWith("verify: future block");
        await expect(contract.verifyBlockheaderHash(lastPreviousCannonicalBlock.height, hashBitcoindStoredBlockheader(lastPreviousCannonicalBlock))).to.be.revertedWith("verify: future block");
    }).timeout(2*60*1000);

    it("Invalid short fork, not enough length", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateInvalidForkNotEnoughLength();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await expect(contract.submitShortForkBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain[0]),
            ...forkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("shortFork: not enough work");
    });

    it("Invalid long fork, not enough length", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateInvalidForkNotEnoughLength();
        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain, false, forkChain[0].height);
    });

    it("Invalid short fork, not enough chainwork, but long enough", async function() {
        const {BtcRelay, submitMainAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateInvalidForkNotEnoughChainwork();
        
        //Ensure the fork has higher height
        assert.isBelow(cannonicalChain[cannonicalChain.length-1].height, forkChain[forkChain.length-1].height);

        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await expect(contract.submitShortForkBlockheaders(Buffer.concat([
            serializeBitcoindStoredBlockheader(forkChain[0]),
            ...forkChain.slice(1).map(header => serializeBitcoindBlockheader(header))
        ]))).to.be.revertedWith("shortFork: not enough work");
    });

    it("Invalid long fork, not enough chainwork, but long enough", async function() {
        const {BtcRelay, submitMainAndAssert, submitLongForkAndAssert} = await loadFixture(deploy);

        const {cannonicalChain, forkChain} = generateInvalidForkNotEnoughChainwork();

        //Ensure the fork has higher height
        assert.isBelow(cannonicalChain[cannonicalChain.length-1].height, forkChain[forkChain.length-1].height);

        const contract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(cannonicalChain[0]), false);

        await submitMainAndAssert(contract, cannonicalChain);
        await submitLongForkAndAssert(contract, forkChain, false, forkChain[0].height);
    });

});
