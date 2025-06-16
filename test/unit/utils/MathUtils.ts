import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";

describe("MathUtils", function () {
    async function deploy() {
        const MathUtilsWrapper = await hre.ethers.getContractFactory("MathUtilsWrapper");
        const contract = await MathUtilsWrapper.deploy();

        return {contract};
    }

    it("Valid castToUint64", async function () {
        const {contract} = await loadFixture(deploy);
        const value = 13232n;
        const [success, result] = await contract.castToUint64(value);
        assert.strictEqual(result, value);
        assert.isTrue(success);
    });

    it("Valid castToUint64 overflow", async function () {
        const {contract} = await loadFixture(deploy);
        const value = 0xf8f66f56f5f55f67f8f9f0ff8f665f5fbfbcfn;
        const [success, result] = await contract.castToUint64(value);
        assert.isFalse(success);
    });

    it("Valid checkedSubUint64", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 1238182423n;
        const b = 323123132n;

        const [success, result] = await contract.checkedSubUint64(a, b);
        assert.isTrue(success);
        assert.strictEqual(result, a - b);
    });

    it("Valid checkedSubUint64, result 0", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 1238182423n;
        const b = 1238182423n;

        const [success, result] = await contract.checkedSubUint64(a, b);
        assert.isTrue(success);
        assert.strictEqual(result, a - b);
    });

    it("Valid checkedSubUint64, underflow", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 1238182423n;
        const b = 3128182423n;

        const [success, result] = await contract.checkedSubUint64(a, b);
        assert.isFalse(success);
    });

    it("Valid checkedSubUint64, big underflow", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 1238182423n;
        const b = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

        const [success, result] = await contract.checkedSubUint64(a, b);
        assert.isFalse(success);
    });

    it("Valid saturatingAddOneUint32", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12382423n;

        const result = await contract.saturatingAddOneUint32(a);
        assert.strictEqual(result, a + 1n);
    });

    it("Valid saturatingAddOneUint32, saturated", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 0xffffffffn;

        const result = await contract.saturatingAddOneUint32(a);
        assert.strictEqual(result, a);
    });

    it("Valid saturatingAddUint224", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12837123612n;
        const b = 2137123616236n;

        const result = await contract.saturatingAddUint224(a, b);
        assert.strictEqual(result, a + b);
    });

    it("Valid saturatingAddUint224, exact saturated", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 1n;
        const b = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffen;

        const result = await contract.saturatingAddUint224(a, b);
        assert.strictEqual(result, a + b);
    });

    it("Valid saturatingAddUint224, saturated", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12317237178238778n;
        const b = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

        const result = await contract.saturatingAddUint224(a, b);
        assert.strictEqual(result, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
    });

    it("Valid saturatingAddUint224, saturated, big summand", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12317237178238778n;
        const b = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

        const result = await contract.saturatingAddUint224(a, b);
        assert.strictEqual(result, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
    });

    it("Valid maxUint256, first is bigger", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12317237178238778n;
        const b = 82173123n;

        const result = await contract.maxUint256(a, b);
        assert.strictEqual(result, a);
    });

    it("Valid maxUint256, second is bigger", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 12317237178238778n;
        const b = 12312312312382173123n;

        const result = await contract.maxUint256(a, b);
        assert.strictEqual(result, b);
    });

    it("Valid maxUint256, equal", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 812736123n;
        const b = 812736123n;

        const result = await contract.maxUint256(a, b);
        assert.strictEqual(result, a);
        assert.strictEqual(result, b);
    });

    it("Valid maxUint256, zero", async function () {
        const {contract} = await loadFixture(deploy);
        
        const a = 0n;
        const b = 0n;

        const result = await contract.maxUint256(a, b);
        assert.strictEqual(result, 0n);
    });

});
