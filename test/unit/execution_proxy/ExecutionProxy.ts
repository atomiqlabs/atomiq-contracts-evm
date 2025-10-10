import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, randomBytes32, TRANSFER_OUT_MAX_GAS } from "../../utils/evm/utils";

describe("ExecutionProxy", function () {
    async function deploy() {
        const WETH9 = await hre.ethers.getContractFactory("WETH9");
        const wethContract = await WETH9.deploy();

        const ExecutionProxy = await hre.ethers.getContractFactory("ExecutionProxy");
        const contract = await ExecutionProxy.deploy(wethContract, TRANSFER_OUT_MAX_GAS);

        const DummyContract = await hre.ethers.getContractFactory("DummyContract");
        const dummyContract = await DummyContract.deploy();

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();
        const erc20Contract2 = await ERC20.deploy();

        const [account1, account2] = await hre.ethers.getSigners();

        await erc20Contract1.transfer(account2, 1_000_000_000_000_000_000n);
        await erc20Contract2.transfer(account2, 1_000_000_000_000_000_000n);

        return {contract, dummyContract, erc20Contract1, erc20Contract2, account1, account2};
    }

    it("Valid execute", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        await expect(contract.execute([{
            target: await dummyContract.getAddress(),
            value: 0n,
            data
        }])).to.emit(dummyContract, "Event").withArgs("0x01020304");
    });
    
    it("Valid execute (payable)", async function () {
        const {contract, dummyContract, account1} = await loadFixture(deploy);

        const {data} = await dummyContract.callPayable.populateTransaction("0x01020304");

        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });

        await expect(contract.execute([{
            target: await dummyContract.getAddress(),
            value: 1000n,
            data
        }])).to.emit(dummyContract, "PayableEvent").withArgs(1000n, "0x01020304");
    });

    it("Valid execute (revert)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const revertString = "Hello world";
        const {data} = await dummyContract.callRevert.populateTransaction(revertString);
        
        await expect(contract.execute([{
            target: await dummyContract.getAddress(),
            value: 0n,
            data
        }])).to.be.revertedWith(revertString);
    });

    it("Valid execute (contract doesn't exist)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        await contract.execute([{
            target: randomAddress(),
            value: 0n,
            data
        }]);
    });

    it("Valid execute (out of gas)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.outOfGas.populateTransaction();
        
        await expect(contract.execute([{
            target: await dummyContract.getAddress(),
            value: 0n,
            data
        }])).to.be.revertedWithoutReason();
    });

    it("Valid drainAll (erc-20)", async function () {
        const {contract, dummyContract, erc20Contract1, account1, account2} = await loadFixture(deploy);
        
        const recipient = randomAddress();
        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1000n);

        await contract.drainTokens(await erc20Contract1.getAddress(), [], recipient);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 1000n);
    });

    it("Valid drainAll (erc-20)", async function () {
        const {contract, erc20Contract1} = await loadFixture(deploy);
        
        const recipient = randomAddress();
        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1000n);

        await contract.drainTokens(await erc20Contract1.getAddress(), [], recipient);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 1000n);
    });
    
    it("Valid drainAll (native)", async function () {
        const {contract, account1} = await loadFixture(deploy);
        
        const recipient = randomAddress();
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);

        await contract.drainTokens("0x0000000000000000000000000000000000000000", [], recipient);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 0n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 1000n);
    });
    
    it("Valid drainAll (native & 2x erc-20)", async function () {
        const {contract, account1, erc20Contract1, erc20Contract2} = await loadFixture(deploy);
        
        const recipient = randomAddress();
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });
        await erc20Contract1.transfer(await contract.getAddress(), 2000n);
        await erc20Contract2.transfer(await contract.getAddress(), 3000n);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 2000n);
        assert.strictEqual(await erc20Contract2.balanceOf(await contract.getAddress()), 3000n);

        await contract.drainTokens("0x0000000000000000000000000000000000000000", [await erc20Contract1.getAddress(), await erc20Contract2.getAddress()], recipient);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract2.balanceOf(await contract.getAddress()), 0n);

        assert.strictEqual(await account1.provider.getBalance(recipient), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 2000n);
        assert.strictEqual(await erc20Contract2.balanceOf(recipient), 3000n);
    });

    it("Valid drainAll (native & 2x erc-20, with contract having 0 balance of 1 of the token)", async function () {
        const {contract, account1, erc20Contract1, erc20Contract2} = await loadFixture(deploy);
        
        const recipient = randomAddress();
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });
        await erc20Contract1.transfer(await contract.getAddress(), 2000n);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 2000n);
        assert.strictEqual(await erc20Contract2.balanceOf(await contract.getAddress()), 0n);

        await contract.drainTokens("0x0000000000000000000000000000000000000000", [await erc20Contract1.getAddress(), await erc20Contract2.getAddress()], recipient);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 0n);
        assert.strictEqual(await erc20Contract2.balanceOf(await contract.getAddress()), 0n);

        assert.strictEqual(await account1.provider.getBalance(recipient), 1000n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 2000n);
        assert.strictEqual(await erc20Contract2.balanceOf(recipient), 0n);
    });

});
