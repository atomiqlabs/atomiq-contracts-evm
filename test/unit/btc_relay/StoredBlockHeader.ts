import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { serializeBitcoindBlockheader, serializeBlockheader } from "../../utils/evm/blockheader";
import { BitcoindBlockheader, getBlockheader, randomBitcoinEpoch, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { reverseUint32 } from "../../utils/endianness";
import { serializeBitcoindStoredBlockheader, serializeStoredBlockheader } from "../../utils/evm/stored_blockheader";
import { randomUnsignedBigInt } from "../../utils/random";
import { generateRandomInvalidnBitsDiffAdjustmentUpdate, generateRandomInvalidnBitsUpdate, generateRandomInvalidPoWUpdate, generateRandomInvalidPrevBlockhashUpdate, generateRandomInvalidTimestampFutureUpdate, generateRandomInvalidTimestampMedianUpdate, generateRandomPoWAdjustmentBlockUpdate, generateRandomValidBlockUpdate, generateRandomValidTimestampMedianUpdate, generateRealValidBlockUpdate } from "./generators/stored_header_updates";
import { mineBitcoinBlock } from "../../utils/blockchain_utils";


describe("StoredBlockHeader", function () {
    async function deploy() {
        const StoredBlockHeaderWrapper = await hre.ethers.getContractFactory("StoredBlockHeaderWrapper");
        const contract = await StoredBlockHeaderWrapper.deploy();

        async function assertStoredBlockheader(parsedStoredBlockHeader: any, blockHeader: BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]}) {
            assert.equal(await contract.header_version(parsedStoredBlockHeader), BigInt(blockHeader.version));
            assert.equal(await contract.header_previousBlockhash(parsedStoredBlockHeader), "0x"+Buffer.from(blockHeader.previousblockhash, "hex").reverse().toString("hex"));
            assert.equal(await contract.header_merkleRoot(parsedStoredBlockHeader), "0x"+Buffer.from(blockHeader.merkleroot, "hex").reverse().toString("hex"));
            assert.equal(await contract.header_timestamp(parsedStoredBlockHeader), BigInt(blockHeader.time));
            assert.equal(await contract.header_nBitsLE(parsedStoredBlockHeader), reverseUint32(blockHeader.bits));
            assert.equal(await contract.header_nonce(parsedStoredBlockHeader), BigInt(blockHeader.nonce));
            assert.equal(await contract.chainWork(parsedStoredBlockHeader), BigInt("0x"+blockHeader.chainwork));
            assert.equal(await contract.blockHeight(parsedStoredBlockHeader), BigInt(blockHeader.height));
            assert.equal(await contract.lastDiffAdjustment(parsedStoredBlockHeader), BigInt(blockHeader.epochstart));
            assert.equal(await contract.header_blockhash(parsedStoredBlockHeader), "0x"+Buffer.from(blockHeader.hash, "hex").reverse().toString("hex"));
            assert.equal(await contract.hash(parsedStoredBlockHeader), hre.ethers.keccak256(hre.ethers.solidityPacked([ "bytes32[5]" ], [parsedStoredBlockHeader.data])));
            if(blockHeader.previousBlockTimestamps!=null) {
                const result = await contract.previousBlockTimestamps(parsedStoredBlockHeader);
                for(let i=0;i<10;i++) {
                    assert.equal(result[i], BigInt(blockHeader.previousBlockTimestamps[i]), "Previous block timestamp ["+i+"]")
                }
            }
        }

        async function assertUpdateChain(
            first: BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]},
            second: BitcoindBlockheader & {epochstart: number, previousBlockTimestamps?: number[]},
            clampTarget: boolean,
            _assert: boolean = true,
            timestamp?: number
        ) {
            const serialized = serializeBitcoindStoredBlockheader(first);
            const parsedStoredBlockHeader = {data: [...(await contract.fromCalldata(serialized, 0))[0]]} as any;
            if(_assert) await assertStoredBlockheader(parsedStoredBlockHeader, first);

            const result = await contract.updateChain(parsedStoredBlockHeader, serializeBitcoindBlockheader(second), 0, timestamp ?? 0xffffffff, clampTarget);
            if(_assert) await assertStoredBlockheader({data: [...(result[1])[0]]} as any, second);
            if(_assert) assert.strictEqual(result[0], "0x"+Buffer.from(second.hash, "hex").reverse().toString("hex"));
        }

        return { contract, assertStoredBlockheader, assertUpdateChain };
    }

    it("Valid from calldata", async function () {
        const {contract} = await loadFixture(deploy);

        await contract.fromCalldata(randomBytes(160), 0);
    });

    it("Valid from calldata with offset", async function () {
        const {contract} = await loadFixture(deploy);

        await contract.fromCalldata(randomBytes(256), 41);
    });

    it("Invalid from calldata with offset", async function () {
        const {contract} = await loadFixture(deploy);

        await expect(contract.fromCalldata(randomBytes(160), 15)).to.be.revertedWith("StoredBlockHeader: out of bounds");
    });

    it("Valid read values", async function () {
        const {contract} = await loadFixture(deploy);
        
        const version = 0x00000002;
        const previousBlockHash = Buffer.from("00000000000000000000a5376a85ea4e0b982e5305d0fb17b57307d7b4e20398", "hex");
        const merkleRoot = Buffer.from("1d5649615cffcd110ad492ae83c54034f12d41f44dd69094c875b750539e1031", "hex");
        const timestamp = 185727712;
        const nbits = 0x8732bcde;
        const nonce = 0x23273723;
        const chainWork = 0x1d5649615cffcd110ad492ae83c54034f12d41f44dd69094c875b750539e1031n;
        const blockHeight = 321394;
        const lastDiffAdjustment = 123232313;
        const previousBlockTimestamps = [
            3213123, 3213123, 3123145, 54214121, 2312412, 52342532, 5235235, 2352, 322523523, 1231273
        ];

        const serializedStoredBlockheader = serializeStoredBlockheader(version, previousBlockHash, merkleRoot, timestamp, nbits, nonce, chainWork, blockHeight, lastDiffAdjustment, previousBlockTimestamps);
        const parsedStoredBlockHeader = {data: [...(await contract.fromCalldata(serializedStoredBlockheader, 0))[0]]} as any;

        assert.equal(await contract.header_version(parsedStoredBlockHeader), BigInt(version));
        assert.equal(await contract.header_previousBlockhash(parsedStoredBlockHeader), "0x"+previousBlockHash.reverse().toString("hex"));
        assert.equal(await contract.header_merkleRoot(parsedStoredBlockHeader), "0x"+merkleRoot.reverse().toString("hex"));
        assert.equal(await contract.header_timestamp(parsedStoredBlockHeader), BigInt(timestamp));
        assert.equal(await contract.header_nBitsLE(parsedStoredBlockHeader), reverseUint32(nbits));
        assert.equal(await contract.header_nonce(parsedStoredBlockHeader), BigInt(nonce));
        assert.equal(await contract.chainWork(parsedStoredBlockHeader), chainWork);
        assert.equal(await contract.blockHeight(parsedStoredBlockHeader), BigInt(blockHeight));
        assert.equal(await contract.lastDiffAdjustment(parsedStoredBlockHeader), BigInt(lastDiffAdjustment));
        assert.equal(await contract.hash(parsedStoredBlockHeader), hre.ethers.keccak256(serializedStoredBlockheader));
    });

    it("Existing blockheaders", async function () {
        const {contract, assertStoredBlockheader} = await loadFixture(deploy);
        
        for(let i=0;i<10;i++) {
            const blockHeight = randomBitcoinHeight();
            const blockHeader = {
                ...await getBlockheader(blockHeight),
                epochstart: (await getBlockheader(Math.floor(blockHeight / 2016))).time
            };

            const serialized = serializeBitcoindStoredBlockheader(blockHeader);
            const parsedStoredBlockHeader = {data: [...(await contract.fromCalldata(serialized, 0))[0]]} as any;
            assertStoredBlockheader(parsedStoredBlockHeader, blockHeader)
        }
    });

    it("Valid parse random", async function () {
        const { contract, assertStoredBlockheader } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const blockHeader = mineBitcoinBlock(randomBytes(32).toString("hex"), 55424585, "1fcd1321", 8441145, "0", 0);
            const serialized = serializeBitcoindStoredBlockheader(blockHeader);
            const parsedStoredBlockHeader = {data: [...(await contract.fromCalldata(serialized, 0))[0]]} as any;
            assertStoredBlockheader(parsedStoredBlockHeader, blockHeader)
        }
    });
    
    it("Valid update random", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomValidBlockUpdate();
            await assertUpdateChain(first, second, false);
        }
    });

    it("Valid update random block on PoW readjustment", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomPoWAdjustmentBlockUpdate();
            await assertUpdateChain(first, second, false);
        }
    });

    it("Valid update random block on PoW readjustment, too fast", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomPoWAdjustmentBlockUpdate(100);
            await assertUpdateChain(first, second, false);
        }
    });

    it("Valid update random block on PoW readjustment, too slow", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomPoWAdjustmentBlockUpdate(3000);
            await assertUpdateChain(first, second, false);
        }
    });

    it("Valid update random block, with timestamp larger than median of last 11 blocks", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomValidTimestampMedianUpdate();
            await assertUpdateChain(first, second, false);
        }
    });

    it("Invalid update random block, due to low PoW", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidPoWUpdate();
            await expect(assertUpdateChain(first, second, false, false)).to.be.revertedWith("updateChain: invalid PoW");
        }
    });

    it("Invalid update random block, due to wrong nBits", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidnBitsUpdate();
            await expect(assertUpdateChain(first, second, false, false)).to.be.revertedWith("updateChain: nbits");
        }
    });

    it("Invalid update random block, due to wrong nBits during difficulty retarget", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidnBitsDiffAdjustmentUpdate();
            await expect(assertUpdateChain(first, second, false, false)).to.be.revertedWith("updateChain: new nbits");
        }
    });

    it("Invalid update random block, due to wrong previous blockhash", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidPrevBlockhashUpdate();
            //This fails with invalid PoW, because we don't check prev block hash
            await expect(assertUpdateChain(first, second, false, false)).to.be.revertedWith("updateChain: invalid PoW"); 
        }
    });

    it("Invalid update random block, due to timestamp not being larger than median of last 11 blocks", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidTimestampMedianUpdate();
            await expect(assertUpdateChain(first, second, false, false)).to.be.revertedWith("updateChain: timestamp median"); 
        }
    });

    it("Invalid update random block, due to timestamp being too far in the future", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = generateRandomInvalidTimestampFutureUpdate();
            await expect(assertUpdateChain(first, second, false, false, first.time)).to.be.revertedWith("updateChain: timestamp future"); 
        }
    });

    it("Valid update real", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const [first, second] = await generateRealValidBlockUpdate(randomBitcoinHeight());
            await assertUpdateChain(first, second, true);
        }
    });

    it("Valid update real on PoW readjustment", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);
        const epoch = randomBitcoinEpoch();

        const [first, second] = await generateRealValidBlockUpdate((epoch * 2016) + 2015);
        await assertUpdateChain(first, second, true);
    });

    it("Valid update real on PoW readjustment, too fast", async function () {
        const { assertUpdateChain } = await loadFixture(deploy);
        //In epoch 33, the blocks were mined so fast that they triggered the upper bound check in the difficulty adjustment
        const epoch = 33;

        const [first, second] = await generateRealValidBlockUpdate((epoch * 2016) + 2015);
        await assertUpdateChain(first, second, true);
    });
});
