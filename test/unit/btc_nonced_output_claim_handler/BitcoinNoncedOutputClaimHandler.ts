import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { BitcoindBlockheader, BitcoindTransaction, getBlockheader, getBlockWithTransactions, getTransaction, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { toBuffer } from "../../utils/buffer_utils";
import { serializeBitcoindStoredBlockheader, serializeBitcoindStoredBlockheaderToStruct } from "../../utils/evm/stored_blockheader";
import { randomBytes32 } from "../../utils/evm/utils";
import { randomBytes } from "crypto";
import { generateMerkleRoot } from "../../utils/merkle_tree";
import { createBitcoinChain, mineBitcoinBlock, mineBitcoinBlockAfter } from "../../utils/blockchain_utils";
import { generateMainChain } from "../../generators/btc_relay/chains";
import { serializeBitcoindBlockheader } from "../../utils/evm/blockheader";
import { getMempoolApiMerkleProof } from "../../utils/mempool_utils";
import { getRandomTransaction } from "../../utils/bitcoin_tx";
import { Transaction } from "bitcoinjs-lib";
import { existingRealNoncedTxns } from "./data/existing_nonced_txns";

function randomNonce(): bigint {
    return (BigInt(Math.floor(Date.now()/1000) - 600_000_000) << 24n) | BigInt(Math.floor(0x1000000*Math.random()));
}

function getTxoHash(nonce: bigint, value: bigint, outputScript: string) {
    return hre.ethers.keccak256(
        "0x"+toBuffer(nonce, 8, "be").toString("hex")+toBuffer(value, 8, "be").toString("hex")+hre.ethers.keccak256("0x"+outputScript).substring(2)
    ).substring(2);
}

function getCommitmentHash(txoHash: string, confirmations: number, btcRelayContract: string) {
    return hre.ethers.keccak256(Buffer.concat([
        Buffer.from(txoHash, "hex"),
        toBuffer(confirmations, 4, "be"),
        Buffer.from(btcRelayContract.substring(2), "hex")
    ]));
}

function getWitness(
    reversedTxId: string, 
    confirmations: number, 
    btcRelayContract: string, 
    header: BitcoindBlockheader & {epochstart?: number, previousBlockTimestamps?: number[]},
    vout: number,
    transaction: string,
    position: number,
    merkleProof: string[]
) {
    return "0x"+Buffer.concat([
        Buffer.from(reversedTxId, "hex"),
        toBuffer(confirmations, 4, "be"),
        Buffer.from(btcRelayContract.substring(2), "hex"),
        serializeBitcoindStoredBlockheader(header),
        toBuffer(vout, 4, "be"),
        toBuffer(transaction.length / 2, 32, "be"),
        Buffer.from(transaction, "hex"),
        toBuffer(position, 4, "be"),
        toBuffer(merkleProof.length, 32, "be"),
        ...merkleProof.map(val => Buffer.from(val, "hex"))
    ]).toString("hex");
}

describe("BitcoinNoncedOutputClaimHandler", function () {
    async function deploy() {
        const BtcRelay = await hre.ethers.getContractFactory("BtcRelay");
        const BitcoinNoncedOutputClaimHandler = await hre.ethers.getContractFactory("BitcoinNoncedOutputClaimHandler");
        const contract = await BitcoinNoncedOutputClaimHandler.deploy();

        return {contract, BtcRelay};
    }

    it("Valid random witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const confirmations = 1;
            const nonce = randomNonce();
            const tx = getRandomTransaction(1, 1);

            //Apply nonce
            tx.locktime = Number(nonce >> 24n) + 500_000_000;
            tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

            //Pick random vout
            const vout = Math.floor(tx.outs.length*Math.random());
            const output = tx.outs[vout];
            const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

            //Strip witness data
            tx.ins.forEach(vin => vin.witness = []);
            
            const reversedTxId = tx.getHash();

            const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

            const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

            const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

            assert.strictEqual(await contract.claim(
                getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
                getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
            ), "0x"+reversedTxId.toString("hex"));
        }
    });

    it("Valid real witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const confirmations = 1;

            const txId = existingRealNoncedTxns[Math.floor(Math.random() * existingRealNoncedTxns.length)].btcTx;
            const realProof = await getMempoolApiMerkleProof(txId);
            const tx = await getTransaction(txId);
            const block = await getBlockheader(tx.blockhash);

            //Extract nonce from transaction
            const nonce = (BigInt(tx.locktime - 500_000_000) << 24n) | (BigInt(tx.vin[0].sequence) & 0x00FFFFFFn);

            //Pick random vout
            const vout = Math.floor(tx.vout.length*Math.random());
            const output = tx.vout[vout];
            const txoHash = getTxoHash(nonce, BigInt(Math.floor((output.value * 100_000_000) + 0.5)), output.scriptPubKey.hex);

            //Strip witness data
            const parsedTx = Transaction.fromHex(tx.hex);
            parsedTx.ins.forEach(vin => vin.witness = []);
            const transactionRawData = parsedTx.toHex();

            const reversedTxId = Buffer.from(txId, "hex").reverse().toString("hex");

            const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(block), false);

            assert.strictEqual(await contract.claim(
                getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
                getWitness(txoHash, confirmations, await relayContract.getAddress(), block, vout, transactionRawData, realProof.pos, realProof.merkle.map(val => Buffer.from(val, "hex").reverse().toString("hex")))
            ), "0x"+reversedTxId);
        }
    });

    it("Invalid empty witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);
        await expect(contract.claim(randomBytes32(), "0x")).to.be.revertedWith("btcnoutlock: witness length");
    });

    it("Invalid incorrect commitment witness", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(txoHash, 3, await relayContract.getAddress()), //Require 3 confirmations in commitment
            getWitness(txoHash, 1, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof) //Supply just 1 confirmation in the witness
        )).to.be.revertedWith("btcnoutlock: invalid commitment");
    });

    it("Invalid block confirmations", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const confirmations = 2;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        //Require 2 confirmations, but the blockheader only has 1 confirmation
        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
        )).to.be.revertedWith("btcnoutlock: confirmations");
    });

    it("Invalid merkle proof, root doesn't match", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const confirmations = 1;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000); //Use random merkle root in the block

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
        )).to.be.revertedWith("merkleTree: verify failed");
    });

    it("Invalid blockheader, provided header is not known to the btc relay", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const confirmations = 1;
        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesisReal = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000);
        const genesisFake = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesisReal), false); //Save real blockheader to light client

        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesisFake, vout, tx.toHex(), position, proof) //Use fake blockheader in the witness
        )).to.be.revertedWith("verify: block commitment");
    });

    it("Invalid vout of bounds", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const confirmations = 1;

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        const invalidVoutOutOfBounds = tx.outs.length;
        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, invalidVoutOutOfBounds, tx.toHex(), position, proof) //Use invalid vout that is out of bounds
        )).to.be.revertedWith("btcTx: Output not found");
    });

    it("Invalid txoHash doesn't match (due to wrong outputAmount)", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const confirmations = 1;

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value + 1), output.script.toString("hex"));

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
        )).to.be.revertedWith("btcnoutlock: Invalid output");
    });

    it("Invalid txoHash doesn't match (due to wrong outputScript)", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const confirmations = 1;

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce, BigInt(output.value), output.script.toString("hex")+"deadbeef");

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
        )).to.be.revertedWith("btcnoutlock: Invalid output");
    });

    it("Invalid txoHash doesn't match (due to wrong nonce)", async function () {
        const {contract, BtcRelay} = await loadFixture(deploy);

        const confirmations = 1;

        const nonce = randomNonce();
        const tx = getRandomTransaction(1, 1);

        //Apply nonce
        tx.locktime = Number(nonce >> 24n) + 500_000_000;
        tx.ins[0].sequence = Number(0xF0000000n | (nonce & 0x00FFFFFFn));

        //Pick random vout
        const vout = Math.floor(tx.outs.length*Math.random());
        const output = tx.outs[vout];
        const txoHash = getTxoHash(nonce + 1n, BigInt(output.value), output.script.toString("hex")); //Change the nonce

        //Strip witness data
        tx.ins.forEach(vin => vin.witness = []);
        
        const reversedTxId = tx.getHash();

        const [root, proof, position] = generateMerkleRoot(reversedTxId, 5);

        const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

        const relayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct(genesis), false);

        await expect(contract.claim(
            getCommitmentHash(txoHash, confirmations, await relayContract.getAddress()),
            getWitness(txoHash, confirmations, await relayContract.getAddress(), genesis, vout, tx.toHex(), position, proof)
        )).to.be.revertedWith("btcnoutlock: Invalid output");
    });

});
