import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";
import { getSpvVaultParametersHash } from "../../utils/evm/spv_vault_parameters";
import { randomUnsignedBigInt } from "../../utils/random";

describe("SpvVaultState", function () {
    async function deploy() {
        const SpvVaultStateWrapper = await hre.ethers.getContractFactory("SpvVaultStateWrapper");
        const contract = await SpvVaultStateWrapper.deploy();

        return {contract};
    }

    it("Valid open", async function () {
        const {contract} = await loadFixture(deploy);

        const params = {
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        };
        const utxoTxHash = randomBytes32();
        const utxoVout = randomUnsignedBigInt(32);
        const result = await contract.open.staticCall({
            spvVaultParametersCommitment: randomBytes32(),
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        }, params, utxoTxHash, utxoVout);
        const blockNumber = await contract.runner.provider.getBlockNumber();

        assert.strictEqual(result.spvVaultParametersCommitment, getSpvVaultParametersHash(params));
        assert.strictEqual(result.utxoTxHash, utxoTxHash);
        assert.strictEqual(result.utxoVout, utxoVout);
        assert.strictEqual(result.openBlockheight, BigInt(blockNumber));
        assert.strictEqual(result.withdrawCount, 0n);
        assert.strictEqual(result.depositCount, 0n);
        assert.strictEqual(result.token0Amount, 0n);
        assert.strictEqual(result.token1Amount, 0n);
    });

    it("Valid close", async function () {
        const {contract} = await loadFixture(deploy);

        const result = await contract.close.staticCall({
            spvVaultParametersCommitment: randomBytes32(),
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        });
        
        assert.strictEqual(result.spvVaultParametersCommitment, "0x0000000000000000000000000000000000000000000000000000000000000000");
    });

    it("Valid is opened (true)", async function () {
        const {contract} = await loadFixture(deploy);

        const result = await contract.isOpened.staticCall({
            spvVaultParametersCommitment: randomBytes32(),
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        });
        assert.isTrue(result);
    });

    it("Valid is opened (false)", async function () {
        const {contract} = await loadFixture(deploy);

        const result = await contract.isOpened.staticCall({
            spvVaultParametersCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000",
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        });
        assert.isFalse(result);
    });

    it("Valid check opened and params", async function () {
        const {contract} = await loadFixture(deploy);

        const params = {
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        };

        await contract.checkOpenedAndParams({
            spvVaultParametersCommitment: getSpvVaultParametersHash(params),
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        }, params);
    });

    it("Invalid check opened and params (not opened)", async function () {
        const {contract} = await loadFixture(deploy);

        const params = {
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        };

        await expect(contract.checkOpenedAndParams({
            spvVaultParametersCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000",
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        }, params)).to.be.revertedWith("spvState: closed");
    });

    it("Invalid check opened and params (invalid params)", async function () {
        const {contract} = await loadFixture(deploy);

        const params = {
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        };

        await expect(contract.checkOpenedAndParams({
            spvVaultParametersCommitment: randomBytes32(),
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        }, params)).to.be.revertedWith("spvState: wrong params");
    });

    it("Valid withdraw", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();
        const btcTxHash = randomBytes32();
        const btcVout = randomUnsignedBigInt(32);

        const [result, success, withdrawCount, err] = await contract.withdraw.staticCall({
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        }, btcTxHash, btcVout, 100n, 50n);

        assert.isTrue(success);
        assert.strictEqual(withdrawCount, 2312n);

        assert.strictEqual(result.spvVaultParametersCommitment, spvVaultParametersCommitment);
        assert.strictEqual(result.utxoTxHash, btcTxHash);
        assert.strictEqual(result.utxoVout, btcVout);
        assert.strictEqual(result.openBlockheight, 123132n);
        assert.strictEqual(result.withdrawCount, 2312n + 1n);
        assert.strictEqual(result.depositCount, 123n);
        assert.strictEqual(result.token0Amount, 237832n - 100n);
        assert.strictEqual(result.token1Amount, 2332n - 50n);
    });
    
    it("Invalid withdraw (amount 0 withdraw too much)", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();
        const btcTxHash = randomBytes32();
        const btcVout = randomUnsignedBigInt(32);

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        };

        const [result, success, withdrawCount, err] = await contract.withdraw.staticCall(
            spvVaultState, btcTxHash, btcVout, 123918238123n, 50n
        );

        assert.isFalse(success);
        assert.strictEqual(err, "withdraw: amount 0");
        
        assert.strictEqual(result.spvVaultParametersCommitment, spvVaultState.spvVaultParametersCommitment);
        assert.strictEqual(result.utxoTxHash, spvVaultState.utxoTxHash);
        assert.strictEqual(result.utxoVout, spvVaultState.utxoVout);
        assert.strictEqual(result.openBlockheight, spvVaultState.openBlockheight);
        assert.strictEqual(result.withdrawCount, spvVaultState.withdrawCount);
        assert.strictEqual(result.depositCount, spvVaultState.depositCount);
        assert.strictEqual(result.token0Amount, spvVaultState.token0Amount);
        assert.strictEqual(result.token1Amount, spvVaultState.token1Amount);
    });

    it("Invalid withdraw (amount 1 withdraw too much)", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();
        const btcTxHash = randomBytes32();
        const btcVout = randomUnsignedBigInt(32);

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        };

        const [result, success, withdrawCount, err] = await contract.withdraw.staticCall(
            spvVaultState, btcTxHash, btcVout, 323n, 82173723n
        );

        assert.isFalse(success);
        assert.strictEqual(err, "withdraw: amount 1");
        
        assert.strictEqual(result.spvVaultParametersCommitment, spvVaultState.spvVaultParametersCommitment);
        assert.strictEqual(result.utxoTxHash, spvVaultState.utxoTxHash);
        assert.strictEqual(result.utxoVout, spvVaultState.utxoVout);
        assert.strictEqual(result.openBlockheight, spvVaultState.openBlockheight);
        assert.strictEqual(result.withdrawCount, spvVaultState.withdrawCount);
        assert.strictEqual(result.depositCount, spvVaultState.depositCount);
        assert.strictEqual(result.token0Amount, spvVaultState.token0Amount);
        assert.strictEqual(result.token1Amount, spvVaultState.token1Amount);
    });

    it("Valid deposit", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 237832n,
            token1Amount: 2332n
        };

        const [result, depositCount] = await contract.deposit.staticCall(
            spvVaultState, 32123233n, 82173723n
        );

        assert.strictEqual(depositCount, spvVaultState.depositCount);
        
        assert.strictEqual(result.spvVaultParametersCommitment, spvVaultState.spvVaultParametersCommitment);
        assert.strictEqual(result.utxoTxHash, spvVaultState.utxoTxHash);
        assert.strictEqual(result.utxoVout, spvVaultState.utxoVout);
        assert.strictEqual(result.openBlockheight, spvVaultState.openBlockheight);
        assert.strictEqual(result.withdrawCount, spvVaultState.withdrawCount);
        assert.strictEqual(result.depositCount, spvVaultState.depositCount + 1n);
        assert.strictEqual(result.token0Amount, spvVaultState.token0Amount + 32123233n);
        assert.strictEqual(result.token1Amount, spvVaultState.token1Amount + 82173723n);
    });

    it("Invalid deposit (amount 0 overflow)", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 981283712323n,
            token1Amount: 18237123732n
        };

        await expect(contract.deposit.staticCall(
            spvVaultState, 0xffffffffffffffffn, 82173723n
        )).to.be.revertedWithPanic(0x11);
    });

    it("Invalid deposit (amount 1 overflow)", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 123n,
            token0Amount: 981283712323n,
            token1Amount: 18237123732n
        };

        await expect(contract.deposit.staticCall(
            spvVaultState, 82173723n, 0xffffffffffffffffn
        )).to.be.revertedWithPanic(0x11);
    });

    it("Invalid deposit (deposit count overflow)", async function () {
        const {contract} = await loadFixture(deploy);

        const spvVaultParametersCommitment = randomBytes32();

        const spvVaultState = {
            spvVaultParametersCommitment,
            utxoTxHash: randomBytes32(),
            utxoVout: 332n,
            openBlockheight: 123132n,
            withdrawCount: 2312n,
            depositCount: 0xffffffffn,
            token0Amount: 981283712323n,
            token1Amount: 18237123732n
        };

        await expect(contract.deposit.staticCall(
            spvVaultState, 82173723n, 12323233n
        )).to.be.revertedWithPanic(0x11);
    });

});
