import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";

describe("ReputationState", function () {
    async function deploy() {
        const ReputationStateWrapper = await hre.ethers.getContractFactory("ReputationStateWrapper");
        const contract = await ReputationStateWrapper.deploy();

        return {contract};
    }

    it("Test updates", async function () {
        const {contract} = await loadFixture(deploy);

        {
            let reputationState = {amount: 0n, count: 0n};
            reputationState = await contract.update.staticCall(reputationState, 8847182778182n);
            assert.strictEqual(reputationState.amount, 8847182778182n);
            assert.strictEqual(reputationState.count, 1n);
        }
        {
            let reputationState = {amount: 0n, count: 0n};
            await contract.update(reputationState, 0n)
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 0n);
            assert.strictEqual(reputationState.count, 1n);
        }
        {
            let reputationState = {amount: 0n, count: 0n};
            await contract.update(reputationState, 845132n);
            reputationState = await contract.read();
            await contract.update({amount: reputationState.amount, count: reputationState.count}, 1221000n);
            reputationState = await contract.read();
            await contract.update({amount: reputationState.amount, count: reputationState.count}, 411100n);
            reputationState = await contract.read();
            await contract.update({amount: reputationState.amount, count: reputationState.count}, 984431n);
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 845132n + 1221000n + 411100n + 984431n);
            assert.strictEqual(reputationState.count, 4n);
        }
    });

    it("Test overflowing", async function () {
        const {contract} = await loadFixture(deploy);

        {
            let reputationState = {amount: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn, count: 0xffffffffn};
            await contract.update(reputationState, 3912387842n);
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            assert.strictEqual(reputationState.count, 0xffffffffn);
        }
        {
            let reputationState = {amount: 0n, count: 0n};
            await contract.update(reputationState, 0x8fffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            reputationState = await contract.read();
            await contract.update({amount: reputationState.amount, count: reputationState.count}, 0x8fffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            assert.strictEqual(reputationState.count, 2n);
        }
        {
            let reputationState = {amount: 0n, count: 0n};
            await contract.update(reputationState, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn);
            assert.strictEqual(reputationState.count, 1n);
        }
        {
            let reputationState = {amount: 0n, count: 0xfffffffen};
            await contract.update(reputationState, 84315451232n);
            reputationState = await contract.read();
            await contract.update({amount: reputationState.amount, count: reputationState.count}, 8948318684331n);
            reputationState = await contract.read();
            assert.strictEqual(reputationState.amount, 84315451232n + 8948318684331n);
            assert.strictEqual(reputationState.count, 0xffffffffn);
        }
    });

});
