import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert} from "chai";
import hre from "hardhat";

async function deploy() {
    const DummyContract = await hre.ethers.getContractFactory("DummyContract");
    const dummyContract = await DummyContract.deploy();

    const [account1] = await hre.ethers.getSigners();

    return {account1, dummyContract};
}

describe("ContractCallUtils: strictCall", function () {
    it("Test gas burner (10k)", async function () {
        const {account1, dummyContract} = await loadFixture(deploy);

        const unsignedTx = await dummyContract.burn10k.populateTransaction();
        const tx = await account1.sendTransaction(unsignedTx);
        const receipt = await tx.wait();
        const gasUsed = Number(receipt.gasUsed) - 21_000;
        assert.isAtLeast(gasUsed, 10_000 - 50);
        assert.isAtMost(gasUsed, 10_000 + 50);
    });

    it("Test gas burner (100k)", async function () {
        const {account1, dummyContract} = await loadFixture(deploy);

        const unsignedTx = await dummyContract.burn100k.populateTransaction();
        const tx = await account1.sendTransaction(unsignedTx);
        const receipt = await tx.wait();
        const gasUsed = Number(receipt.gasUsed) - 21_000;
        assert.isAtLeast(gasUsed, 100_000 - 50);
        assert.isAtMost(gasUsed, 100_000 + 50);
    });

    it("Test gas burner (1M)", async function () {
        const {account1, dummyContract} = await loadFixture(deploy);

        const unsignedTx = await dummyContract.burn1m.populateTransaction();
        const tx = await account1.sendTransaction(unsignedTx);
        const receipt = await tx.wait();
        const gasUsed = Number(receipt.gasUsed) - 21_000;
        assert.isAtLeast(gasUsed, 1_000_000 - 100);
        assert.isAtMost(gasUsed, 1_000_000 + 100);
    });

    it("Test gas burner (5M)", async function () {
        const {account1, dummyContract} = await loadFixture(deploy);
        
        const unsignedTx = await dummyContract.burn5m.populateTransaction();
        const tx = await account1.sendTransaction(unsignedTx);
        const receipt = await tx.wait();
        const gasUsed = Number(receipt.gasUsed) - 21_000;
        assert.isAtLeast(gasUsed, 5_000_000 - 500);
        assert.isAtMost(gasUsed, 5_000_000 + 500);
    });
});