import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";

describe("Endianness", function () {
    async function deploy() {
        const EndiannessWrapper = await hre.ethers.getContractFactory("EndiannessWrapper");
        const contract = await EndiannessWrapper.deploy();

        return contract;
    }

    it("Reverse uint32", async function () {
        const contract = await loadFixture(deploy);
        assert.strictEqual(await contract.reverseUint32(0x03020100n), 0x00010203n);
        assert.strictEqual(await contract.reverseUint32(0x01000000n), 0x00000001n);
        assert.strictEqual(await contract.reverseUint32(0x0000ffffn), 0xffff0000n);
        assert.strictEqual(await contract.reverseUint32(0xffff0000n), 0x0000ffffn);
        assert.strictEqual(await contract.reverseUint32(0xff0000ffn), 0xff0000ffn);
        assert.strictEqual(await contract.reverseUint32(0x00000001n), 0x01000000n);
        assert.strictEqual(await contract.reverseUint32(0xffffffffn), 0xffffffffn);
        assert.strictEqual(await contract.reverseUint32(0x00000000n), 0x00000000n);
    });

    it("Reverse uint64", async function () {
        const contract = await loadFixture(deploy);
        assert.strictEqual(await contract.reverseUint64(0x0706050403020100n), 0x0001020304050607n);
        assert.strictEqual(await contract.reverseUint64(0x0100000000000000n), 0x0000000000000001n);
        assert.strictEqual(await contract.reverseUint64(0x0000ffff0000ffffn), 0xffff0000ffff0000n);
        assert.strictEqual(await contract.reverseUint64(0xffff0000ffff0000n), 0x0000ffff0000ffffn);
        assert.strictEqual(await contract.reverseUint64(0xff000000000000ffn), 0xff000000000000ffn);
        assert.strictEqual(await contract.reverseUint64(0x0000000100000001n), 0x0100000001000000n);
        assert.strictEqual(await contract.reverseUint64(0xffffffffffffffffn), 0xffffffffffffffffn);
        assert.strictEqual(await contract.reverseUint64(0x0000000000000000n), 0x0000000000000000n);
    });

    it("Reverse bytes32", async function () {
        const contract = await loadFixture(deploy);
        assert.strictEqual(await contract.reverseBytes32("0x1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100"), "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        assert.strictEqual(await contract.reverseBytes32("0x0100000000000000000000000000000000000000000000000000000000000000"), "0x0000000000000000000000000000000000000000000000000000000000000001");
        assert.strictEqual(await contract.reverseBytes32("0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff"), "0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000");
        assert.strictEqual(await contract.reverseBytes32("0xffff000000000000000000000000000000000000000000000000000000000000"), "0x000000000000000000000000000000000000000000000000000000000000ffff");
        assert.strictEqual(await contract.reverseBytes32("0xff000000000000000000000000000000000000000000000000000000000000ff"), "0xff000000000000000000000000000000000000000000000000000000000000ff");
        assert.strictEqual(await contract.reverseBytes32("0x0000000100000001000000010000000100000001000000010000000100000001"), "0x0100000001000000010000000100000001000000010000000100000001000000");
        assert.strictEqual(await contract.reverseBytes32("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"), "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        assert.strictEqual(await contract.reverseBytes32("0x0000000000000000000000000000000000000000000000000000000000000000"), "0x0000000000000000000000000000000000000000000000000000000000000000");
    });

});
