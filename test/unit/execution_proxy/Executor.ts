import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";

describe("Executor", function () {
    async function deploy() {
        const ExecutorWrapper = await hre.ethers.getContractFactory("ExecutorWrapper");
        const contract = await ExecutorWrapper.deploy();

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

    it("Valid execute (success)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        const recipient = randomAddress();

        const promise = contract.execute("0x0000000000000000000000000000000000000000", 0n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient);

        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");
    });

    it("Valid execute (success, multiple calls)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data: data1} = await dummyContract.call.populateTransaction("0x01020304");
        const {data: data2} = await dummyContract.call.populateTransaction("0x05060708");
        
        const recipient = randomAddress();

        const promise = contract.execute("0x0000000000000000000000000000000000000000", 0n, {
            gasLimit: 100_000n,
            calls: [
                {
                    target: await dummyContract.getAddress(),
                    data: data1,
                    value: 0n
                },
                {
                    target: await dummyContract.getAddress(),
                    data: data2,
                    value: 0n
                }
            ],
            drainTokens: []
        }, recipient);

        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x05060708");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");
    });

    it("Valid execute (run out of gas)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        const recipient = randomAddress();

        await expect(contract.execute("0x0000000000000000000000000000000000000000", 0n, {
            gasLimit: 1000n, //Too little gas limit
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient)).to.emit(contract, "ExecutorWrapperEvent").withArgs(false, "0x");
    });

    it("Valid execute (rejection in contract call)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.callRevert.populateTransaction("Hello");
        
        const recipient = randomAddress();

        await expect(contract.execute("0x0000000000000000000000000000000000000000", 0n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient)).to.emit(contract, "ExecutorWrapperEvent").withArgs(false, "0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000548656c6c6f000000000000000000000000000000000000000000000000000000");
    });

    it("Valid execute (0 gas limit)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304050402");
        
        const recipient = randomAddress();

        await expect(contract.execute("0x0000000000000000000000000000000000000000", 0n, {
            gasLimit: 0n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient)).to.emit(contract, "ExecutorWrapperEvent").withArgs(false, "0x"+Buffer.from("_execute(): gasLimit is zero").toString("hex"));
    });

    it("Valid execute (erc-20)", async function () {
        const {contract, dummyContract, erc20Contract1} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        const recipient = randomAddress();
        
        //Make sure contract has enough funds
        await erc20Contract1.transfer(await contract.getAddress(), 1000n);

        const promise = contract.execute(await erc20Contract1.getAddress(), 1000n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient);

        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");

        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 1000n);
    });

    it("Valid execute (native token)", async function () {
        const {contract, dummyContract, erc20Contract1, account1} = await loadFixture(deploy);

        const {data} = await dummyContract.call.populateTransaction("0x01020304");
        
        const recipient = randomAddress();
        
        //Make sure contract has enough funds
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });

        const promise = contract.execute("0x0000000000000000000000000000000000000000", 1000n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 0n
            }],
            drainTokens: []
        }, recipient);

        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");

        assert.strictEqual(await account1.provider.getBalance(recipient), 1000n);
    });

    it("Valid execute payable (native token)", async function () {
        const {contract, dummyContract, erc20Contract1, account1} = await loadFixture(deploy);

        const {data} = await dummyContract.callPayable.populateTransaction("0x01020304");
        
        const recipient = randomAddress();
        
        //Make sure contract has enough funds
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });

        const promise = contract.execute("0x0000000000000000000000000000000000000000", 1000n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 1000n
            }],
            drainTokens: []
        }, recipient);

        await expect(promise).to.emit(dummyContract, "PayableEvent").withArgs(1000n, "0x01020304");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");

        assert.strictEqual(await account1.provider.getBalance(await dummyContract.getAddress()), 1000n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });

    it("Valid execute payable (native token & other erc20)", async function () {
        const {contract, dummyContract, erc20Contract1, erc20Contract2, account1} = await loadFixture(deploy);

        const {data} = await dummyContract.callPayable.populateTransaction("0x01020304");
        
        const recipient = randomAddress();
        
        //Make sure contract has enough funds
        await account1.sendTransaction({
            to: await contract.getAddress(),
            value: 1000n
        });

        //Send some assets to execution proxy, simulating e.g. swap
        await erc20Contract1.transfer(await contract.getExecutionProxy(), 2000n);
        await erc20Contract2.transfer(await contract.getExecutionProxy(), 3000n);

        const promise = contract.execute("0x0000000000000000000000000000000000000000", 1000n, {
            gasLimit: 100_000n,
            calls: [{
                target: await dummyContract.getAddress(),
                data,
                value: 1000n
            }],
            drainTokens: [await erc20Contract1.getAddress(), await erc20Contract2.getAddress()] //Additionally also drain these tokens
        }, recipient);

        await expect(promise).to.emit(dummyContract, "PayableEvent").withArgs(1000n, "0x01020304");
        await expect(promise).to.emit(contract, "ExecutorWrapperEvent").withArgs(true, "0x");

        assert.strictEqual(await account1.provider.getBalance(await dummyContract.getAddress()), 1000n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 2000n);
        assert.strictEqual(await erc20Contract2.balanceOf(recipient), 3000n);
    });

});
