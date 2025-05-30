import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { fromBuffer } from "../../utils/buffer_utils";

describe("ReputationTracker", function () {
    async function deploy() {
        const ReputationTrackerWrapper = await hre.ethers.getContractFactory("ReputationTrackerWrapper");
        const contract = await ReputationTrackerWrapper.deploy();
        const [owner, otherOwner] = await hre.ethers.getSigners();
        
        return {contract, owner, otherOwner};
    }

    it("Update reputation", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 4877213n);
        let result = await contract.getState([{owner, claimHandler: "0x0000000000000000000000000000000000000000", token: "0x0000000000000000000000000000000000000000"}]);
        assert.strictEqual(result[0][0].count, 1n);
        assert.strictEqual(result[0][0].amount, 4877213n);
        assert.strictEqual(result[0][1].count, 0n);
        assert.strictEqual(result[0][1].amount, 0n);
        assert.strictEqual(result[0][2].count, 0n);
        assert.strictEqual(result[0][2].amount, 0n);

        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 84451485n);
        result = await contract.getState([{owner, claimHandler: "0x0000000000000000000000000000000000000000", token: "0x0000000000000000000000000000000000000000"}]);
        assert.strictEqual(result[0][0].count, 2n);
        assert.strictEqual(result[0][0].amount, 4877213n + 84451485n);
        assert.strictEqual(result[0][1].count, 0n);
        assert.strictEqual(result[0][1].amount, 0n);
        assert.strictEqual(result[0][2].count, 0n);
        assert.strictEqual(result[0][2].amount, 0n);
    });

    it("Update reputation multiple types", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 4877213n);
        await contract.ReputationTracker_updateReputation(1n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 84451485n);
        await contract.ReputationTracker_updateReputation(2n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 844518n);
        let result = await contract.getState([{owner, claimHandler: "0x0000000000000000000000000000000000000000", token: "0x0000000000000000000000000000000000000000"}]);
        assert.strictEqual(result[0][0].count, 1n);
        assert.strictEqual(result[0][0].amount, 4877213n);
        assert.strictEqual(result[0][1].count, 1n);
        assert.strictEqual(result[0][1].amount, 84451485n);
        assert.strictEqual(result[0][2].count, 1n);
        assert.strictEqual(result[0][2].amount, 844518n);
    });

    it("Update reputation multiple tokens", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000", 4877213n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000000", 84451485n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000000", 844518n);
        let result = await contract.getState([
            {owner, token: "0x0000000000000000000000000000000000000001", claimHandler: "0x0000000000000000000000000000000000000000"},
            {owner, token: "0x0000000000000000000000000000000000000002", claimHandler: "0x0000000000000000000000000000000000000000"},
            {owner, token: "0x0000000000000000000000000000000000000003", claimHandler: "0x0000000000000000000000000000000000000000"},
        ]);
        assert.strictEqual(result[0][0].count, 1n);
        assert.strictEqual(result[0][0].amount, 4877213n);
        assert.strictEqual(result[1][0].count, 1n);
        assert.strictEqual(result[1][0].amount, 84451485n);
        assert.strictEqual(result[2][0].count, 1n);
        assert.strictEqual(result[2][0].amount, 844518n);
    });

    it("Update reputation multiple claim handlers", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000001", 4877213n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000002", 84451485n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000003", 844518n);
        let result = await contract.getState([
            {owner, token: "0x0000000000000000000000000000000000000000", claimHandler: "0x0000000000000000000000000000000000000001"},
            {owner, token: "0x0000000000000000000000000000000000000000", claimHandler: "0x0000000000000000000000000000000000000002"},
            {owner, token: "0x0000000000000000000000000000000000000000", claimHandler: "0x0000000000000000000000000000000000000003"},
        ]);
        assert.strictEqual(result[0][0].count, 1n);
        assert.strictEqual(result[0][0].amount, 4877213n);
        assert.strictEqual(result[1][0].count, 1n);
        assert.strictEqual(result[1][0].amount, 84451485n);
        assert.strictEqual(result[2][0].count, 1n);
        assert.strictEqual(result[2][0].amount, 844518n);
    });

    it("Update reputation multiple tokens & claim handlers", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000004", 4877213n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000005", 84451485n);
        await contract.ReputationTracker_updateReputation(0n, owner, "0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000006", 844518n);
        let result = await contract.getState([
            {owner, token: "0x0000000000000000000000000000000000000001", claimHandler: "0x0000000000000000000000000000000000000004"},
            {owner, token: "0x0000000000000000000000000000000000000002", claimHandler: "0x0000000000000000000000000000000000000005"},
            {owner, token: "0x0000000000000000000000000000000000000003", claimHandler: "0x0000000000000000000000000000000000000006"},
        ]);
        assert.strictEqual(result[0][0].count, 1n);
        assert.strictEqual(result[0][0].amount, 4877213n);
        assert.strictEqual(result[1][0].count, 1n);
        assert.strictEqual(result[1][0].amount, 84451485n);
        assert.strictEqual(result[2][0].count, 1n);
        assert.strictEqual(result[2][0].amount, 844518n);
    });
    
    it("Update reputation type out of bounds", async function () {
        const {contract, owner} = await loadFixture(deploy);
        await expect(
            contract.ReputationTracker_updateReputation(3n, owner, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000004", 4877213n)
        ).to.be.revertedWithPanic(0x32);
    });
});
