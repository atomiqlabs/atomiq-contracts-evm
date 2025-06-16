import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getSpvVaultBtcTx, getValidSpvVaultBtcTx } from "./generators/spv_vault_btc_tx";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";
import { Transaction } from "bitcoinjs-lib";
import { toBuffer } from "../../utils/buffer_utils";
import { getBitcoinVaultTransactionDataHash } from "../../utils/evm/bitcoin_vault_transaction_data";

describe("BitcoinVaultTransactionData", function () {
    async function deploy() {
        const BitcoinVaultTransactionDataWrapper = await hre.ethers.getContractFactory("BitcoinVaultTransactionDataWrapper");
        const contract = await BitcoinVaultTransactionDataWrapper.deploy();

        const BitcoinTxWrapper = await hre.ethers.getContractFactory("BitcoinTxWrapper");
        const contractBtcTx = await BitcoinTxWrapper.deploy();

        async function toParsedTx(btcTx: Transaction) {
            const _parsedBtcTx = await contractBtcTx.fromMemory(btcTx.toBuffer());
            return {data: _parsedBtcTx.data, inputs: _parsedBtcTx.inputs, outputs: _parsedBtcTx.outputs};
        }

        async function parseAndAssert(
            recipient: string, amount0: bigint, callerFee: bigint, frontingFee: bigint, executionFee: bigint, amount1?: bigint, executionHash?: string, executionExpiry?: bigint
        ) {
            const btcTx = await getValidSpvVaultBtcTx(recipient, amount0, callerFee, frontingFee, executionFee, amount1, executionHash, executionExpiry);
            const [success, struct, error] = await contract.fromTx(await toParsedTx(btcTx));
            
            assert.isTrue(success);
            assert.strictEqual(struct.recipient.toLowerCase(), recipient.toLowerCase());
            assert.strictEqual(struct.amount0, amount0);
            assert.strictEqual(struct.amount1, amount1 ?? 0n);
            assert.strictEqual(struct.executionHash, executionHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000");
            assert.strictEqual(struct.executionExpiry, executionExpiry ?? 0n);
            assert.strictEqual(struct.callerFee0, amount0 * callerFee / 100_000n);
            assert.strictEqual(struct.callerFee1, (amount1 ?? 0n) * callerFee / 100_000n);
            assert.strictEqual(struct.frontingFee0, amount0 * frontingFee / 100_000n);
            assert.strictEqual(struct.frontingFee1, (amount1 ?? 0n) * frontingFee / 100_000n);
            assert.strictEqual(struct.executionHandlerFeeAmount0, amount0 * executionFee / 100_000n);
        }

        return {contract, contractBtcTx, toParsedTx, parseAndAssert};
    }

    it("Parse valid (amount1 and execution)", async function () {
        const {contract, contractBtcTx, parseAndAssert} = await loadFixture(deploy);
        await parseAndAssert(randomAddress(), 39128312n, 823123n, 723n, 323232n, 8838123n, randomBytes32(), 1546864423n);
    });

    it("Parse valid (execution)", async function () {
        const {contract, contractBtcTx, parseAndAssert} = await loadFixture(deploy);
        await parseAndAssert(randomAddress(), 39128312n, 823123n, 723n, 323232n, null, randomBytes32(), 1546864423n);
    });

    it("Parse valid (amount1)", async function () {
        const {contract, contractBtcTx, parseAndAssert} = await loadFixture(deploy);
        await parseAndAssert(randomAddress(), 39128312n, 823123n, 723n, 323232n, 737273n, null, 1546864423n);
    });

    it("Parse valid", async function () {
        const {contract, contractBtcTx, parseAndAssert} = await loadFixture(deploy);
        await parseAndAssert(randomAddress(), 39128312n, 823123n, 723n, 323232n, null, null, 1546864423n);
    });

    it("Invalid single output only", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [0xCCCCCCCCn, 0xCCCCCCCCn],
            [Buffer.alloc(0)], //Only 1 output, but 2 are required
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: output count <2");
    });

    it("Invalid 2nd output empty script", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [0xCCCCCCCCn, 0xCCCCCCCCn],
            [Buffer.alloc(0), Buffer.alloc(0)], //2 outputs, but second one has empty script
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: output 1 empty script");
    });

    it("Invalid 2nd output not OP_RETURN", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [0xCCCCCCCCn, 0xCCCCCCCCn],
            [Buffer.alloc(0), Buffer.from([0x10])], //2 outputs, but second has no OP_RETURN
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: output 1 not OP_RETURN");
    });

    it("Invalid no input", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [], //No input
            [Buffer.alloc(0), Buffer.concat([
                Buffer.from([0x6a, 28]),
                Buffer.from("8b3fdf26e09cdf75be4365c97d876ea750c12beb", "hex"),
                toBuffer(19239, 8, "be")
            ])],
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: input count <2");
    });

    it("Invalid just 1 input", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [0xCCCCCCCCn], //Only 1 input
            [Buffer.alloc(0), Buffer.concat([
                Buffer.from([0x6a, 28]),
                Buffer.from("8b3fdf26e09cdf75be4365c97d876ea750c12beb", "hex"),
                toBuffer(19239, 8, "be")
            ])],
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: input count <2");
    });

    it("Invalid 2nd output invalid length", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getSpvVaultBtcTx(
            [0xCCCCCCCCn, 0xCCCCCCCCn],
            [Buffer.alloc(0), Buffer.concat([
                Buffer.from([0x6a])
            ])],
            0n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: output 1 invalid len");
    });

    it("Invalid caller fee 0 overflow", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getValidSpvVaultBtcTx(
            randomAddress(), 0xfffffffffffffffen, 1_000_000n, 0n, 0n, 8218312n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: caller fee 0");
    });

    it("Invalid fronting fee 0 overflow", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getValidSpvVaultBtcTx(
            randomAddress(), 0xfffffffffffffffen, 0n, 781273n, 0n, 8218312n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: fronting fee 0");
    });

    it("Invalid execution fee 0 overflow", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getValidSpvVaultBtcTx(
            randomAddress(), 0xfffffffffffffffen, 0n, 0n, 726332n, 8218312n
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: execution fee 0");
    });

    it("Invalid caller fee 1 overflow", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getValidSpvVaultBtcTx(
            randomAddress(), 817237n, 1_000_000n, 0n, 0n, 0xfffffffffffffffen
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: caller fee 1");
    });

    it("Invalid fronting fee 1 overflow", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const tx = await toParsedTx(await getValidSpvVaultBtcTx(
            randomAddress(), 8217312n, 0n, 781273n, 0n, 0xfffffffffffffffen
        ));
        const [success, struct, error] = await contract.fromTx(tx);
        assert.isFalse(success);
        assert.strictEqual(error, "txData: fronting fee 1");
    });

    it("Valid get full amounts", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const [success, amount0, amount1] = await contract.getFullAmounts({
            recipient: randomAddress(),
            amount0: 123123n, amount1: 32942n,
            callerFee0: 239n, callerFee1: 323n,
            frontingFee0: 9382n, frontingFee1: 3233n,
            executionHandlerFeeAmount0: 2323n,
            executionHash: randomBytes32(),
            executionExpiry: 0
        });
        assert.isTrue(success);
        assert.strictEqual(amount0, 123123n + 239n + 9382n + 2323n);
        assert.strictEqual(amount1, 32942n + 323n + 3233n);
    });

    it("Invalid get full amounts (overflow amount0)", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const [success, amount0, amount1] = await contract.getFullAmounts({
            recipient: randomAddress(),
            amount0: 0xfffffffffffffffen, amount1: 32942n,
            callerFee0: 239n, callerFee1: 323n,
            frontingFee0: 9382n, frontingFee1: 3233n,
            executionHandlerFeeAmount0: 2323n,
            executionHash: randomBytes32(),
            executionExpiry: 0
        });
        assert.isFalse(success);
    });

    it("Invalid get full amounts (overflow amount1)", async function () {
        const {contract, contractBtcTx, toParsedTx} = await loadFixture(deploy);
        const [success, amount0, amount1] = await contract.getFullAmounts({
            recipient: randomAddress(),
            amount0: 89123n, amount1: 32942n,
            callerFee0: 239n, callerFee1: 323n,
            frontingFee0: 9382n, frontingFee1: 0xfffffffffffffffen,
            executionHandlerFeeAmount0: 2323n,
            executionHash: randomBytes32(),
            executionExpiry: 0
        });
        assert.isFalse(success);
    });

    it("Valid get hash", async function() {
        const {contract} = await loadFixture(deploy);
        const struct = {
            recipient: randomAddress(),
            amount0: 89123n, amount1: 32942n,
            callerFee0: 239n, callerFee1: 323n,
            frontingFee0: 9382n, frontingFee1: 0xfffffffffffffffen,
            executionHandlerFeeAmount0: 2323n,
            executionHash: randomBytes32(),
            executionExpiry: 0n
        };
        const btcTxHash = randomBytes32();
        assert.strictEqual(getBitcoinVaultTransactionDataHash(struct, btcTxHash), await contract.hash(struct, btcTxHash));
    });
    
});
