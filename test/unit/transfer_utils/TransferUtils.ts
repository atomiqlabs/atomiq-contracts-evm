import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";

describe("TransferUtils", function () {
    async function deploy() {
        const TransferUtils = await hre.ethers.getContractFactory("TransferUtilsWrapper");
        const contract = await TransferUtils.deploy();

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();

        const InfiniteLoopContract = await hre.ethers.getContractFactory("InfiniteLoopContract");
        const infiniteLoopContract = await InfiniteLoopContract.deploy();

        const [account1, account2] = await hre.ethers.getSigners();

        return {contract, erc20Contract1, account1, account2, infiniteLoopContract};
    }

    it("Valid balance of (erc-20)", async function () {
        const {contract, erc20Contract1, account1} = await loadFixture(deploy);

        const recipient = randomAddress();
        await erc20Contract1.transfer(recipient, 1000n);
        assert.strictEqual(await contract.balanceOf(await erc20Contract1.getAddress(), recipient), 1000n);
    });

    it("Valid balance of (native token)", async function () {
        const {contract, erc20Contract1, account1} = await loadFixture(deploy);

        const recipient = randomAddress();
        await account1.sendTransaction({to: recipient, value: 1000n});
        assert.strictEqual(await contract.balanceOf("0x0000000000000000000000000000000000000000", recipient), 1000n);
    });

    it("Valid transfer in (erc-20)", async function () {
        const {contract, erc20Contract1, account1} = await loadFixture(deploy);

        await erc20Contract1.approve(await contract.getAddress(), 1000n);
        await contract.transferIn(await erc20Contract1.getAddress(), account1.address, 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1000n);
    });

    it("Valid transfer in (erc-20 not from caller)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        await erc20Contract1.approve(await contract.getAddress(), 1000n);
        await contract.connect(account2).transferIn(await erc20Contract1.getAddress(), account1.address, 1000n); //Call as account2
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1000n);
    });

    it("Invalid transfer in, not enough balance (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        await erc20Contract1.transfer(account2.address, 100n); //Don't transfer enough
        await erc20Contract1.connect(account2).approve(await contract.getAddress(), 1000n);
        await expect(
            contract.connect(account2).transferIn(await erc20Contract1.getAddress(), account2.address, 1000n)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
    });

    it("Invalid transfer in, not enough allowance (erc-20)", async function () {
        const {contract, erc20Contract1, account1} = await loadFixture(deploy);

        await erc20Contract1.approve(await contract.getAddress(), 500n);
        await expect(
            contract.transferIn(await erc20Contract1.getAddress(), account1.address, 1000n)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientAllowance");
    });

    it("Valid transfer in (native token)", async function () {
        const {contract, erc20Contract1, account1} = await loadFixture(deploy);

        await contract.transferIn("0x0000000000000000000000000000000000000000", account1.address, 1000n, {value: 1000n});
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
    });

    it("Invalid transfer in (native token not from caller)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        await expect(
            contract.connect(account2).transferIn("0x0000000000000000000000000000000000000000", account1.address, 1000n, {value: 1000n})
        ).to.be.revertedWith("transferIn: sender not src");
    });

    it("Invalid transfer in not enough msg.value provided (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        await expect(
            contract.transferIn("0x0000000000000000000000000000000000000000", account1.address, 1000n, {value: 500n})
        ).to.be.revertedWith("transferIn: value too low");
    });

    it("Valid transfer out (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await contract.transferOut(await erc20Contract1.getAddress(), recipient, 500n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 500n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await expect(
            contract.transferOut(await erc20Contract1.getAddress(), recipient, 2000n)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
    });

    it("Valid transfer out (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await contract.transferOut("0x0000000000000000000000000000000000000000", recipient, 500n);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 500n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOut("0x0000000000000000000000000000000000000000", recipient, 2000n)
        ).to.be.revertedWith("transferOut: native xfer fail");
    });

    it("Invalid transfer out, target reverted or ran out of gas (native token)", async function () {
        const {contract, erc20Contract1, account1, account2, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOut("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.be.revertedWith("transferOut: native xfer fail");
    });

    it("Valid transfer out (no revert) (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await expect(
            contract.transferOutNoRevert(await erc20Contract1.getAddress(), recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(true);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 500n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (no revert) (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await expect(
            contract.transferOutNoRevert(await erc20Contract1.getAddress(), recipient, 2000n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(false);
        //Ensure nothing was transfered
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 0n);
    });

    it("Valid transfer out (no revert) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(true);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 500n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (no revert) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 2000n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(false);
        //Ensure nothing was transfered
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });

    it("Invalid transfer out, target reverted or ran out of gas (no revert) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(false);
        //Ensure nothing was transfered
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });

});
