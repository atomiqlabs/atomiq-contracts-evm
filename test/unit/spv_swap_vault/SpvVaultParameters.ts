import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getSpvVaultBtcTx, getValidSpvVaultBtcTx } from "./generators/spv_vault_btc_tx";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";
import { Transaction } from "bitcoinjs-lib";
import { toBuffer } from "../../utils/buffer_utils";
import { getSpvVaultParametersHash } from "../../utils/evm/spv_vault_parameters";

describe("SpvVaultParameters", function () {
    async function deploy() {
        const SpvVaultParametersWrapper = await hre.ethers.getContractFactory("SpvVaultParametersWrapper");
        const contract = await SpvVaultParametersWrapper.deploy();

        return {contract};
    }

    it("Valid from raw token0", async function () {
        const {contract} = await loadFixture(deploy);

        const result = await contract.fromRawToken0({
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 9812831823n,
            token1Multiplier: 590390490234n,
            confirmations: 3n
        }, 123123n)

        assert.strictEqual(result, 9812831823n * 123123n);
    });

    it("Valid from raw token1", async function () {
        const {contract} = await loadFixture(deploy);

        const result = await contract.fromRawToken1({
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        }, 937562n)

        assert.strictEqual(result, 937562n * 874732732n);
    });

    it("Valid from raw", async function () {
        const {contract} = await loadFixture(deploy);

        const [result0, result1] = await contract.fromRaw({
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        }, 937562n, 237832n)

        assert.strictEqual(result0, 937562n * 823723732n);
        assert.strictEqual(result1, 237832n * 874732732n);
    });

    it("Valid hash", async function () {
        const {contract} = await loadFixture(deploy);

        const struct = {
            btcRelayContract: randomAddress(),
            token0: randomAddress(),
            token1: randomAddress(),
            token0Multiplier: 823723732n,
            token1Multiplier: 874732732n,
            confirmations: 3n
        };
        const result = await contract.hash(struct);

        assert.strictEqual(result, getSpvVaultParametersHash(struct));
    });
    
});
