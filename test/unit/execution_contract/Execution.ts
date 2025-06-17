import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getExecutionHash, getRandomExecution } from "../../utils/evm/execution";

describe("Execution", function () {
    async function deploy() {
        const ExecutionWrapper = await hre.ethers.getContractFactory("ExecutionWrapper");
        const contract = await ExecutionWrapper.deploy();

        return {contract};
    }

    it("Random hash", async function () {
        const {contract} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const executionData = getRandomExecution();
            assert.strictEqual(await contract.hash(executionData), getExecutionHash(executionData));
        }
    });

});
