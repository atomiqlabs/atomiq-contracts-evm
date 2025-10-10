import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, TRANSFER_OUT_MAX_GAS } from "../../utils/evm/utils";

const ETH_MAGIC_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("LpVault", function () {
    async function deploy() {
        const WETH9 = await hre.ethers.getContractFactory("WETH9");
        const wethContract = await WETH9.deploy();

        const LpVaultWrapper = await hre.ethers.getContractFactory("LpVaultWrapper");
        const contract = await LpVaultWrapper.deploy(wethContract, TRANSFER_OUT_MAX_GAS);

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract = await ERC20.deploy();

        const [account1, account2] = await hre.ethers.getSigners();

        await erc20Contract.transfer(account2, 1_000_000_000_000_000_000n);

        return {contract, erc20Contract, account1, account2};
    }

    it("Deposit", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);

        assert.strictEqual(await erc20Contract.balanceOf(await contract.getAddress()), 1000n);
        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 1000n);
    });

    it("2 Deposits", async function () {
        const {contract, erc20Contract, account1, account2} = await loadFixture(deploy);

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);

        await erc20Contract.connect(account2).approve(await contract.getAddress(), 2000n);
        await contract.connect(account2).deposit(await erc20Contract.getAddress(), 2000n);

        assert.strictEqual(await erc20Contract.balanceOf(await contract.getAddress()), 3000n);
        const balances = await contract.getBalance([
            { token: await erc20Contract.getAddress(), owner: account1.address },
            { token: await erc20Contract.getAddress(), owner: account2.address },
        ]);
        assert.strictEqual(balances[0], 1000n);
        assert.strictEqual(balances[1], 2000n);
    });

    it("Invalid deposit not enough funds", async function () {
        const {contract, erc20Contract, account2} = await loadFixture(deploy);

        await erc20Contract.connect(account2).approve(await contract.getAddress(), 2_000_000_000_000_000_000n);
        await expect(contract.connect(account2).deposit(await erc20Contract.getAddress(), 2_000_000_000_000_000_000n)).to.be.revertedWithCustomError(erc20Contract, "ERC20InsufficientBalance");
    });

    it("Invalid deposit not enough allowance", async function () {
        const {contract, erc20Contract} = await loadFixture(deploy);

        await erc20Contract.approve(await contract.getAddress(), 500n);
        await expect(contract.deposit(await erc20Contract.getAddress(), 1000n)).to.be.revertedWithCustomError(erc20Contract, "ERC20InsufficientAllowance");
    });

    it("Deposit ETH", async function () {
        const {contract, account1} = await loadFixture(deploy);

        const tx = await contract.deposit.populateTransaction(ETH_MAGIC_ADDRESS, 1000n);
        tx.value = 1000n;
        await account1.sendTransaction(tx);

        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
        assert.strictEqual((await contract.getBalance([{
            token: ETH_MAGIC_ADDRESS,
            owner: account1.address
        }]))[0], 1000n);
    });

    it("Deposit ETH, more than required", async function () {
        const {contract, account1} = await loadFixture(deploy);

        const tx = await contract.deposit.populateTransaction(ETH_MAGIC_ADDRESS, 1000n);
        tx.value = 1500n; //Put more eth into the transaction value than required
        await account1.sendTransaction(tx);

        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1500n);
        assert.strictEqual((await contract.getBalance([{
            token: ETH_MAGIC_ADDRESS,
            owner: account1.address
        }]))[0], 1000n);
    });

    it("Invalid deposit ETH, too low tx.value", async function () {
        const {contract, account1} = await loadFixture(deploy);

        const tx = await contract.deposit.populateTransaction(ETH_MAGIC_ADDRESS, 1000n);
        tx.value = 999n;
        await expect(account1.sendTransaction(tx)).to.be.revertedWith("transferIn: value too low");
    });

    it("Invalid deposit ETH, not enough balance", async function () {
        const {contract, account1} = await loadFixture(deploy);

        const balance = await account1.provider.getBalance(account1.address);
        const tx = await contract.deposit.populateTransaction(ETH_MAGIC_ADDRESS, balance + 1000n);
        tx.value = balance + 1000n;
        await expect(account1.sendTransaction(tx)).to.be.rejectedWith("Sender doesn't have enough funds to send tx.");
    });

    it("Withdraw", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        const randomRecipient = randomAddress();

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);
        await contract.withdraw(await erc20Contract.getAddress(), 500n, randomRecipient);

        assert.strictEqual(await erc20Contract.balanceOf(await contract.getAddress()), 500n);
        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 500n);
        assert.strictEqual(await erc20Contract.balanceOf(randomRecipient), 500n);
    });

    it("Withdraw ETH", async function () {
        const {contract, account1} = await loadFixture(deploy);

        const randomRecipient = randomAddress();

        const tx = await contract.deposit.populateTransaction(ETH_MAGIC_ADDRESS, 1000n);
        tx.value = 1000n;
        await account1.sendTransaction(tx);
        await contract.withdraw(ETH_MAGIC_ADDRESS, 500n, randomRecipient);


        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 500n);
        assert.strictEqual((await contract.getBalance([{
            token: ETH_MAGIC_ADDRESS,
            owner: account1.address
        }]))[0], 500n);
        assert.strictEqual(await account1.provider.getBalance(randomRecipient), 500n);
    });

    it("Withdraw all", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        const randomRecipient = randomAddress();

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);
        await contract.withdraw(await erc20Contract.getAddress(), 1000n, randomRecipient);

        assert.strictEqual(await erc20Contract.balanceOf(await contract.getAddress()), 0n);
        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 0n);
        assert.strictEqual(await erc20Contract.balanceOf(randomRecipient), 1000n);
    });

    it("Invalid withdraw more than deposited", async function () {
        const {contract, erc20Contract} = await loadFixture(deploy);

        const randomRecipient = randomAddress();

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);
        await expect(contract.withdraw(await erc20Contract.getAddress(), 2000n, randomRecipient)).to.be.revertedWith("withdraw: not enough balance");
    });

    it("Invalid withdraw more than deposited (contract has enough token)", async function () {
        const {contract, erc20Contract, account2} = await loadFixture(deploy);

        const randomRecipient = randomAddress();

        await erc20Contract.approve(await contract.getAddress(), 1000n);
        await contract.deposit(await erc20Contract.getAddress(), 1000n);

        //Deposit more tokens from account2, such that contract actually has enough balance to honor the withdrawal
        await erc20Contract.connect(account2).approve(await contract.getAddress(), 2000n);
        await contract.connect(account2).deposit(await erc20Contract.getAddress(), 2000n);

        await expect(contract.withdraw(await erc20Contract.getAddress(), 2000n, randomRecipient)).to.be.revertedWith("withdraw: not enough balance");
    });

    it("Transfer out", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        await contract.LpVault_transferOut(await erc20Contract.getAddress(), account1.address, 1000n);

        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 1000n);
    });

    it("Transfer in", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        await contract.LpVault_transferOut(await erc20Contract.getAddress(), account1.address, 1000n);
        await contract.LpVault_transferIn(await erc20Contract.getAddress(), account1.address, 500n);

        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 500n);
    });

    it("Transfer in all", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        await contract.LpVault_transferOut(await erc20Contract.getAddress(), account1.address, 1000n);
        await contract.LpVault_transferIn(await erc20Contract.getAddress(), account1.address, 1000n);

        assert.strictEqual((await contract.getBalance([{
            token: await erc20Contract.getAddress(),
            owner: account1.address
        }]))[0], 0n);
    });

    it("Invalid transfer in, more than owned", async function () {
        const {contract, erc20Contract, account1} = await loadFixture(deploy);

        await contract.LpVault_transferOut(await erc20Contract.getAddress(), account1.address, 1000n);
        await expect(contract.LpVault_transferIn(await erc20Contract.getAddress(), account1.address, 2000n)).to.be.revertedWith("_xferIn: not enough balance");
    });
});
