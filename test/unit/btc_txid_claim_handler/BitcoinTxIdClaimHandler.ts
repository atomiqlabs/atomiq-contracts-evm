import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { BitcoindBlockheader, getBlockWithTransactions, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { toBuffer } from "../../utils/buffer_utils";
import { serializeBitcoindStoredBlockheader, serializeBitcoindStoredBlockheaderToStruct } from "../../utils/evm/stored_blockheader";
import { randomBytes32 } from "../../utils/evm/utils";
import { randomBytes } from "crypto";
import { generateMerkleRoot } from "../../utils/merkle_tree";
import { createBitcoinChain, mineBitcoinBlock, mineBitcoinBlockAfter } from "../../utils/blockchain_utils";
import { generateMainChain } from "../../generators/btc_relay/chains";
import { serializeBitcoindBlockheader } from "../../utils/evm/blockheader";
import { getMempoolApiMerkleProof } from "../../utils/mempool_utils";

function getCommitmentHash(reversedTxId: string, confirmations: number, btcRelayContract: string) {
    return hre.ethers.keccak256(Buffer.concat([
        Buffer.from(reversedTxId, "hex"),
        toBuffer(confirmations, 4, "be"),
        Buffer.from(btcRelayContract.substring(2), "hex")
    ]));
}

function getWitness(
    reversedTxId: string, 
    confirmations: number, 
    btcRelayContract: string, 
    header: BitcoindBlockheader & {epochstart?: number, previousBlockTimestamps?: number[]},
    position: number,
    merkleProof: string[]
) {
    return "0x"+Buffer.concat([
        Buffer.from(reversedTxId, "hex"),
        toBuffer(confirmations, 4, "be"),
        Buffer.from(btcRelayContract.substring(2), "hex"),
        serializeBitcoindStoredBlockheader(header),
        toBuffer(position, 4, "be"),
        toBuffer(merkleProof.length, 32, "be"),
        ...merkleProof.map(val => Buffer.from(val, "hex"))
    ]).toString("hex");
}

describe("BitcoinTxIdClaimHandler", function () {
    async function deploy() {
        const BtcRelay = await hre.ethers.getContractFactory("BtcRelay");
        const BitcoinTxIdClaimHandler = await hre.ethers.getContractFactory("BitcoinTxIdClaimHandler");
        const contract = await BitcoinTxIdClaimHandler.deploy();

        return {contract, BtcRelay};
    }

    it("Valid random witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const confirmations = 1;
            const reversedTxId = randomBytes(32);

            const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

            const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

            const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

            assert.strictEqual(await contract.claim(
                getCommitmentHash(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress()),
                getWitness(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress(), genesis, position, proof)
            ), "0x"+reversedTxId.toString("hex"));
        }
    });

    it("Valid real witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const block = await getBlockWithTransactions(randomBitcoinHeight())
            const txId = block.tx[Math.floor(Math.random() * block.tx.length)];
            const realProof = await getMempoolApiMerkleProof(txId);

            const reversedTxId = Buffer.from(txId, "hex").reverse().toString("hex");

            const confirmations = 1;

            const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block), false);

            assert.strictEqual(await contract.claim(
                getCommitmentHash(reversedTxId, confirmations, await relayContract.getAddress()),
                getWitness(reversedTxId, confirmations, await relayContract.getAddress(), block, realProof.pos, realProof.merkle.map(val => Buffer.from(val, "hex").reverse().toString("hex")))
            ), "0x"+reversedTxId);
        }
    });

    it("Invalid empty witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);
        await expect(contract.claim(randomBytes32(), "0x")).to.be.revertedWith("txidlock: witness length");
    });

    it("Invalid incorrect commitment witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const reversedTxId = randomBytes(32);

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(reversedTxId.toString("hex"), 3, await relayContract.getAddress()), //Require 3 confirmations in commitment
            getWitness(reversedTxId.toString("hex"), 1, await relayContract.getAddress(), genesis, position, proof) //Supply just 1 confirmation in the witness
        )).to.be.revertedWith("txidlock: invalid commitment");
    });

    it("Invalid block confirmations", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const reversedTxId = randomBytes(32);

        const confirmations = 2;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        //Require 2 confirmations, but the blockheader only has 1 confirmation
        await expect(contract.claim(
            getCommitmentHash(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress()),
            getWitness(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress(), genesis, position, proof)
        )).to.be.revertedWith("txidlock: confirmations");
    });

    it("Invalid merkle proof, root doesn't match", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const reversedTxId = randomBytes(32);

        const confirmations = 1;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000); //Use random merkle root in the block

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress()),
            getWitness(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress(), genesis, position, proof)
        )).to.be.revertedWith("merkleTree: verify failed");
    });

    it("Invalid blockheader, provided header is not known to the btc relay", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const reversedTxId = randomBytes(32);

        const confirmations = 2;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesisReal = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000);
        const genesisFake = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesisReal), false); //Save real blockheader to light client

        await expect(contract.claim(
            getCommitmentHash(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress()),
            getWitness(reversedTxId.toString("hex"), confirmations, await relayContract.getAddress(), genesisFake, position, proof) //Use fake blockheader here
        )).to.be.revertedWith("verify: block commitment");
    });

});
