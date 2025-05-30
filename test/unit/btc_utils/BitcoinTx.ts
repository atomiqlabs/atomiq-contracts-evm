import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { BitcoinTxTestData, getRandomTransactionTest, getRealRandomTransactionTest, getRealTransactionTest } from "./generators/bitcoin_tx";

describe("BitcoinTx", function () {
    async function deploy() {
        const BitcoinTxWrapper = await hre.ethers.getContractFactory("BitcoinTxWrapper");
        const contract = await BitcoinTxWrapper.deploy();

        async function parseAndAssert(tx: BitcoinTxTestData) {
            const dataHex = "0x"+tx.data.toString("hex");
            const rawParsedResult = await contract.fromMemory(dataHex);
            const parsedTx = {
                data: rawParsedResult.data,
                inputs: rawParsedResult.inputs,
                outputs: rawParsedResult.outputs
            } as any;

            assert.strictEqual(await contract.getHash(parsedTx), "0x"+tx.hash);
            assert.strictEqual(await contract.getVersion(parsedTx), BigInt(tx.version));
            assert.strictEqual(await contract.getLocktime(parsedTx), BigInt(tx.locktime));
            for(let i=0;i<tx.ins.length;i++) {
                const parsedUtxo = await contract.getInputUtxo(parsedTx, i);
                assert.strictEqual(parsedUtxo[0], "0x"+tx.ins[i].utxo.hash);
                assert.strictEqual(parsedUtxo[1], BigInt(tx.ins[i].utxo.vout));
                assert.strictEqual(await contract.getInputScriptHash(parsedTx, i), hre.ethers.keccak256(tx.ins[i].script));
                assert.strictEqual(await contract.getInputNSequence(parsedTx, i), BigInt(tx.ins[i].nSequence));
            }
            for(let i=0;i<tx.outs.length;i++) {
                assert.strictEqual(await contract.getOutputValue(parsedTx, i), tx.outs[i].value);
                assert.strictEqual(await contract.getOutputScriptHash(parsedTx, i), hre.ethers.keccak256(tx.outs[i].script));
            }
        }

        return {contract, parseAndAssert};
    }

    it("Valid random bitcoin txs", async function () {
        const {parseAndAssert} = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            await parseAndAssert(getRandomTransactionTest());
        }
    });

    it("Valid real bitcoin txs", async function () {
        const {parseAndAssert} = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            await parseAndAssert(await getRealRandomTransactionTest());
        }
    });

    it("Invalid witness not stripped", async function () {
        const {contract} = await loadFixture(deploy);
        // Transaction ID: ce3a49a4bd21f09fd8bf04399434e0bc4b311f254ce2cdc1ae4a41cd80e05566
        const txWithWitness = "0x0100000000010323dbaf4cad232fca1bfdb75e34443314c4462f9bd3968e17119e452b2432eae3010000001716001496de4122da32c2d428e70b44f8d07f2b26334b6ff0ffffff23013203bac75f77e1879673eb099a6c071f5a17d016f806df6c88f2a63a76b2000000001716001496de4122da32c2d428e70b44f8d07f2b26334b6ff0ffffff25e42ea855e2493db548a762fb5c24a18abd8cc60f9dfad4cddaf712a2d1b44f010000001716001496de4122da32c2d428e70b44f8d07f2b26334b6ff0ffffff02137c6f01000000001976a9147d07fc05b8da6db8e06b97922daa76d9026b195288ac0e3707000000000017a914424f29a8a84fa867814ff9ded43379c9dc9a6814870247304402202ab100ce04848e293de2cc2cac99554fcf2656b8461be64ab96e5922d8c66b060220793db90e557423c92748a3fc1670891ca06d0907a3cf7d8b3790f05176a7f1e1012102550e8b9eaa471d31c4a544a6aad1d8a3b6e4c4b127ddfdd629e85a888d3f8dd602473044022004ef97f07043a7b5b206966a1c68215a770e95da41fa431df5e2a0d6229aad5602200e07703c9b383e00963b6ed9fee4bb9b302df8cb8c1a26d0f5e51d2f04ff4b1a012102550e8b9eaa471d31c4a544a6aad1d8a3b6e4c4b127ddfdd629e85a888d3f8dd60247304402207abb8b67ff69f355e5f293ef6ec984c5293c91c689352c0d275c1624852fd19002206b0757f59850c90954e95ac6fc970b6b95bafd2244633c602b89ec703aabd55d012102550e8b9eaa471d31c4a544a6aad1d8a3b6e4c4b127ddfdd629e85a888d3f8dd600000000";
        await expect(contract.fromMemory(txWithWitness)).to.be.revertedWith("bitcointx: witness not stripped");
    });

    it("Invalid tx more than expected data", async function () {
        const {contract} = await loadFixture(deploy);
        //Original non-witness transaction: d0e226f6cac7fcf83dfa1d0c5725f4d639940d5cbb8e81c2e11ef8f5fa671a20
        const originalTransaction = "0x0200000001519557a5ede61a6bd405ccc78353106c312fe4d5ae9c03b27e4d79c4829d9ca0010000006a473044022060794f6b0edca8b432124555a51b7b8a49a040d90ef5144730417f7deafbed5202203fb287c48e2a54d12f6884d03081e1bd1100524bb0f65101aad1e0804978188a01210331ef6fe94727b528c326cacb7a8ae6d62cb18a361ea587982c5a53c1ac96f570fdffffff0244480200000000001600147785d24454a27ceceaf5d0c92c16a01d1b751cd7921b010000000000160014f81178fe42dbdd9ab48a15aa48a815b42ed7439652b70d00";
        const transactionWithExtraData = originalTransaction + "0032103cbdad13bd23"; //Append additional data
        await expect(contract.fromMemory(transactionWithExtraData)).to.be.revertedWith("bitcointx: more data");
    });

    it("Invalid tx length exactly 64 bytes", async function () {
        const {contract} = await loadFixture(deploy);
        //Transaction with size == 64
        const transactionWithSize64 = "0x0100000000010323dbaf4cad232fca1bfdb75e34443314c4462f9bd3968e17119e452b2432eae3010000001716001496de4122da32c2d428e70b44f8d07fa1bc";
        await expect(contract.fromMemory(transactionWithSize64)).to.be.revertedWith("bitcointx: length 64");
    });

});
