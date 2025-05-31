import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { EscrowDataType, getEscrowHash, getRandomEscrowData } from "../../utils/evm/escrow_data";

describe("EscrowStorage", function () {
    async function deploy() {
        const EscrowStorageWrapper = await hre.ethers.getContractFactory("EscrowStorageWrapper");
        const contract = await EscrowStorageWrapper.deploy();

        async function commitAndAssert(escrowData: EscrowDataType) {
            const txResp = await contract.EscrowStorage_commit(escrowData);
            const responses = [
                await contract.getState(escrowData),
                await contract.getHashState(getEscrowHash(escrowData)),
                (await contract.getHashStateMultiple([getEscrowHash(escrowData)]))[0]
            ];
            responses.forEach(resultState => {
                assert.strictEqual(resultState.state, 1n);
                assert.strictEqual(resultState.initBlockheight, BigInt(txResp.blockNumber));
                assert.strictEqual(resultState.finishBlockheight, 0n);
            });
        }

        async function finalizeAndAssert(escrowData: EscrowDataType, success: boolean) {
            const prevState = await contract.getState(escrowData);
            const txResp = await contract.EscrowStorage_finalize(escrowData, success);
            const responses = [
                await contract.getState(escrowData),
                await contract.getHashState(getEscrowHash(escrowData)),
                (await contract.getHashStateMultiple([getEscrowHash(escrowData)]))[0]
            ];
            responses.forEach(resultState => {
                assert.strictEqual(resultState.state, success ? 2n : 3n);
                assert.strictEqual(resultState.initBlockheight, BigInt(prevState.initBlockheight));
                assert.strictEqual(resultState.finishBlockheight, BigInt(txResp.blockNumber));
            });
        }

        return {contract, commitAndAssert, finalizeAndAssert};
    }

    it("Commit", async function () {
        const {commitAndAssert} = await loadFixture(deploy);

        await commitAndAssert(getRandomEscrowData());
    });

    it("Invalid commit twice", async function () {
        const {contract} = await loadFixture(deploy);

        const escrowData = getRandomEscrowData();
        await contract.EscrowStorage_commit(escrowData);
        await expect(contract.EscrowStorage_commit(escrowData)).to.be.revertedWith("_commit: Already committed");
    });

    it("Commit 2 different", async function () {
        const {contract, commitAndAssert} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        const escrowData2 = getRandomEscrowData();
        await commitAndAssert(escrowData1);
        await commitAndAssert(escrowData2);

        const [resultState1, resultState2] = await contract.getHashStateMultiple([getEscrowHash(escrowData1), getEscrowHash(escrowData2)]);
        assert.strictEqual(resultState1.state, 1n);
        assert.strictEqual(resultState2.state, 1n);
    });

    it("Commit & finalize success", async function () {
        const {contract, commitAndAssert, finalizeAndAssert} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        await commitAndAssert(escrowData1);
        await finalizeAndAssert(escrowData1, true);
    });

    it("Commit & finalize not success", async function () {
        const {contract, commitAndAssert, finalizeAndAssert} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        await commitAndAssert(escrowData1);
        await finalizeAndAssert(escrowData1, false);
    });

    it("Invalid commit, finalize, try to re-commit", async function () {
        const {contract, commitAndAssert, finalizeAndAssert} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        await commitAndAssert(escrowData1);
        await finalizeAndAssert(escrowData1, false);
        await expect(contract.EscrowStorage_commit(escrowData1)).to.be.revertedWith("_commit: Already committed");
    });

    it("Invalid finalize, not committed", async function () {
        const {contract} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        await expect(contract.EscrowStorage_finalize(escrowData1, true)).to.be.revertedWith("_finalize: Not committed");
    });

    it("Commit 2 different, finalize 1", async function () {
        const {contract, commitAndAssert, finalizeAndAssert} = await loadFixture(deploy);

        const escrowData1 = getRandomEscrowData();
        const escrowData2 = getRandomEscrowData();
        await commitAndAssert(escrowData1);
        await commitAndAssert(escrowData2);
        await finalizeAndAssert(escrowData1, true);

        const [resultState1, resultState2] = await contract.getHashStateMultiple([getEscrowHash(escrowData1), getEscrowHash(escrowData2)]);
        assert.strictEqual(resultState1.state, 2n);
        assert.strictEqual(resultState2.state, 1n);
    });

});
