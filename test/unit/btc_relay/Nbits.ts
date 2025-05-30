import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { reverseUint32 } from "../../utils/endianness";
import { nbitsToTarget, targetTonBits } from "../../utils/nbits";

describe("Nbits", function () {
    async function deploy() {
        const NbitsWrapper = await hre.ethers.getContractFactory("NbitsWrapper");
        const contract = await NbitsWrapper.deploy();

        return contract;
    }

    it("Nbits to target", async function () {
        const contract = await loadFixture(deploy);
        assert.equal(await contract.toTarget(0x618c0217n), 0x028c610000000000000000000000000000000000000000n);
        assert.equal(await contract.toTarget(0xffff001dn), 0x00000000FFFF0000000000000000000000000000000000000000000000000000n)
    });

    it("Target to nbits", async function () {
        const contract = await loadFixture(deploy);
        assert.equal(await contract.toReversedNbits(0x028c610000000000000000000000000000000000000000n), 0x618c0217n);
    });

    //Test vectors from https://github.com/bitcoin/bitcoin/blob/master/src/test/arith_uint256_tests.cpp#L409
    it("Bitcoin core test vector", async function() {
        const contract = await loadFixture(deploy);
        {
            let target = await contract.toTarget(reverseUint32(0n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x00123456n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x01003456n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x02000056n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x03000000n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x04000000n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x00923456n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x01803456n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x02800056n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x03800000n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x04800000n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x01123456n));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000000012n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x01120000));
        }

        // Make sure that we don't generate compacts with the 0x00800000 bit set
        assert.strictEqual(await contract.toReversedNbits(0x80n), reverseUint32(0x02008000));

        {
            let target = await contract.toTarget(reverseUint32(0x02123456));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000001234n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x02123400));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x03123456));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000000123456n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x03123456));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x04123456));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000012345600n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x04123456));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x05009234));
            assert.strictEqual(target, 0x0000000000000000000000000000000000000000000000000000000092340000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x05009234));
        }
        {
            let target = await contract.toTarget(reverseUint32(0x20123456));
            assert.strictEqual(target, 0x1234560000000000000000000000000000000000000000000000000000000000n);
            assert.strictEqual(await contract.toReversedNbits(target), reverseUint32(0x20123456));
        }
    });

    //invalid vectors from https://github.com/bitcoin/bitcoin/blob/master/src/test/arith_uint256_tests.cpp#L409
    it("Bitcoin core negative nbits test vector", async function() {
        const contract = await loadFixture(deploy);
        await expect(contract.toTarget(reverseUint32(0x01fedcba))).to.be.revertedWith("Nbits: negative");
        await expect(contract.toTarget(reverseUint32(0x04923456))).to.be.revertedWith("Nbits: negative");
    });

    it("Random targets", async function () {
        const contract = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const target = BigInt("0x"+randomBytes(32).toString("hex")) >> BigInt(Math.floor(224 * Math.random()));
            const nbits = targetTonBits(target);
            assert.equal(await contract.toReversedNbits(target), reverseUint32(nbits));
            assert.equal(await contract.toTarget(reverseUint32(nbits)), nbitsToTarget(nbits));
        }
    });

});
