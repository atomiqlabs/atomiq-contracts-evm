import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { toBytes32 } from "../../utils/evm/utils";

describe("TimelockRefundHandler", function () {
    async function deploy() {
        const TimelockRefundHandler = await hre.ethers.getContractFactory("TimelockRefundHandler");
        const contract = await TimelockRefundHandler.deploy();

        return {contract};
    }

    it("Valid refund", async function () {
        const {contract} = await loadFixture(deploy);

        const timeout = 10_000_000_000n;
        const timeoutBytes = toBytes32(timeout);

        await hre.network.provider.send("evm_setNextBlockTimestamp", [10_000_001_000]);
        await hre.network.provider.send("evm_mine");
        assert.strictEqual(await contract.refund(timeoutBytes, "0x"), timeoutBytes);
    });

    it("Invalid refund, non-empty witness", async function () {
        const {contract} = await loadFixture(deploy);

        const timeout = 10_000_000_000n;
        const timeoutBytes = toBytes32(timeout);

        await hre.network.provider.send("evm_setNextBlockTimestamp", [10_000_001_000]);
        await hre.network.provider.send("evm_mine");
        await expect(contract.refund(timeoutBytes, "0xdeadbeef1337"), timeoutBytes).to.be.revertedWith("timestampLock: witness len!=0");
    });

    it("Invalid refund, not expired yet", async function () {
        const {contract} = await loadFixture(deploy);

        const timeout = 10_000_001_000n;
        const timeoutBytes = toBytes32(timeout);

        await hre.network.provider.send("evm_setNextBlockTimestamp", [10_000_000_000]);
        await hre.network.provider.send("evm_mine");
        await expect(contract.refund(timeoutBytes, "0x"), timeoutBytes).to.be.revertedWith("timestampLock: not expired");
    });

});
