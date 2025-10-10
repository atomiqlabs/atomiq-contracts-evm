import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getExecutionSalt, randomBytes32, TRANSFER_OUT_MAX_GAS } from "../../utils/evm/utils";

describe("ExecutionContract(unit)", function () {
    async function deploy() {
        const WETH9 = await hre.ethers.getContractFactory("WETH9");
        const wethContract = await WETH9.deploy();

        const ExecutionContractWrapper = await hre.ethers.getContractFactory("ExecutionContractWrapper");
        const contract = await ExecutionContractWrapper.deploy(wethContract, TRANSFER_OUT_MAX_GAS);

        const [account1] = await hre.ethers.getSigners();

        return {contract, account1};
    }

    it("Random hash", async function () {
        const {contract, account1} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const creatorSalt = randomBytes32();
            assert.strictEqual(await contract.getSalt(creatorSalt), getExecutionSalt(account1.address, creatorSalt));
        }
    });

});
