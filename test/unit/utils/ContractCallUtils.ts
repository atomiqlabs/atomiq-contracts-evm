import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomAddress } from "../../utils/evm/utils";

async function deploy() {
    const ContractCallUtilsWrapper = await hre.ethers.getContractFactory("ContractCallUtilsWrapper");
    const contract = await ContractCallUtilsWrapper.deploy();

    const DummyContract = await hre.ethers.getContractFactory("DummyContract");
    const dummyContract = await DummyContract.deploy();

    const [account1] = await hre.ethers.getSigners();

    return {account1, contract, dummyContract};
}

describe("ContractCallUtils: safeCall (with gasLimit)", function () {
    it("Valid contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.call.populateTransaction("0x01020304");

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            0,
            data,
            10_000
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
    });

    it("Valid contract call with return data", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callReturning.populateTransaction("0x01020304");

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            0,
            data,
            10_000
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(
            true,
            "0x"+
            "0000000000000000000000000000000000000000000000000000000000000020"+
            "0000000000000000000000000000000000000000000000000000000000000004"+
            "0102030400000000000000000000000000000000000000000000000000000000"
        );
    });

    it("Valid payable contract call", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callPayable.populateTransaction("0x01020304");

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000n});

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            1_000,
            data,
            10_000
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        await expect(promise).to.emit(dummyContract, "PayableEvent").withArgs(1000, "0x01020304");
    });

    it("Valid contract payable call with return data", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callReturning.populateTransaction("0x0102030405060708");

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000n});

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            1_000,
            data,
            10_000
        );

        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(
            true,
            "0x"+
            "0000000000000000000000000000000000000000000000000000000000000020"+
            "0000000000000000000000000000000000000000000000000000000000000008"+
            "0102030405060708000000000000000000000000000000000000000000000000"
        );
    });

    it("Valid reverting contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callRevert.populateTransaction("Hello");

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            0,
            data,
            10_000
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(false, "0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000548656c6c6f000000000000000000000000000000000000000000000000000000");
    });

    it("Valid out of gas contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.outOfGas.populateTransaction();

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to,
            0,
            data,
            10_000 //Use too little gas
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(false, "0x");
    });

    it("Valid contract doesn't exist", async function () {
        const {contract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            randomAddress(),
            0,
            "0x01020304",
            10_000
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");

        const txResult = await promise;
        
        //Now we want to check that the gas forwarded in the call is 0
        //Get the tx trace
        const trace = await hre.ethers.provider.send("debug_traceTransaction", [txResult.hash]);
        //Get the frame of the first CALL opcode
        const callFrame = trace.structLogs.find((val: any) => val.op==="CALL");
        assert.strictEqual(callFrame.gasCost, 100n, "Invalid CALL opcode gas cost, should be 100 gas!")
    });

    it("Invalid call with too little gas", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            await dummyContract.getAddress(),
            0,
            "0x01020304", //Any data
            10_000,
            {
                gasLimit: 21_000 + 10_000
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");
    });

    it("Invalid call with too little gas (value>0, empty account)", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            randomAddress(), //Target has to be an empty account
            1_000, //Non-zero value
            "0x01020304", //Any data
            10_000, //Gas to forward is ignored since target is not contract (has no code)
            {
                //Now this requires an intrinsic CALL gas of at least 34300
                gasLimit: 21_000 + 34_300
            }
        );
        //Should just run out of gas itself, since it has not enough gas to cover
        // call opcode intrinsic gas cost
        await expect(promise).to.be.revertedWithoutReason();
    });

    it("Valid call with enough gas (value>0, empty account)", async function () {
        const {account1, contract} = await loadFixture(deploy);
        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000});

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            randomAddress(), //Target has to be an empty account
            1_000, //Non-zero value
            "0x01020304", //Any data
            10_000, //Gas to forward is ignored since target is not contract (has no code)
            {
                //Now this requires an intrinsic CALL gas of at least 34100
                gasLimit: 21_000 + 34_100 + 6_000
            }
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        
        const txResult = await promise;
        
        //Now we want to check that the gas forwarded in the call is 0
        //Get the tx trace
        const trace = await hre.ethers.provider.send("debug_traceTransaction", [txResult.hash]);
        //Get the frame of the first CALL opcode
        const callFrame = trace.structLogs.find((val: any) => val.op==="CALL");
        //Intrinsic gas cost of the CALL opcode in this case is 34100 gas (100 gas warm access + 9000 gas transfer + 25000 empty account transfer)
        assert.strictEqual(callFrame.gasCost, 34100n, "Invalid CALL opcode gas cost, should be 34100 gas!")
    });

    it("Invalid call with too little gas (value>0, non-empty account - EOA)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            account1.address, //Target has is account1 (non-empty EOA, has balance)
            1_000, //Non-zero value
            "0x01020304", //Any data
            10_000, //Gas to forward is ignored since target is not contract (has no code)
            {
                //Now this requires an intrinsic CALL gas of at least 9100
                gasLimit: 21_000 + 9_100
            }
        );
        await expect(promise).to.be.revertedWithoutReason();
    });

    it("Valid call (value>0, non-empty account - EOA)", async function () {
        const {account1, contract} = await loadFixture(deploy);
        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000});

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            account1.address, //Target is account1 (non-empty EOA, has balance)
            1_000, //Non-zero value
            "0x01020304", //Any data
            10_000, //Gas to forward is ignored since target is not contract (has no code)
            {
                //Now this requires an intrinsic CALL gas of at least 9100 + some additional gas for processing stuff
                gasLimit: 21_000 + 9_100 + 5_000
            }
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        
        const txResult = await promise;
        
        //Now we want to check that the gas forwarded in the call is 0
        //Get the tx trace
        const trace = await hre.ethers.provider.send("debug_traceTransaction", [txResult.hash]);
        //Get the frame of the first CALL opcode
        const callFrame = trace.structLogs.find((val: any) => val.op==="CALL");
        //Intrinsic gas cost of the CALL opcode in this case is 9100 gas (100 gas warm access + 9000 gas transfer)
        assert.strictEqual(callFrame.gasCost, 9100n, "Invalid CALL opcode gas cost, should be 9100 gas!")
    });

    it("Invalid call with too little gas (value>0, non-empty account - contract)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            await dummyContract.getAddress(), //Target is dummy contract (non-empty contract with code)
            1_000, //Non-zero value
            "0x01020304", //Any data
            10_000,
            {
                //Now this requires an intrinsic CALL gas of at least 9100
                gasLimit: 21_000 + 9_100 + 10_000
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");
    });

    it("Valid call with enough gas (value>0, non-empty account - contract)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);
        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000});

        const {to, data} = await dummyContract.callPayable.populateTransaction("0x01020304");
        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to, //Target is dummy contract (non-empty contract with code)
            1_000, //Non-zero value
            data,
            10_000,
            {
                //Now this requires an intrinsic CALL gas of at least 9100 + 10000 gas forward + some additional gas for processing stuff
                gasLimit: 21_000 + 9_100 + 10_000 + 6_000
            }
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        await expect(promise).to.emit(dummyContract, "PayableEvent").withArgs(1000, "0x01020304");
        
        const txResult = await promise;
        
        //Now we want to check that the gas forwarded in the call is exactly 10_000
        //Get the tx trace
        const trace = await hre.ethers.provider.send("debug_traceTransaction", [txResult.hash]);
        //Get the frame of the first CALL opcode
        const callFrameIndex = trace.structLogs.findIndex((val: any) => val.op==="CALL");
        //Next frame is in the context of the called contract
        const nextFrame = trace.structLogs[callFrameIndex + 1];
        //Intrinsic gas cost of the CALL opcode in this case is 9100 gas (100 gas warm access + 9000 gas transfer)
        assert.strictEqual(trace.structLogs[callFrameIndex].gasCost, 10_000n + 9100n, "Invalid CALL opcode gas cost, should be 19100 gas!");
        //Assert gas forward is indeed exactly 10k + 2300 stipend because we are transfering value
        assert.strictEqual(nextFrame.gas, 10_000n + 2_300n, "Invalid amount of gas forwarded, should be 10000 + 2300 gas!");
    });

    it("Valid call with possible EIP-150 exploit", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.burn5m.populateTransaction();
        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to, //Target is dummy contract (non-empty contract with code)
            0, //Zero value
            data,
            5_050_000,
            {
                //Now this requires an intrinsic CALL gas of at least 2600 + 5050000 gas forward + some additional gas for processing stuff
                gasLimit: 21_000 + 2_600 + Math.floor(5_050_000 * 64 / 63) + 5_500
            }
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });

    it("Invalid call with possible EIP-150 exploit", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.burn5m.populateTransaction();
        const promise = contract["safeCall(address,uint256,bytes,uint256)"](
            to, //Target is dummy contract (non-empty contract with code)
            0, //Zero value
            data,
            5_050_000,
            //Attempt to call with lower gas limit that what has been defined in the params
            {
                //Now this requires an intrinsic CALL gas of at least 2600 + 5050000 gas forward (plus some additional gas because of 63/64 rule)
                //  + some additional gas for processing stuff
                gasLimit: 21_000 + 2_600 + Math.floor(5_050_000 * 64 / 63)
            }
        );
        await expect(promise).to.be.rejectedWith("safeCall(): not enough gas");
    });

    //This test verifies the consistency of the ContractCallUtils implementation. It makes
    // sure that the gasleft() check triggers before forwarded gas were to be decreased
    // from it's desired value
    it("Check consistency (contract calls)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        async function checkConsistency(to: string, data: string, value: bigint) {
            const callIntrinsicCost = value===0n ? 100n : 9_100n;

            const attemptCall = async (gasLimit: bigint, txGasLimit: bigint) => {
                try {
                    await contract["safeCallNoEmit(address,uint256,bytes,uint256)"](
                        //Have to use random addresses with no zero bytes, such that
                        // the calldata gas cost stays the same
                        to,
                        value,
                        data,
                        gasLimit,
                        {
                            gasLimit: txGasLimit
                        }
                    );
                    return true;
                } catch(e: any) {
                    const _e = e as Error;
                    if(_e.message.includes("safeCall(): not enough gas")) return false;
                    if(_e.message.includes("Transaction ran out of gas")) return false;
                    throw e;
                }
            }

            const binarySearchMinimumTxGas = async (gasLimit: bigint) => {
                let bottomValue = 21_000n //Base transaction gas
                    + 2_600n //extcodesize() gas cost
                    + callIntrinsicCost //intrinsic cost of the CALL opcode
                    + (gasLimit * 64n / 63n); //Forwarded gas, considering the eip150 63/64 rule
                let topValue = bottomValue + 6_000n; //Additional buffer

                while (bottomValue <= topValue) {
                    const mid = (bottomValue + topValue) / 2n;
                    const success = await attemptCall(gasLimit, mid);

                    if (success) {
                        //Still success, we can decrease the top value
                        topValue = mid - 1n;
                    } else {
                        //Not successful, gas needs to be increased
                        bottomValue = mid + 1n;
                    }
                }

                //Extract minimum required tx gas for the gasleft() test to be passed
                const minimumRequiredTxGas = bottomValue;
                //Double-check that minimum required tx gas indeed leads to successful tx
                assert.isTrue(await attemptCall(gasLimit, minimumRequiredTxGas));
                //One less gas and it fails
                assert.isFalse(await attemptCall(gasLimit, minimumRequiredTxGas - 1n));

                return minimumRequiredTxGas;
            }

            const gasLimits = [];

            for(let i=162;i<1_500;i+=100) gasLimits.push(BigInt(i));
            for(let i=1_500;i<15_000;i+=1_000) gasLimits.push(BigInt(i));
            for(let i=15_000;i<150_000;i+=10_000) gasLimits.push(BigInt(i));
            for(let i=150_000;i<1_500_000;i+=100_000) gasLimits.push(BigInt(i));
            for(let i=1_500_000;i<29_000_000n;i+=1_000_000) gasLimits.push(BigInt(i));

            for(let gasLimit of gasLimits) {
                //This is the absolute minimum gas that the tx needs to still pass the
                // internal gasleft() check, one less gas will make the tx revert 
                const minimumRequiredTxGas = await binarySearchMinimumTxGas(gasLimit);
                
                const result = await contract["safeCallNoEmit(address,uint256,bytes,uint256)"](
                    //Have to use random addresses with no zero bytes, such that
                    // the calldata gas cost stays the same
                    to,
                    value,
                    data,
                    gasLimit,
                    {
                        gasLimit: minimumRequiredTxGas
                    }
                );

                //Now we want to check that the gas forwarded to the other contract is indeed
                // equal to the `gasLimit`
                //Get the tx trace
                const trace = await hre.ethers.provider.send("debug_traceTransaction", [result.hash]);
                //Get the frame index of the first CALL opcode
                const callFrameIndex = trace.structLogs.findIndex((val: any) => val.op==="CALL");
                //Next frame is the first opcode of the called contract
                const nextFrame = trace.structLogs[callFrameIndex+1];
                //Check if that really is the case by checking the depth
                assert.strictEqual(nextFrame.depth, 2, "Needs to be a contract call!");
                //We can check the remaining gas there, it should always be equal to gasLimit
                if(value > 0n) {
                    //Add a transfer stipend of 2300 gas when value is non-zero
                    assert.strictEqual(nextFrame.gas, gasLimit + 2_300n, "Full gas not forwarded");
                } else {
                    assert.strictEqual(nextFrame.gas, gasLimit, "Full gas not forwarded");
                }
            }
        }

        //Make sure contract has enough balance
        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000_000_000n});

        //This needs at minimum 162 gas!
        const {to, data} = await dummyContract.doNothing.populateTransaction();
        //Check consistency when calling existing contract without amount
        await checkConsistency(to, data, 0n);
        //Check consistency when calling existing contract with amount
        await checkConsistency(to, data, 1_000n);
    });

});


describe("ContractCallUtils: safeCall (no gasLimit - forward all)", function () {
    it("Valid contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.call.populateTransaction("0x01020304");

        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        await expect(promise).to.emit(dummyContract, "Event").withArgs("0x01020304");
    });

    it("Valid contract call with return data", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callReturning.populateTransaction("0x01020304");

        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(
            true,
            "0x"+
            "0000000000000000000000000000000000000000000000000000000000000020"+
            "0000000000000000000000000000000000000000000000000000000000000004"+
            "0102030400000000000000000000000000000000000000000000000000000000"
        );
    });

    it("Valid payable contract call", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callPayable.populateTransaction("0x01020304");

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000n});

        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            1_000,
            data
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
        await expect(promise).to.emit(dummyContract, "PayableEvent").withArgs(1000, "0x01020304");
    });

    it("Valid payable call with return data", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callReturning.populateTransaction("0x010203040506");

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000n});

        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            1_000,
            data
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(
            true,
            "0x"+
            "0000000000000000000000000000000000000000000000000000000000000020"+
            "0000000000000000000000000000000000000000000000000000000000000006"+
            "0102030405060000000000000000000000000000000000000000000000000000"
        );
    });

    it("Valid reverting contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.callRevert.populateTransaction("Hello");

        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(false, "0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000548656c6c6f000000000000000000000000000000000000000000000000000000");
    });

    it("Valid out of gas contract call", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        const {to, data} = await dummyContract.outOfGas.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since outOfGas
        // will burn everything)
        await contract.standardCall(
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 200_000
            }
        );

        //With safe call, this will actually revert!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data,
            {
                gasLimit: 21_000 + 200_000
            }
        );
        //Manifests itself as a safeCall(): not enough gas
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");
    });

    it("Valid contract doesn't exist", async function () {
        const {contract} = await loadFixture(deploy);

        const promise = contract["safeCall(address,uint256,bytes)"](
            randomAddress(),
            0,
            "0x01020304"
        );
        await expect(promise).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });

    it("Call 1M gas burner", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        //Check that burn1m really needs more than 200k gas
        await expect(dummyContract.burn1m({gasLimit: 21_000 + 200_000})).to.be.revertedWithoutReason();

        const {to, data} = await dummyContract.burn1m.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since burn1m
        // costs around 1M gas to execute)
        await expect(contract.standardCall(
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 200_000
            }
        )).to.emit(contract, "ExecutionResult").withArgs(false, "0x"); //Reverted due to out of gas!

        //With safe call, this throws, because not enough gas is forwarded!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 200_000
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");

        //Call with enough gas works through safeCall now!
        const promise2 = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 1_050_000 //Add 5% buffer on top
            }
        );
        await expect(promise2).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });

    it("Call 100k gas burner", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        //Check that burn1m really needs more than 200k gas
        await expect(dummyContract.burn100k({gasLimit: 21_000 + 95_000})).to.be.revertedWithoutReason();

        const {to, data} = await dummyContract.burn100k.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since burn100k
        // costs around 100k gas to execute)
        await contract.standardCallNoEmit(
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 95_000 //Use 5% too little
            }
        );

        //With safe call, this throws, because not enough gas is forwarded!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 95_000 //Use 5% too little
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");

        //Call with enough gas works through safeCall now!
        const promise2 = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 105_000 //Add 5% buffer on top
            }
        );
        await expect(promise2).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });

    it("Call 100k gas burner (with value)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        //Check that burn1m really needs more than 200k gas
        await expect(dummyContract.burn100k({gasLimit: 21_000 + 95_000})).to.be.revertedWithoutReason();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000});

        const {to, data} = await dummyContract.burn100k.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since burn100k
        // costs around 100k gas to execute)
        await contract.standardCallNoEmit(
            to,
            1_000,
            data, //Any data
            {
                //Use 5% too little (9,100 gas is an intrinsic cost of CALL opcode)
                gasLimit: 21_000 + 9_100 + 95_000
            }
        );

        //With safe call, this throws, because not enough gas is forwarded!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            1_000,
            data, //Any data
            {
                //Use 5% too little (9,100 gas is an intrinsic cost of CALL opcode,
                // 2,700 required for balance and extcodesize checks)
                gasLimit: 21_000 + 2_700 + 9_100 + 95_000
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");

        //Call with enough gas works through safeCall now!
        const promise2 = contract["safeCall(address,uint256,bytes)"](
            to,
            1_000,
            data, //Any data
            {
                //Add 5% buffer on top
                gasLimit: 21_000 + 2_700 + 9_100 + 105_000
            }
        );
        await expect(promise2).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });

    it("Call 10k gas burner", async function () {
        const {contract, dummyContract} = await loadFixture(deploy);

        //Check that burn1m really needs more than 200k gas
        await expect(dummyContract.burn10k({gasLimit: 21_000 + 9_500})).to.be.revertedWithoutReason();

        const {to, data} = await dummyContract.burn10k.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since burn10k
        // costs around 10k gas to execute)
        await contract.standardCallNoEmit(
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 9_500 //Use 5% too little
            }
        );

        //With safe call, this throws, because not enough gas is forwarded!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 9_500 //Use 5% too little
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");

        //Call with enough gas works through safeCall now!
        const promise2 = contract["safeCall(address,uint256,bytes)"](
            to,
            0,
            data, //Any data
            {
                gasLimit: 21_000 + 2_600 + 10_500 + 4_000 //Add 5% buffer on top + additional 4k for event emitting
            }
        );
        await expect(promise2).to.emit(contract, "ExecutionResult").withArgs(true, "0x");
    });


    it("Call 10k gas burner (with value)", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        //Check that burn10k really needs more than 10k gas
        await expect(dummyContract.burn10k({gasLimit: 21_000 + 9_500})).to.be.revertedWithoutReason();

        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000});

        const {to, data} = await dummyContract.burn10k.populateTransaction();

        //This should just pass with a regular call, reverting inside with out of gas (since burn10k
        // costs around 10k gas to execute)
        await contract.standardCallNoEmit(
            to,
            1_000,
            data, //Any data
            {
                gasLimit: 21_000 + 9_100 + 9_500 //Use 5% too little
            }
        );

        //With safe call, this throws, because not enough gas is forwarded!
        const promise = contract["safeCall(address,uint256,bytes)"](
            to,
            1_000,
            data, //Any data
            {
                gasLimit: 21_000 + 9_100 + 1_900 + 9_500 //Use 5% too little
            }
        );
        await expect(promise).to.be.revertedWith("safeCall(): not enough gas");

        //Call with enough gas works through safeCall now!
        //We can indirectly observe inner call being successful through balance changes
        const preBalance = await account1.provider.getBalance(await contract.getAddress());
        
        //WTF is this about now? Reverts with 'function returned an unexpected amount of data'
        const tx = await contract["safeCallNoEmit(address,uint256,bytes)"](
            to,
            1_000,
            data, //Any data
            {
                gasLimit: 21_000 + 9_100 + 10_500 + 1_900 //Add 5% buffer on top + additional 2k gas for processing
            }
        );
        const postBalance = await account1.provider.getBalance(await contract.getAddress());
        assert.strictEqual(preBalance - postBalance, 1_000n);

        const receipt = await tx.wait();
    });

    //This test verifies the consistency of the ContractCallUtils implementation. It makes
    // sure that the implemented check triggers before all the 63/64 of the gas is forwarded
    // to the contract
    it("Check consistency (contract calls) - calling incrementally more expensive contracts with and without value", async function () {
        const {account1, contract, dummyContract} = await loadFixture(deploy);

        async function checkConsistency(value: bigint) {
            const callIntrinsicCost = value===0n ? 100n : 9100n;
            
            const attemptCall = async (to: string, data: string, txGasLimit: bigint, strictErrMessage?: boolean) => {
                try {
                    await contract["safeCallNoEmit(address,uint256,bytes)"](
                        //Have to use random addresses with no zero bytes, such that
                        // the calldata gas cost stays the same
                        to,
                        value,
                        data,
                        {
                            gasLimit: txGasLimit
                        }
                    );
                    return true;
                } catch(e: any) {
                    const _e = e as Error;
                    if(_e.message.includes("safeCall(): not enough gas")) return false;
                    if(!strictErrMessage && _e.message.includes("Transaction ran out of gas")) return false;
                    throw e;
                }
            }

            const binarySearchMinimumTxGas = async (to: string, data: string, gasLimit: bigint) => {                
                let bottomValue = 21_000n //Base transaction gas
                    + 2_600n //extcodesize() gas cost
                    + callIntrinsicCost //intrinsic cost of the CALL opcode
                    - (value>0n ? 2300n : 0n) //Forwarded gas stipend of 2300 gas
                    + (gasLimit * 64n / 63n); //Required gas to be forwarded for contract to succeed
                let topValue = (bottomValue * 33n / 32n) + 6_000n; //Additional buffer

                while (bottomValue <= topValue) {
                    const mid = (bottomValue + topValue) / 2n;
                    const success = await attemptCall(to, data, mid);

                    if (success) {
                        //Still success, we can decrease the top value
                        topValue = mid - 1n;
                    } else {
                        //Not successful, gas needs to be increased
                        bottomValue = mid + 1n;
                    }
                }

                //Extract minimum required tx gas for the gasleft() test to be passed
                const minimumRequiredTxGas = bottomValue;
                //Double-check that minimum required tx gas indeed leads to successful tx
                assert.isTrue(await attemptCall(to, data, minimumRequiredTxGas, true));
                //One less gas and it fails
                assert.isFalse(await attemptCall(to, data, minimumRequiredTxGas - 1n, true));

                return minimumRequiredTxGas;
            }

            const calls = [];

            for(let i = value===0n ? 95 : 200; i<1000; i+=100) {
                calls.push({...await dummyContract.burnVariableCycles.populateTransaction(i), gasLimit: 150n + BigInt(i)*35n});
            }
            for(let i = 1000; i<10000; i+=1000) {
                calls.push({...await dummyContract.burnVariableCycles.populateTransaction(i), gasLimit: 150n + BigInt(i)*35n});
            }
            for(let i = 10000; i<100000; i+=10000) {
                calls.push({...await dummyContract.burnVariableCycles.populateTransaction(i), gasLimit: 150n + BigInt(i)*35n});
            }
            for(let i = 100000; i<500000; i+=100000) {
                calls.push({...await dummyContract.burnVariableCycles.populateTransaction(i), gasLimit: 150n + BigInt(i)*35n});
            }

            let i = 0;
            for(let call of calls) {
                //This is the absolute minimum gas that the tx needs to still pass the
                // internal gasleft() check, one less gas will make the tx revert 
                const minimumRequiredTxGas = await binarySearchMinimumTxGas(call.to, call.data, call.gasLimit);
                
                const result = await contract["safeCallNoEmit(address,uint256,bytes)"](
                    //Have to use random addresses with no zero bytes, such that
                    // the calldata gas cost stays the same
                    call.to,
                    value,
                    call.data,
                    {
                        gasLimit: minimumRequiredTxGas
                    }
                );

                //Now we want to check that the gas forwarded to the other contract is indeed
                // equal to the `gasLimit`
                //Get the tx trace
                const trace = await hre.ethers.provider.send("debug_traceTransaction", [result.hash, {disableMemory: true, disableStack: true, disableStorage: true}]);
                //Get the frame index of the first CALL opcode
                const callFrameIndex = trace.structLogs.findIndex((val: any) => val.op==="CALL");
                const callFrame = trace.structLogs[callFrameIndex];
                //Next frame is the first opcode of the called contract
                const nextFrame = trace.structLogs[callFrameIndex+1];
                //Check if that really is the case by checking the depth
                assert.strictEqual(nextFrame.depth, 2, "Invalid post-call trace frame!");

                const returnFrame = trace.structLogs.find((val: any, index: number) => val.depth===1 && index>callFrameIndex);
                const gasLeftAfterIntrinsicCosts = BigInt(callFrame.gas) - callIntrinsicCost;
                const gasAfterCall = BigInt(returnFrame.gas);
                const gasSpent = gasLeftAfterIntrinsicCosts - gasAfterCall;

                assert.isTrue(gasSpent < ((gasLeftAfterIntrinsicCosts * 63n / 64n) - 10n), "Forwarded gas is too close to the 63/64 of the remaining gas");
                i++;
                console.log(`Test ${i}/${calls.length} completed!`);
            }
        }

        //Make sure contract has enough balance
        await account1.sendTransaction({to: await contract.getAddress(), value: 1_000_000_000n});

        //Check consistency when calling existing contract without amount
        console.log("Consistency value=0, this might take a while...");
        await checkConsistency(0n);
        //Check consistency when calling existing contract with amount
        console.log("Consistency value>0, this might take a while...");
        await checkConsistency(1_000n);
    }).timeout(10*60*1000);
});