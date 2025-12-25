import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress, randomBytes32, TRANSFER_OUT_MAX_GAS } from "../../utils/evm/utils";

describe("TransferHandler", function () {
    async function deploy() {
        const WETH9 = await hre.ethers.getContractFactory("WETH9");
        const wethContract = await WETH9.deploy();

        const BrokenDepositWETH9 = await hre.ethers.getContractFactory("BrokenDepositWETH9");
        const brokenDepositWethContract = await BrokenDepositWETH9.deploy();

        const BrokenTransferWETH9 = await hre.ethers.getContractFactory("BrokenTransferWETH9");
        const brokenTransferWethContract = await BrokenTransferWETH9.deploy();

        const WETH9TransferNoReturn = await hre.ethers.getContractFactory("WETH9TransferNoReturn");
        const wethContractTransferNoReturn = await WETH9TransferNoReturn.deploy();

        const TransferHandlerWrapper = await hre.ethers.getContractFactory("TransferHandlerWrapper");
        const contract = await TransferHandlerWrapper.deploy(wethContract, TRANSFER_OUT_MAX_GAS);
        const brokenWethDepositContract = await TransferHandlerWrapper.deploy(brokenDepositWethContract, TRANSFER_OUT_MAX_GAS);
        const brokenWethTransferContract = await TransferHandlerWrapper.deploy(brokenTransferWethContract, TRANSFER_OUT_MAX_GAS);
        const wethTransferNoReturnContract = await TransferHandlerWrapper.deploy(wethContractTransferNoReturn, TRANSFER_OUT_MAX_GAS);
        const wethRandomAddressContract = await TransferHandlerWrapper.deploy(randomAddress(), TRANSFER_OUT_MAX_GAS);

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();

        const InfiniteLoopContract = await hre.ethers.getContractFactory("InfiniteLoopContract");
        const infiniteLoopContract = await InfiniteLoopContract.deploy();

        const ERC20TransferNoReturn = await hre.ethers.getContractFactory("TestERC20TransferNoReturn");
        const erc20TransferNoReturnContract = await ERC20TransferNoReturn.deploy();

        const [account1, account2] = await hre.ethers.getSigners();

        return {
            contract,
            brokenWethDepositContract,
            brokenWethTransferContract,
            erc20Contract1,
            account1,
            account2,
            infiniteLoopContract,
            wethContract,
            brokenTransferWethContract,
            erc20TransferNoReturnContract,
            wethTransferNoReturnContract,
            wethRandomAddressContract,
            wethContractTransferNoReturn
        };
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
        ).to.be.revertedWithoutReason();
    });

    it("Invalid transfer out, target reverted or ran out of gas (native token)", async function () {
        const {contract, erc20Contract1, account1, account2, infiniteLoopContract, wethContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await contract.transferOut("0x0000000000000000000000000000000000000000", recipient, 500n);
        //The native token should've been converted into WETH and transfered to recipient
        assert.strictEqual(await wethContract.balanceOf(recipient), 500n);
    });

    it("Invalid transfer out, target reverted or ran out of gas, broken weth9 deposit impl (native token)", async function () {
        const {brokenWethDepositContract, erc20Contract1, account1, account2, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await brokenWethDepositContract.getAddress(), value: 1000n});
        await expect(
            brokenWethDepositContract.transferOut("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.be.revertedWith("cannot deposit");
    });

    it("Invalid transfer out, target reverted or ran out of gas, broken weth9 transfer impl (native token)", async function () {
        const {brokenWethTransferContract, erc20Contract1, account1, account2, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await brokenWethTransferContract.getAddress(), value: 1000n});
        await expect(
            brokenWethTransferContract.transferOut("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.be.revertedWith("cannot transfer");
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

    it("Valid transfer out (no revert) (erc-20) - transfer fn returning void", async function () {
        const {contract, erc20TransferNoReturnContract, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20TransferNoReturnContract.transfer(await contract.getAddress(), 1000n);
        await expect(
            contract.transferOutNoRevert(await erc20TransferNoReturnContract.getAddress(), recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(true);
        assert.strictEqual(await erc20TransferNoReturnContract.balanceOf(await contract.getAddress()), 500n);
        assert.strictEqual(await erc20TransferNoReturnContract.balanceOf(recipient), 500n);
    });

    it("Invalid transfer out (no revert) (erc-20) - call transfer fn on random address", async function () {
        const {contract, erc20TransferNoReturnContract, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();
        const randomContractAddress = randomAddress();

        await expect(
            contract.transferOutNoRevert(randomContractAddress, recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(false);
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

    it("Valid transfer out, target reverted or ran out of gas (no revert) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2, infiniteLoopContract, wethContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(contract, "TransferNoRevertResult").withArgs(true);
        //The native token should've been converted into WETH and transfered to recipient
        assert.strictEqual(await wethContract.balanceOf(recipient), 500n);
    });

    it("Valid transfer out, target reverted or ran out of gas (no revert) (native token)", async function () {
        const {wethTransferNoReturnContract, account1, infiniteLoopContract, wethContractTransferNoReturn} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await wethTransferNoReturnContract.getAddress(), value: 1000n});
        await expect(
            wethTransferNoReturnContract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(wethTransferNoReturnContract, "TransferNoRevertResult").withArgs(true);
        //The native token should've been converted into WETH and transfered to recipient
        assert.strictEqual(await wethContractTransferNoReturn.balanceOf(recipient), 500n);
    });
    
    it("Invalid transfer out, target reverted or ran out of gas, broken weth9 deposit impl (no revert) (native token)", async function () {
        const {brokenWethDepositContract, erc20Contract1, account1, account2, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await brokenWethDepositContract.getAddress(), value: 1000n});
        await expect(
            brokenWethDepositContract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(brokenWethDepositContract, "TransferNoRevertResult").withArgs(false);
        //Ensure nothing was transfered
        assert.strictEqual(await account1.provider.getBalance(await brokenWethDepositContract.getAddress()), 1000n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });

    it("Invalid transfer out, target reverted or ran out of gas, broken weth9 transfer impl (no revert) (native token)", async function () {
        const {brokenWethTransferContract, erc20Contract1, account1, account2, infiniteLoopContract, brokenTransferWethContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await brokenWethTransferContract.getAddress(), value: 1000n});
        await expect(
            brokenWethTransferContract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(brokenWethTransferContract, "TransferNoRevertResult").withArgs(false);
        //Balance was already taken from the contract, since deposit went through, just transfer failed
        assert.strictEqual(await account1.provider.getBalance(await brokenWethTransferContract.getAddress()), 500n);
        //WETH tokens stayed with the contract
        assert.strictEqual(await brokenTransferWethContract.balanceOf(await brokenWethTransferContract.getAddress()), 500n);
        //Ensure nothing was transfered to the user
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });

    it("Invalid transfer out, target reverted or ran out of gas, weth9 impl is an EOA without code (no revert) (native token)", async function () {
        const {wethRandomAddressContract, account1, infiniteLoopContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await wethRandomAddressContract.getAddress(), value: 1000n});
        await expect(
            wethRandomAddressContract.transferOutNoRevert("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.emit(wethRandomAddressContract, "TransferNoRevertResult").withArgs(false);
        //Balance was already taken from the contract, since deposit went through, just transfer failed
        assert.strictEqual(await account1.provider.getBalance(await wethRandomAddressContract.getAddress()), 500n);
        //Ensure nothing was transfered to the user
        assert.strictEqual(await account1.provider.getBalance(recipient), 0n);
    });


    
    it("Valid transfer out (raw full gas) (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await contract.transferOutRawFullGas(await erc20Contract1.getAddress(), recipient, 500n);
        assert.strictEqual(await erc20Contract1.balanceOf(await contract.getAddress()), 500n);
        assert.strictEqual(await erc20Contract1.balanceOf(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (raw full gas) (erc-20)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await erc20Contract1.transfer(await contract.getAddress(), 1000n);
        await expect(
            contract.transferOutRawFullGas(await erc20Contract1.getAddress(), recipient, 2000n)
        ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
    });

    it("Valid transfer out (raw full gas) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await contract.transferOutRawFullGas("0x0000000000000000000000000000000000000000", recipient, 500n);
        assert.strictEqual(await account1.provider.getBalance(await contract.getAddress()), 500n);
        assert.strictEqual(await account1.provider.getBalance(recipient), 500n);
    });

    it("Invalid transfer out not enough balance (raw full gas) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2} = await loadFixture(deploy);

        const recipient = randomAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutRawFullGas("0x0000000000000000000000000000000000000000", recipient, 2000n)
        ).to.be.revertedWith("transferOutRaw: native xfer fail");
    });

    it("Invalid transfer out, target reverted or ran out of gas (raw full gas) (native token)", async function () {
        const {contract, erc20Contract1, account1, account2, infiniteLoopContract, wethContract} = await loadFixture(deploy);

        const recipient = await infiniteLoopContract.getAddress();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1000n});
        await expect(
            contract.transferOutRawFullGas("0x0000000000000000000000000000000000000000", recipient, 500n)
        ).to.be.revertedWith("transferOutRaw: native xfer fail");
    });
});
