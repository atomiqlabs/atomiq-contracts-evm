import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { getExecutionSalt, randomAddress, randomBytes32, TRANSFER_OUT_MAX_GAS } from "../../utils/evm/utils";
import { TestERC20 } from "../../../typechain-types";
import { ExecutionAction, getExecutionActionHash } from "../../utils/evm/execution_action";
import { Execution, getExecutionHash } from "../../utils/evm/execution";

describe("ExecutionContract", function () {
    async function deploy() {
        const WETH9 = await hre.ethers.getContractFactory("WETH9");
        const wethContract = await WETH9.deploy();

        const ExecutionContractWrapper = await hre.ethers.getContractFactory("ExecutionContractWrapper");
        const contract = await ExecutionContractWrapper.deploy(wethContract, TRANSFER_OUT_MAX_GAS);

        const DummyContract = await hre.ethers.getContractFactory("DummyContract");
        const dummyContract = await DummyContract.deploy();

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();
        const erc20Contract2 = await ERC20.deploy();

        const [account1, account2] = await hre.ethers.getSigners();

        async function create(owner: string, creatorSalt: string, execution: Execution) {
            let value: bigint;
            if(execution.token==="0x0000000000000000000000000000000000000000") {
                value = execution.amount + execution.executionFee;
            } else {
                await (ERC20.attach(execution.token) as TestERC20).approve(await contract.getAddress(), execution.amount + execution.executionFee);
            }
            await contract.create(owner, creatorSalt, execution, {value});
        }

        return {contract, dummyContract, erc20Contract1, erc20Contract2, account1, account2, create};
    }

    it("Valid create (erc-20)", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        await erc20Contract1.approve(await contract.getAddress(), 1500n);
        //Ensure event is emitted
        await expect(
            contract.create(account2.address, creatorSalt, execution)
        ).to.emit(contract, "ExecutionCreated").withArgs(account2.address, salt, executionHash);

        //Ensure the commitment is created
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), executionHash);

        //Ensure tokens are transfered
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 1500n);
    });

    it("Invalid create (erc-20 not enough balance)", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account2.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        await erc20Contract1.transfer(account2.address, 1000n); //Not enough to cover fee + amount

        await erc20Contract1.connect(account2).approve(await contract.getAddress(), 1500n);
        //Ensure event is emitted
        await expect(
            contract.connect(account2).create(account2.address, creatorSalt, execution)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
    });

    it("Invalid create (erc-20 not enough allowance)", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        await erc20Contract1.approve(await contract.getAddress(), 1000n); //Approve too little
        //Ensure event is emitted
        await expect(
            contract.create(account2.address, creatorSalt, execution)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientAllowance");
    });

    it("Valid create (native token)", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: "0x0000000000000000000000000000000000000000",
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        //Ensure event is emitted
        await expect(
            contract.create(account2.address, creatorSalt, execution, {value: 1500n})
        ).to.emit(contract, "ExecutionCreated").withArgs(account2.address, salt, executionHash);

        //Ensure the commitment is created
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), executionHash);

        //Ensure tokens are transfered
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 1500n);
    });

    it("Invalid create (native token invalid msg.value)", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: "0x0000000000000000000000000000000000000000",
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        //Ensure event is emitted
        await expect(
            contract.create(account2.address, creatorSalt, execution, {value: 1000n}) //Not enough value sent
        ).to.be.revertedWith("transferIn: value too low");
    });

    it("Invalid create twice the same execution", async function () {
        const {contract, account1, account2, erc20Contract1} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: "0x0000000000000000000000000000000000000000",
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n
        };
        const executionHash = getExecutionHash(execution);

        await contract.create(account2.address, creatorSalt, execution, {value: 1500n});
        await expect(
            contract.create(account2.address, creatorSalt, execution, {value: 1500n})
        ).to.be.revertedWith("create: Already initiated");
    });

    it("Valid refund expired", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        await expect(
            contract.refundExpired(account2.address, salt, execution)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Invalid refund expired, not initiated", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        // await create(account2.address, creatorSalt, execution); //Don't initiate

        await expect(
            contract.refundExpired(account2.address, salt, execution)
        ).to.be.revertedWith("refundExp: Not scheduled");
    });

    it("Invalid refund expired, not expired", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0xffffffffn //Not expired
        };

        await create(account2.address, creatorSalt, execution);

        await expect(
            contract.refundExpired(account2.address, salt, execution)
        ).to.be.revertedWith("refundExp: Not expired yet");
    });

    it("Invalid refund expired, already processed", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Expired
        };
        
        await create(account2.address, creatorSalt, execution);
        await contract.refundExpired(account2.address, salt, execution); //First refund should work
        await expect(
            contract.refundExpired(account2.address, salt, execution) //Second refund should revert
        ).to.be.revertedWith("refundExp: Not scheduled");
    });

    it("Valid refund by owner", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        await expect(
            contract.connect(account2).refund(salt, execution)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens + fee is transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1500n);
    });

    it("Valid refund by owner (even though not expired yet)", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0xffffffffn //Not expired yet
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        await expect(
            contract.connect(account2).refund(salt, execution)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens + fee is transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1500n);
    });

    it("Invalid refund by owner, caller not owner", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        await create(account2.address, creatorSalt, execution);

        await expect(
            contract.refund(salt, execution)
        ).to.be.revertedWith("refund: Not scheduled");
    });

    it("Invalid refund by owner, not initiated", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        // await create(account2.address, creatorSalt, execution); //Don't initiate

        await expect(
            contract.connect(account2).refund(salt, execution)
        ).to.be.revertedWith("refund: Not scheduled");
    });

    it("Invalid refund by owner, try to refund twice", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(),
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        await create(account2.address, creatorSalt, execution);
        await contract.connect(account2).refund(salt, execution); //First refund
        await expect(
            contract.connect(account2).refund(salt, execution) //Second refund should revert
        ).to.be.revertedWith("refund: Not scheduled");
    });

    it("Valid execute, empty calls", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const executionAction: ExecutionAction = {
            gasLimit: 5000n,
            calls: [],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        await expect(
            contract.execute(account2.address, salt, execution, executionAction)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, true, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Valid execute, erc20 transfer calls", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const recipient1 = randomAddress();
        const recipient2 = randomAddress();

        const executionAction: ExecutionAction = {
            gasLimit: 60000n,
            calls: [
                {
                    target: await erc20Contract1.getAddress(),
                    value: 0n,
                    data: (await erc20Contract1.transfer.populateTransaction(recipient1, 50n)).data
                },
                {
                    target: await erc20Contract1.getAddress(),
                    value: 0n,
                    data: (await erc20Contract1.transfer.populateTransaction(recipient2, 50n)).data
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        await expect(
            contract.execute(account2.address, salt, execution, executionAction)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, true, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 900n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient1), 50n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient2), 50n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Valid execute, native transfer calls", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const recipient1 = randomAddress();
        const recipient2 = randomAddress();

        const executionAction: ExecutionAction = {
            gasLimit: 80000n,
            calls: [
                {
                    target: recipient1,
                    value: 50n,
                    data: "0x"
                },
                {
                    target: recipient2,
                    value: 50n,
                    data: "0x"
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: "0x0000000000000000000000000000000000000000",
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account2PreNativeBalance = await account1.provider.getBalance(account2.address);

        await expect(
            contract.execute(account2.address, salt, execution, executionAction)
        ).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, true, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await account1.provider.getBalance(account2.address), account2PreNativeBalance+900n);
        assert.strictEqual(await account1.provider.getBalance(recipient1), 50n);
        assert.strictEqual(await account1.provider.getBalance(recipient2), 50n);
    });

    it("Valid execute, dummy emit event", async function () {
        const {contract, account1, account2, erc20Contract1, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.call.populateTransaction("0x01020304");

        const executionAction: ExecutionAction = {
            gasLimit: 10000n,
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        const promise = contract.execute(account2.address, salt, execution, executionAction);
        await expect(promise).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, true, "0x");
        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });
    
    it("Valid execute, call reverted", async function () {
        const {contract, account1, account2, erc20Contract1, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callRevert.populateTransaction("This is a rejection");

        const executionAction: ExecutionAction = {
            gasLimit: 10000n,
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        const promise = contract.execute(account2.address, salt, execution, executionAction);
        await expect(promise).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135468697320697320612072656a656374696f6e00000000000000000000000000");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Valid execute, out of gas", async function () {
        const {contract, account1, account2, erc20Contract1, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.outOfGas.populateTransaction();

        const executionAction: ExecutionAction = {
            gasLimit: 10000n,
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);

        const promise = contract.execute(account2.address, salt, execution, executionAction);
        await expect(promise).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Valid execute, dummy emit event (drain tokens)", async function () {
        const {contract, account1, account2, erc20Contract1, erc20Contract2, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.call.populateTransaction("0x01020304");

        const executionAction: ExecutionAction = {
            gasLimit: 10000n,
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: [await erc20Contract2.getAddress(), "0x0000000000000000000000000000000000000000"]
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);
        const account2PreNativeBalance = await account1.provider.getBalance(account2.address);

        //Transfer some other assets to the proxy contract to simulate e.g. tokens being swapped
        await erc20Contract2.transfer(await contract.getExecutionProxy(), 2000n);
        await account1.sendTransaction({to: await contract.getExecutionProxy(), value: 500n});

        const promise = contract.execute(account2.address, salt, execution, executionAction);
        await expect(promise).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, true, "0x");
        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        assert.strictEqual(await erc20Contract2.balanceOf(account2.address), 2000n);
        assert.strictEqual(await account1.provider.getBalance(account2.address), account2PreNativeBalance+500n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });
    
    it("Valid execute, call reverted (drain tokens)", async function () {
        const {contract, account1, account2, erc20Contract1, erc20Contract2, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callRevert.populateTransaction("This is a rejection");

        const executionAction: ExecutionAction = {
            gasLimit: 10000n,
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: [await erc20Contract2.getAddress(), "0x0000000000000000000000000000000000000000"]
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        const executionHash = getExecutionHash(execution);
        await create(account2.address, creatorSalt, execution);

        const account1PreBalance = await erc20Contract1.balanceOf(account1.address);
        const account2PreNativeBalance = await account1.provider.getBalance(account2.address);

        //Transfer some other assets to the proxy contract to simulate e.g. tokens being swapped
        await erc20Contract2.transfer(await contract.getExecutionProxy(), 2000n);
        await account1.sendTransaction({to: await contract.getExecutionProxy(), value: 500n});

        const promise = contract.execute(account2.address, salt, execution, executionAction);
        await expect(promise).to.emit(contract, "ExecutionProcessed").withArgs(account2.address, salt, executionHash, false, "0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135468697320697320612072656a656374696f6e00000000000000000000000000");

        //Ensure the commitment is deleted
        assert.strictEqual(await contract.getExecutionCommitmentHash(account2.address, salt), "0x0000000000000000000000000000000000000000000000000000000000000000");

        //Ensure tokens are transfered back to owner
        assert.strictEqual(await erc20Contract1.balanceOf(account2.address), 1000n);
        assert.strictEqual(await erc20Contract2.balanceOf(account2.address), 2000n);
        assert.strictEqual(await account1.provider.getBalance(account2.address), account2PreNativeBalance+500n);
        //Ensure execution fee transfered to caller
        assert.strictEqual(account1PreBalance + 500n, await erc20Contract1.balanceOf(account1.address));
    });

    it("Invalid execute, wrong success action provided", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const executionAction: ExecutionAction = {
            gasLimit: 5000n,
            calls: [],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: randomBytes32(), //Invalid random execution action hash
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        await create(account2.address, creatorSalt, execution);

        await expect(
            contract.execute(account2.address, salt, execution, executionAction)
        ).to.be.revertedWith("execute: Invalid executionAction");
    });

    it("Invalid execute, not scheduled", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const executionAction: ExecutionAction = {
            gasLimit: 5000n,
            calls: [],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        // await create(account2.address, creatorSalt, execution); //Don't call create before

        await expect(
            contract.execute(account2.address, salt, execution, executionAction)
        ).to.be.revertedWith("execute: Not scheduled");
    });

    it("Invalid execute, try execute twice", async function () {
        const {contract, account1, account2, erc20Contract1, create} = await loadFixture(deploy);

        const executionAction: ExecutionAction = {
            gasLimit: 5000n,
            calls: [],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        await create(account2.address, creatorSalt, execution);
        await contract.execute(account2.address, salt, execution, executionAction); //First call should succeed

        await expect(
            contract.execute(account2.address, salt, execution, executionAction) //Second call should revert
        ).to.be.revertedWith("execute: Not scheduled");
    });

    it("Unable to exploit EIP-150 63/64 rule", async function () {
        const {contract, account1, account2, erc20Contract1, create, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.burn5m.populateTransaction();

        //Create execution action that requires around 5M gas,
        // this should be enough for the action to execute
        const executionAction: ExecutionAction = {
            gasLimit: 5_100_000n, //This also needs to include some buffer for the proxy contract
            calls: [
                {
                    target: to,
                    data,
                    value: 0n
                }
            ],
            drainTokens: []
        };
        const executionActionHash = getExecutionActionHash(executionAction);

        const creatorSalt = randomBytes32();
        const salt = getExecutionSalt(account1.address, creatorSalt);
        const execution = {
            token: await erc20Contract1.getAddress(),
            executionActionHash: executionActionHash,
            amount: 1000n,
            executionFee: 500n,
            expiry: 0n //Already expired
        };
        await create(account2.address, creatorSalt, execution);

        const promise = contract.execute(account2.address, salt, execution, executionAction, {
            gasLimit: 2_000_000n //Use a gas limit of just 2M, which is not enough for the action to execute
        });

        //This call should fail, because the transaction gas limit is not enough to execute the action
        await expect(promise).to.be.revertedWithoutReason();
    });
});
