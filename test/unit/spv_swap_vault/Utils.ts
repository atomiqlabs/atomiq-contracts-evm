import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { randomAddress } from "../../utils/evm/utils";
import { toBuffer } from "../../utils/buffer_utils";
import { randomUnsignedBigInt } from "../../utils/random";

describe("Utils", function () {
    async function deploy() {
        const UtilsWrapper = await hre.ethers.getContractFactory("UtilsWrapper");
        const contract = await UtilsWrapper.deploy();

        return {contract};
    }

    it("Valid pack address and vault id", async function () {
        const {contract} = await loadFixture(deploy);

        const address = randomAddress();
        const vaultId = randomUnsignedBigInt(96);
        const result = await contract.packAddressAndVaultId(address, vaultId);
        
        assert.strictEqual(result, "0x"+Buffer.concat([
            Buffer.from(address.substring(2), "hex"),
            toBuffer(vaultId, 12, "be")
        ]).toString("hex"));
    });

    it("Valid calculate fee", async function () {
        const {contract} = await loadFixture(deploy);

        {
            const [success, result] = await contract.calculateFee(1000n, 10_000n);
            assert.isTrue(success);
            assert.strictEqual(result, 100n);
        }
        {
            const [success, result] = await contract.calculateFee(5000n, 5_000n);
            assert.isTrue(success);
            assert.strictEqual(result, 250n);
        }
        {
            const [success, result] = await contract.calculateFee(901234981283n, 0n);
            assert.isTrue(success);
            assert.strictEqual(result, 0n);
        }
        {
            const [success, result] = await contract.calculateFee(9012349n, 1_000_000n);
            assert.isTrue(success);
            assert.strictEqual(result, 9012349n * 10n);
        }
    });

    it("Invalid calculate fee (overflow)", async function () {
        const {contract} = await loadFixture(deploy);
        
        {
            const [success] = await contract.calculateFee(0xfffffffffffffffen, 100_001n);
            assert.isFalse(success);
        }
        {
            const [success] = await contract.calculateFee(0xffffffffffffffffn, 100_001n);
            assert.isFalse(success);
        }
        {
            const [success] = await contract.calculateFee(0xffffffffffffffffn / 5n, 1_000_000n);
            assert.isFalse(success);
        }
        {
            const [success] = await contract.calculateFee(0xfffffffffffffffn, 1_610_000n);
            assert.isFalse(success);
        }
    });

    it("Calculate fee random", async function () {
        const {contract} = await loadFixture(deploy);

        for(let i=0;i<100;i++) {
            const randomValue = randomUnsignedBigInt(60);
            const randomFeeRate = randomUnsignedBigInt(24);

            const [success, result] = await contract.calculateFee(randomValue, randomFeeRate);
            const expectedResult = (randomValue * randomFeeRate / 100_000n);
            const expectedSuccess = expectedResult < 0x10000000000000000n;
            assert.strictEqual(success, expectedResult < 0x10000000000000000n);
            if(expectedSuccess) assert.strictEqual(result, expectedResult);
        }
    });
});
