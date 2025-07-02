import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import { EscrowDataType, getEscrowHash, getRandomEscrowData } from "../../utils/evm/escrow_data";
import { contracts, TestERC20 } from "../../../typechain-types";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";
import { randomUnsigned, randomUnsignedBigInt } from "../../utils/random";
import { ExecutionAction, getExecutionActionHash } from "../../utils/evm/execution_action";
import {randomBytes} from "crypto";

describe("EscrowManager", function () {
    async function deploy() {
        const EscrowManager = await hre.ethers.getContractFactory("EscrowManager");
        const contract = await EscrowManager.deploy();

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();
        const erc20Contract2 = await ERC20.deploy();

        const DummyContract = await hre.ethers.getContractFactory("DummyContract");
        const dummyContract = await DummyContract.deploy();

        const DummyClaimHandler = await hre.ethers.getContractFactory("DummyClaimHandler");
        const claimHandler = await DummyClaimHandler.deploy();

        const DummyRefundHandler = await hre.ethers.getContractFactory("DummyRefundHandler");
        const refundHandler = await DummyRefundHandler.deploy();

        const [account1, account2, account3] = await hre.ethers.getSigners();

        const TestAccountERC1271 = await hre.ethers.getContractFactory("TestAccountERC1271");
        const erc1271Account = await TestAccountERC1271.deploy(account3.address);

        //Ensure all accounts are funded
        await erc20Contract1.transfer(account2, 2_000_000_000_000_000_000n);
        await erc20Contract2.transfer(account2, 2_000_000_000_000_000_000n);

        //Fund LP vaults of all accounts
        await erc20Contract1.approve(await contract.getAddress(), 1_000_000_000_000_000_000n);
        await contract.deposit(await erc20Contract1.getAddress(), 1_000_000_000_000_000_000n);
        await erc20Contract2.approve(await contract.getAddress(), 1_000_000_000_000_000_000n);
        await contract.deposit(await erc20Contract2.getAddress(), 1_000_000_000_000_000_000n);
        await contract.deposit("0x0000000000000000000000000000000000000000", 1_000_000_000_000_000_000n, {value: 1_000_000_000_000_000_000n});

        await erc20Contract1.connect(account2).approve(await contract.getAddress(), 1_000_000_000_000_000_000n);
        await contract.connect(account2).deposit(await erc20Contract1.getAddress(), 1_000_000_000_000_000_000n);
        await erc20Contract2.connect(account2).approve(await contract.getAddress(), 1_000_000_000_000_000_000n);
        await contract.connect(account2).deposit(await erc20Contract2.getAddress(), 1_000_000_000_000_000_000n);
        await contract.connect(account2).deposit("0x0000000000000000000000000000000000000000", 1_000_000_000_000_000_000n, {value: 1_000_000_000_000_000_000n});
        
        const eip712domain = {
            name: "atomiq.exchange",
            version: "1",
            chainId: (await contract.runner.provider.getNetwork()).chainId,
            verifyingContract: await contract.getAddress()
        };

        function getInitSignature(signer: HardhatEthersSigner, escrow: EscrowDataType, timeout: bigint, extraData?: Buffer) {
            const swapHash = getEscrowHash(escrow);
            return signer.signTypedData(eip712domain, {
                Initialize: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "offerer", type: "address" },
                    { name: "claimer", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "token", type: "address" },
                    { name: "payIn", type: "bool" },
                    { name: "payOut", type: "bool" },
                    { name: "trackingReputation", type: "bool" },
                    { name: "claimHandler", type: "address" },
                    { name: "claimData", type: "bytes32" },
                    { name: "refundHandler", type: "address" },
                    { name: "refundData", type: "bytes32" },
                    { name: "securityDeposit", type: "uint256" },
                    { name: "claimerBounty", type: "uint256" },
                    { name: "depositToken", type: "address" },
                    { name: "claimActionHash", type: "bytes32" },
                    { name: "deadline", type: "uint256" },
                    { name: "extraDataHash", type: "bytes32" }
                ]
            }, {
                swapHash,
                offerer: escrow.offerer,
                claimer: escrow.claimer,
                amount: escrow.amount,
                token: escrow.token,
                payIn: (escrow.flags & 0b010n) !== 0n,
                payOut: (escrow.flags & 0b001n) !== 0n,
                trackingReputation:  (escrow.flags & 0b100n) !== 0n,
                claimHandler: escrow.claimHandler,
                claimData: escrow.claimData,
                refundHandler: escrow.refundHandler,
                refundData: escrow.refundData,
                securityDeposit: escrow.securityDeposit,
                claimerBounty: escrow.claimerBounty,
                depositToken: escrow.depositToken,
                claimActionHash: escrow.successActionCommitment,
                deadline: timeout,
                extraDataHash: hre.ethers.keccak256(extraData ?? Buffer.alloc(0))
            });
        }

        function getBalance(tokenAddress: string, address: string): Promise<bigint> {
            if(tokenAddress==="0x0000000000000000000000000000000000000000") {
                return account1.provider.getBalance(address);
            } else {
                return (ERC20.attach(tokenAddress) as any).balanceOf(address);
            }
        }

        async function getBalances(fetchData: {address: string, tokenAddress: string}[]): Promise<{[address: string]: {[tokenAddress: string]: bigint}}> {
            const result: {[address: string]: {[tokenAddress: string]: bigint}} = {};

            for(let data of fetchData) {
                result[data.address] ??= {};
                result[data.address][data.tokenAddress] ??= await getBalance(data.tokenAddress, data.address);
            }

            return result;
        }

        async function initTx(signer: HardhatEthersSigner, otherSigner: HardhatEthersSigner, escrowData: EscrowDataType, extraData?: Buffer) {
            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const tx = await contract.initialize.populateTransaction(
                escrowData, 
                signer.address===escrowData.offerer && (escrowData.flags & 0b100n) === 0n ? 
                    "0x" : //No signature required
                    await getInitSignature(otherSigner, escrowData, timeout, extraData), //Signature required from the other party
                timeout,
                extraData ?? Buffer.alloc(0)
            );

            let nativeAmount: bigint = 0n;
            if((escrowData.flags & 0b010n) === 0b010n) { //Pay-in
                if(escrowData.token==="0x0000000000000000000000000000000000000000") {
                    nativeAmount += escrowData.amount;
                } else {
                    await (ERC20.attach(escrowData.token) as TestERC20).connect(escrowData.offerer === signer.address ? signer : otherSigner).approve(await contract.getAddress(), escrowData.amount);
                }
            }

            const totalDeposit = escrowData.securityDeposit > escrowData.claimerBounty ? escrowData.securityDeposit : escrowData.claimerBounty;
            if(escrowData.depositToken==="0x0000000000000000000000000000000000000000") {
                nativeAmount += totalDeposit;
            } else {
                if(totalDeposit>0n) await (ERC20.attach(escrowData.depositToken) as TestERC20).connect(signer).approve(await contract.getAddress(), totalDeposit);
            }

            tx.value = nativeAmount;
            return tx;
        }

        async function init(signer: HardhatEthersSigner, otherSigner: HardhatEthersSigner, escrowData: EscrowDataType, extraData?: Buffer) {
            await signer.sendTransaction(await initTx(signer, otherSigner, escrowData, extraData));
        }

        async function initAssert(signer: HardhatEthersSigner, escrowData: EscrowDataType, unsignedTx: any) {
            const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                {address: escrowData.offerer, tokenAddress: escrowData.token},
                {address: await contract.getAddress(), tokenAddress: escrowData.token},
                {address: signer.address, tokenAddress: escrowData.depositToken},
                {address: await contract.getAddress(), tokenAddress: escrowData.depositToken}
            ]);
            const [preBalanceOffererVault] = await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]);

            const swapHash = getEscrowHash(escrowData);
            const totalDeposit = escrowData.securityDeposit > escrowData.claimerBounty ? escrowData.securityDeposit : escrowData.claimerBounty;

            const tx = await signer.sendTransaction(unsignedTx);

            //Ensure event emitted
            await expect(tx).to.emit(contract, "Initialize").withArgs(escrowData.offerer, escrowData.claimer, swapHash, hre.ethers.getAddress(escrowData.claimHandler), hre.ethers.getAddress(escrowData.refundHandler));

            //Ensure escrow committed
            const committedState = await contract.getHashState(swapHash);
            assert.strictEqual(committedState.initBlockheight, BigInt(tx.blockNumber));
            assert.strictEqual(committedState.state, 1n);

            //Update balances with the gas fee paid
            if(preBalances[signer.address]["0x0000000000000000000000000000000000000000"]!=null) {
                const receipt = await tx.wait();
                preBalances[signer.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
            }
            
            //Ensure funds properly transfered
            //Deposit should be transfered to the contract
            preBalances[signer.address][escrowData.depositToken] -= totalDeposit;
            preBalances[await contract.getAddress()][escrowData.depositToken] += totalDeposit;

            //Amount should be transfered to the contract
            if((escrowData.flags & 0b010n) === 0n) { //Not pay in
                assert.strictEqual(preBalanceOffererVault - escrowData.amount, (await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]))[0])
            } else {
                preBalances[escrowData.offerer][escrowData.token] -= escrowData.amount;
                preBalances[await contract.getAddress()][escrowData.token] += escrowData.amount;
            }

            //Assert balances
            for(let address in preBalances) {
                for(let tokenAddress in preBalances[address]) {
                    assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address));
                }
            }
        }

        async function initAndAssert(signer: HardhatEthersSigner, otherSigner: HardhatEthersSigner, escrowData: EscrowDataType, extraData?: Buffer) {
            const unsignedTx = await initTx(signer, otherSigner, escrowData, extraData);
            await initAssert(signer, escrowData, unsignedTx);
        }

        async function refundAndAssert(escrowData: EscrowDataType, witness: string) {
            const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                {address: escrowData.offerer, tokenAddress: escrowData.token},
                {address: await contract.getAddress(), tokenAddress: escrowData.token},
                {address: escrowData.offerer, tokenAddress: escrowData.depositToken},
                {address: escrowData.claimer, tokenAddress: escrowData.depositToken},
                {address: await contract.getAddress(), tokenAddress: escrowData.depositToken}
            ]);
            const [initialReputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
            const [preBalanceOffererVault] = await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]);

            const swapHash = getEscrowHash(escrowData);
            
            //Ensure event emitted
            const tx = await contract.refund(escrowData, witness);
            await expect(tx).to.emit(contract, "Refund").withArgs(escrowData.offerer, escrowData.claimer, swapHash, escrowData.refundHandler, witness);

            //Ensure escrow commitment is refunded
            const committedState = await contract.getHashState(swapHash);
            assert.strictEqual(committedState.finishBlockheight, BigInt(tx.blockNumber));
            assert.strictEqual(committedState.state, 3n);

            //Ensure reputation is updated
            if((escrowData.flags & 0b100n) == 0b100n) {
                const [reputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
                assert.strictEqual(initialReputation[2].count + 1n, reputation[2].count);
                assert.strictEqual(initialReputation[2].amount + escrowData.amount, reputation[2].amount);
            }

            //Update balances with the gas fee paid
            if(preBalances[account1.address]["0x0000000000000000000000000000000000000000"]!=null) {
                const receipt = await tx.wait();
                preBalances[account1.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
            }

            //Ensure funds properly transfered
            //Security deposit should be transfered to the offerer
            preBalances[escrowData.offerer][escrowData.depositToken] += escrowData.securityDeposit;
            preBalances[await contract.getAddress()][escrowData.depositToken] -= escrowData.securityDeposit;
            //Rest (if any) should be transfered back to claimer
            const leavesValue = escrowData.claimerBounty - escrowData.securityDeposit;
            if(leavesValue>0n) {
                preBalances[escrowData.claimer][escrowData.depositToken] += leavesValue;
                preBalances[await contract.getAddress()][escrowData.depositToken] -= leavesValue;
            }

            //Amount should be transfered back to offerer
            if((escrowData.flags & 0b010n) === 0n) { //Not pay in
                assert.strictEqual(preBalanceOffererVault + escrowData.amount, (await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]))[0])
            } else {
                preBalances[escrowData.offerer][escrowData.token] += escrowData.amount;
                preBalances[await contract.getAddress()][escrowData.token] -= escrowData.amount;
            }

            //Assert balances
            for(let address in preBalances) {
                for(let tokenAddress in preBalances[address]) {
                    assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address));
                }
            }
        }

        async function refundCoopTx(claimer: HardhatEthersSigner, escrowData: EscrowDataType) {
            const swapHash = getEscrowHash(escrowData);
            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            return await contract.cooperativeRefund.populateTransaction(escrowData, await claimer.signTypedData(eip712domain, {
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout}), timeout);
        }

        async function refundCoop(claimer: HardhatEthersSigner, escrowData: EscrowDataType) {
            return account1.sendTransaction(await refundCoopTx(claimer, escrowData));
        }

        async function refundCoopAssert(escrowData: EscrowDataType, unsignedTx: any) {
            const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                {address: escrowData.offerer, tokenAddress: escrowData.token},
                {address: await contract.getAddress(), tokenAddress: escrowData.token},
                {address: escrowData.claimer, tokenAddress: escrowData.depositToken},
                {address: await contract.getAddress(), tokenAddress: escrowData.depositToken}
            ]);
            const [initialReputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
            const [preBalanceOffererVault] = await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]);

            const swapHash = getEscrowHash(escrowData);

            const tx = await account1.sendTransaction(unsignedTx);

            //Ensure event emitted
            await expect(tx).to.emit(contract, "Refund").withArgs(escrowData.offerer, escrowData.claimer, swapHash, "0x0000000000000000000000000000000000000000", "0x");

            //Ensure escrow commitment is refunded
            const committedState = await contract.getHashState(swapHash);
            assert.strictEqual(committedState.finishBlockheight, BigInt(tx.blockNumber));
            assert.strictEqual(committedState.state, 3n);

            //Ensure reputation is updated
            if((escrowData.flags & 0b100n) == 0b100n) {
                const [reputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
                assert.strictEqual(initialReputation[1].count + 1n, reputation[1].count);
                assert.strictEqual(initialReputation[1].amount + escrowData.amount, reputation[1].amount);
            }

            //Update balances with the gas fee paid
            if(preBalances[account1.address]["0x0000000000000000000000000000000000000000"]!=null) {
                const receipt = await tx.wait();
                preBalances[account1.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
            }

            //Ensure funds properly transfered
            //Whole deposit should be transfered back to claimer
            const totalDeposit = escrowData.claimerBounty > escrowData.securityDeposit ? escrowData.claimerBounty : escrowData.securityDeposit;
            preBalances[escrowData.claimer][escrowData.depositToken] += totalDeposit;
            preBalances[await contract.getAddress()][escrowData.depositToken] -= totalDeposit;

            //Amount should be transfered back to offerer
            if((escrowData.flags & 0b010n) === 0n) { //Not pay in
                assert.strictEqual(preBalanceOffererVault + escrowData.amount, (await contract.getBalance([{owner: escrowData.offerer, token: escrowData.token}]))[0])
            } else {
                preBalances[escrowData.offerer][escrowData.token] += escrowData.amount;
                preBalances[await contract.getAddress()][escrowData.token] -= escrowData.amount;
            }

            //Assert balances
            for(let address in preBalances) {
                for(let tokenAddress in preBalances[address]) {
                    assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address));
                }
            }
        }

        async function refundCoopAndAssert(claimer: HardhatEthersSigner, escrowData: EscrowDataType) {
            const unsignedTx = await refundCoopTx(claimer, escrowData);
            await refundCoopAssert(escrowData, unsignedTx);
        }

        async function claimAndAssert(escrowData: EscrowDataType, witness: string, executionAction?: ExecutionAction) {
            const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                {address: escrowData.claimer, tokenAddress: escrowData.token},
                {address: await contract.getAddress(), tokenAddress: escrowData.token},
                {address: escrowData.claimer, tokenAddress: escrowData.depositToken},
                {address: account3.address, tokenAddress: escrowData.depositToken},
                {address: await contract.getAddress(), tokenAddress: escrowData.depositToken}
            ]);
            const [initialReputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
            const [preBalanceClaimerVault] = await contract.getBalance([{owner: escrowData.claimer, token: escrowData.token}]);

            const swapHash = getEscrowHash(escrowData);
            
            //Ensure event emitted
            let tx;
            if(executionAction!=null) {
                tx = await contract.connect(account3).claimWithSuccessAction(escrowData, witness, executionAction);
            } else {
                tx = await contract.connect(account3).claim(escrowData, witness);
            }
            await expect(tx).to.emit(contract, "Claim").withArgs(escrowData.offerer, escrowData.claimer, swapHash, escrowData.claimHandler, witness);

            //Ensure escrow commitment is claimed
            const committedState = await contract.getHashState(swapHash);
            assert.strictEqual(committedState.finishBlockheight, BigInt(tx.blockNumber));
            assert.strictEqual(committedState.state, 2n);

            //Ensure reputation is updated
            if((escrowData.flags & 0b100n) == 0b100n) {
                const [reputation] = await contract.getReputation([{owner: escrowData.claimer, token: escrowData.token, claimHandler: escrowData.claimHandler}]);
                assert.strictEqual(initialReputation[0].count + 1n, reputation[0].count);
                assert.strictEqual(initialReputation[0].amount + escrowData.amount, reputation[0].amount);
            }

            //Update balances with the gas fee paid
            if(preBalances[account3.address]["0x0000000000000000000000000000000000000000"]!=null) {
                const receipt = await tx.wait();
                preBalances[account3.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
            }

            //Ensure funds properly transfered
            //Claimer bounty should be transfered to account3
            preBalances[account3.address][escrowData.depositToken] += escrowData.claimerBounty;
            preBalances[await contract.getAddress()][escrowData.depositToken] -= escrowData.claimerBounty;
            //Rest (if any) should be transfered back to claimer
            const leavesValue = escrowData.securityDeposit - escrowData.claimerBounty;
            if(leavesValue>0n) {
                preBalances[escrowData.claimer][escrowData.depositToken] += leavesValue;
                preBalances[await contract.getAddress()][escrowData.depositToken] -= leavesValue;
            }

            //Amount should be transfered to claimer
            if((escrowData.flags & 0b001n) === 0n && executionAction==null) { //Not pay out
                assert.strictEqual(preBalanceClaimerVault + escrowData.amount, (await contract.getBalance([{owner: escrowData.claimer, token: escrowData.token}]))[0])
            } else {
                preBalances[escrowData.claimer][escrowData.token] += escrowData.amount;
                preBalances[await contract.getAddress()][escrowData.token] -= escrowData.amount;
            }

            //Assert balances
            for(let address in preBalances) {
                for(let tokenAddress in preBalances[address]) {
                    assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address));
                }
            }

            return tx;
        }

        return {
            contract, account1, account2, account3, erc20Contract1, erc20Contract2, 
            initTx, init, initAssert, initAndAssert, refundAndAssert, refundCoopAndAssert, refundCoop, refundCoopAssert, claimAndAssert, getInitSignature,
            eip712domain, claimHandler, refundHandler, dummyContract, erc1271Account
        };
    }

    describe("Claim", function() {
        for(let i=0;i<192;i++) {
            const payOut = (i & 0b00001) === 0b00001;
            const trackingReputation = (i & 0b00010) === 0b00010;
            const hasSecurityDeposit = (i & 0b00100) === 0b00100;
            const hasClaimerBounty = (i & 0b01000) === 0b01000;
            const nativeToken = (i & 0b10000) === 0b10000;
            const nativeTokenDeposit = (i & 0b100000) === 0b100000;
            const successActionSuccess = (i & 0b11000000) === 0b01000000;
            const successActionError = (i & 0b11000000) === 0b10000000;

            it("Valid claim (payOut="+payOut+",reputation="+trackingReputation+",securityDeposit="+hasSecurityDeposit+",claimerBounty="+hasClaimerBounty+",usesNativeToken="+nativeToken+",usesNativeTokenForDeposit="+nativeTokenDeposit+",successActionSuccess="+successActionSuccess+",successActionError="+successActionError+")", async function () {
                const {contract, account1, account2, erc20Contract1, erc20Contract2, claimAndAssert, init, claimHandler, dummyContract} = await loadFixture(deploy);
                const escrowData = getRandomEscrowData();

                escrowData.token = nativeToken ? "0x0000000000000000000000000000000000000000" : await erc20Contract1.getAddress();
                escrowData.depositToken = nativeTokenDeposit ? "0x0000000000000000000000000000000000000000" : await erc20Contract2.getAddress();

                let successAction: ExecutionAction;
                if(successActionSuccess) {
                    const {to, data} = await dummyContract.call.populateTransaction("0x01020304");
                    successAction = {
                        gasLimit: 10_000n,
                        calls: [{target: to, data, value: 0n}],
                        drainTokens: []
                    };
                    escrowData.successActionCommitment = getExecutionActionHash(successAction);
                } else if(successActionError) {
                    const {to, data} = await dummyContract.callRevert.populateTransaction("This is a rejection");
                    successAction = {
                        gasLimit: 10_000n,
                        calls: [{target: to, data, value: 0n}],
                        drainTokens: []
                    };
                    escrowData.successActionCommitment = getExecutionActionHash(successAction);
                } else {
                    escrowData.successActionCommitment = "0x0000000000000000000000000000000000000000000000000000000000000000";
                }

                escrowData.claimHandler = await claimHandler.getAddress();
                escrowData.offerer = await account1.getAddress();
                escrowData.claimer = await account2.getAddress();
                escrowData.amount = 1000n;
                escrowData.flags = 0n;
                if(payOut) escrowData.flags |= 0b001n;
                if(trackingReputation) escrowData.flags |= 0b100n;
                escrowData.securityDeposit = !hasSecurityDeposit ? 0n : 500n;
                escrowData.claimerBounty = !hasClaimerBounty ? 0n : 285n;

                const swapHash = getEscrowHash(escrowData)

                await init(account1, account2, escrowData);
                const tx = await claimAndAssert(escrowData, escrowData.claimData, successAction);
                if(successActionSuccess) await expect(tx).to.emit(dummyContract, "Event").withArgs("0x01020304");
                if(successActionError) await expect(tx).to.emit(contract, "ExecutionError").withArgs(swapHash, "0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135468697320697320612072656a656374696f6e00000000000000000000000000");
            });
        }

        it("Valid claim (contract call runs out of gas)", async function() {
            const {contract, account1, account2, erc20Contract1, init, claimHandler, dummyContract, claimAndAssert} = await loadFixture(deploy);

            const {to, data} = await dummyContract.outOfGas.populateTransaction(); //This call does an infinite loop
            const successAction: ExecutionAction = {
                gasLimit: 10_000n, //Limit the gas to 10,000, should run out of gas
                calls: [{target: to, data, value: 0n}],
                drainTokens: []
            };

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: getExecutionActionHash(successAction)
            };

            const swapHash = getEscrowHash(escrowData);

            await init(account1, account2, escrowData);
            await expect(claimAndAssert(escrowData, escrowData.claimData, successAction)).to.emit(contract, "ExecutionError").withArgs(swapHash, "0x");
        });

        it("Invalid claim (negative answer from claim handler)", async function() {
            const {contract, account1, account2, erc20Contract1, init, claimHandler} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000"
            };
            await init(account1, account2, escrowData);
            const invalidWitness = randomBytes32();
            await expect(contract.claim(escrowData, invalidWitness)).to.be.revertedWith("dummyClaimHandler: bad witness");
        });

        it("Invalid claim (claim uninitialized escrow)", async function() {
            const {contract, account1, account2, erc20Contract1, claimHandler} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000"
            };
            // await init(account1, account2, escrowData); //Don't initialize
            await expect(contract.claim(escrowData, escrowData.claimData)).to.be.revertedWith("_finalize: Not committed");
        });

        it("Invalid claim (claim twice)", async function() {
            const {contract, account1, account2, erc20Contract1, claimHandler, init} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000"
            };
            await init(account1, account2, escrowData);
            await contract.claim(escrowData, escrowData.claimData); //Claim first time
            await expect(contract.claim(escrowData, escrowData.claimData)).to.be.revertedWith("_finalize: Not committed"); //Claim second time
        });

        it("Invalid claim (no execution specified, but success action execution attempted)", async function() {
            const {contract, account1, account2, erc20Contract1, init, claimHandler, dummyContract, claimAndAssert} = await loadFixture(deploy);

            const {to, data} = await dummyContract.call.populateTransaction("0x01020304"); //This call does an infinite loop
            const successAction: ExecutionAction = {
                gasLimit: 10_000n, //Limit the gas to 10,000, should run out of gas
                calls: [{target: to, data, value: 0n}],
                drainTokens: []
            };

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000" //No success action committed
            };

            await init(account1, account2, escrowData);
            await expect(contract.claimWithSuccessAction(escrowData, escrowData.claimData, successAction)).to.be.revertedWith("claim: invalid success action");
        });

        it("Invalid claim (success action execution specified, but no success action execution attempted)", async function() {
            const {contract, account1, account2, erc20Contract1, init, claimHandler, dummyContract, claimAndAssert} = await loadFixture(deploy);

            const {to, data} = await dummyContract.call.populateTransaction("0x01020304"); //This call does an infinite loop
            const successAction: ExecutionAction = {
                gasLimit: 10_000n, //Limit the gas to 10,000, should run out of gas
                calls: [{target: to, data, value: 0n}],
                drainTokens: []
            };

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: await claimHandler.getAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: getExecutionActionHash(successAction) //Success action committed
            };

            await init(account1, account2, escrowData);
            await expect(contract.claim(escrowData, escrowData.claimData)).to.be.revertedWith("claim: has success action");
        });
    });

    describe("Refund cooperative", function() {
        for(let i=0;i<64;i++) {
            const payIn = (i & 0b00001) === 0b00001;
            const trackingReputation = (i & 0b00010) === 0b00010;
            const hasSecurityDeposit = (i & 0b00100) === 0b00100;
            const hasClaimerBounty = (i & 0b01000) === 0b01000;
            const nativeToken = (i & 0b10000) === 0b10000;
            const nativeTokenDeposit = (i & 0b100000) === 0b100000;

            it("Valid cooperative refund (payIn="+payIn+",reputation="+trackingReputation+",securityDeposit="+hasSecurityDeposit+",claimerBounty="+hasClaimerBounty+",usesNativeToken="+nativeToken+",usesNativeTokenForDeposit="+nativeTokenDeposit+")", async function () {
                const {account1, account2, erc20Contract1, erc20Contract2, refundCoopAndAssert, init, refundHandler} = await loadFixture(deploy);
                const escrowData = getRandomEscrowData();

                escrowData.token = nativeToken ? "0x0000000000000000000000000000000000000000" : await erc20Contract1.getAddress();
                escrowData.depositToken = nativeTokenDeposit ? "0x0000000000000000000000000000000000000000" : await erc20Contract2.getAddress();

                escrowData.offerer = await account1.getAddress();
                escrowData.claimer = await account2.getAddress();
                escrowData.amount = 1000n;
                escrowData.flags = 0n;
                if(payIn) escrowData.flags |= 0b010n;
                if(trackingReputation) escrowData.flags |= 0b100n;
                escrowData.securityDeposit = !hasSecurityDeposit ? 0n : 500n;
                escrowData.claimerBounty = !hasClaimerBounty ? 0n : 285n;

                await init(account1, account2, escrowData);
                await refundCoopAndAssert(account2, escrowData);
            });
        }

        it("Valid refund cooperative (claimer is an erc1271 account)", async function() {
            const {contract, account1, account3, erc20Contract1, init, refundCoopAssert, erc1271Account, eip712domain} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: await erc1271Account.getAddress(),
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, null, escrowData);

            const swapHash = getEscrowHash(escrowData);
            const timeout = BigInt(Math.floor((Date.now() / 1000) + 60*60));
            const unsignedTx = await contract.cooperativeRefund.populateTransaction(escrowData, await account3.signTypedData(eip712domain, { //erc1271Account uses account3 as signer
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout}), timeout); 
            await refundCoopAssert(escrowData, unsignedTx);
        });

        it("Invalid refund cooperative (not initialized)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundCoop} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            // await init(account1, account2, escrowData); //Don't initialize
            await expect(refundCoop(account2, escrowData)).to.be.revertedWith("_finalize: Not committed");
        });

        it("Invalid refund cooperative (try to refund twice)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundCoop} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);
            await refundCoop(account2, escrowData);
            await expect(refundCoop(account2, escrowData)).to.be.revertedWith("_finalize: Not committed");
        });

        it("Invalid refund cooperative (timed out refund authorization)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundCoop, eip712domain} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);

            const swapHash = getEscrowHash(escrowData);
            const alreadyExpiredTimeout = BigInt(Math.floor((Date.now() / 1000) - 60*60));
            await expect(contract.cooperativeRefund(escrowData, await account2.signTypedData(eip712domain, {
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout: alreadyExpiredTimeout}), alreadyExpiredTimeout)).to.be.revertedWith("coopRefund: Auth expired");
        });

        it("Invalid refund cooperative (sign different timeout)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundCoop, eip712domain} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);

            const swapHash = getEscrowHash(escrowData);
            const alreadyExpiredTimeout = BigInt(Math.floor((Date.now() / 1000) - 60*60));
            const validTimeout = BigInt(Math.floor((Date.now() / 1000) + 60*60));
            await expect(contract.cooperativeRefund(escrowData, await account2.signTypedData(eip712domain, {
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout: alreadyExpiredTimeout}), validTimeout)).to.be.revertedWith("coopRefund: invalid signature");
        });

        it("Invalid refund cooperative (sign random swap hash)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundCoop, eip712domain} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);

            const invalidSwapHash = randomBytes32();
            const validTimeout = BigInt(Math.floor((Date.now() / 1000) + 60*60));
            await expect(contract.cooperativeRefund(escrowData, await account2.signTypedData(eip712domain, {
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash: invalidSwapHash, timeout: validTimeout}), validTimeout)).to.be.revertedWith("coopRefund: invalid signature");
        });

        it("Invalid refund cooperative (wrong signer)", async function() {
            const {contract, account1, account2, account3, erc20Contract1, init, refundCoop, eip712domain} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);

            const swapHash = getEscrowHash(escrowData);
            const validTimeout = BigInt(Math.floor((Date.now() / 1000) + 60*60));
            await expect(contract.cooperativeRefund(escrowData, await account3.signTypedData(eip712domain, { //Sign using account3
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout: validTimeout}), validTimeout)).to.be.revertedWith("coopRefund: invalid signature");
        });
    });

    describe("Refund", function() {
        for(let i=0;i<128;i++) {
            const securityDepositLargerThanClaimerBounty = (i & 0b000001) === 0b000001;
            const payIn = (i & 0b000010) === 0b000010;
            const trackingReputation = (i & 0b000100) === 0b000100;
            const hasSecurityDeposit = (i & 0b001000) === 0b001000;
            const hasClaimerBounty = (i & 0b010000) === 0b010000;
            const nativeToken = (i & 0b100000) === 0b100000;
            const nativeTokenDeposit = (i & 0b1000000) === 0b1000000;

            if(!hasSecurityDeposit && !hasClaimerBounty && securityDepositLargerThanClaimerBounty) continue;

            it("Valid refund (securityDepositLargerThanClaimerBounty="+securityDepositLargerThanClaimerBounty+",payIn="+payIn+",reputation="+trackingReputation+",securityDeposit="+hasSecurityDeposit+",claimerBounty="+hasClaimerBounty+",usesNativeToken="+nativeToken+",usesNativeTokenForDeposit="+nativeTokenDeposit+")", async function () {
                const {account1, account2, erc20Contract1, erc20Contract2, refundAndAssert, init, refundHandler} = await loadFixture(deploy);
                const escrowData = getRandomEscrowData();

                escrowData.token = nativeToken ? "0x0000000000000000000000000000000000000000" : await erc20Contract1.getAddress();
                escrowData.depositToken = nativeTokenDeposit ? "0x0000000000000000000000000000000000000000" : await erc20Contract2.getAddress();

                escrowData.refundHandler = await refundHandler.getAddress();
                escrowData.offerer = await account1.getAddress();
                escrowData.claimer = await account2.getAddress();
                escrowData.amount = 1000n;
                escrowData.flags = 0n;
                if(payIn) escrowData.flags |= 0b010n;
                if(trackingReputation) escrowData.flags |= 0b100n;
                escrowData.securityDeposit = !hasSecurityDeposit ? 0n : securityDepositLargerThanClaimerBounty ? 500n : 250n;
                escrowData.claimerBounty = !hasClaimerBounty ? 0n : securityDepositLargerThanClaimerBounty ? 250n : 500n;

                await init(account1, account2, escrowData);
                await refundAndAssert(escrowData, escrowData.refundData);
            });
        }

        it("Invalid refund (negative answer from refund handler)", async function() {
            const {contract, account1, account2, erc20Contract1, init, refundHandler} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: await refundHandler.getAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);
            const invalidWitness = randomBytes32();
            await expect(contract.refund(escrowData, invalidWitness)).to.be.revertedWith("dummyRefundHandler: bad witness");
        });

        it("Invalid refund (refund uninitialized escrow)", async function() {
            const {contract, account1, account2, erc20Contract1, refundHandler} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: await refundHandler.getAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            // await init(account1, account2, escrowData); //Don't initialize
            await expect(contract.refund(escrowData, escrowData.refundData)).to.be.revertedWith("_finalize: Not committed");
        });

        it("Invalid refund (refund twice)", async function() {
            const {contract, account1, account2, erc20Contract1, refundHandler, init} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: await refundHandler.getAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            await init(account1, account2, escrowData);
            await contract.refund(escrowData, escrowData.refundData); //Refund first time
            await expect(contract.refund(escrowData, escrowData.refundData)).to.be.revertedWith("_finalize: Not committed"); //Refund second time
        });
    });

    describe("Initialize", function() {
        for(let i=0;i<128;i++) {
            const senderClaimer = (i & 0b000001) === 0b000001;
            const payIn = (i & 0b000010) === 0b000010;
            const trackingReputation = (i & 0b000100) === 0b000100;
            const hasSecurityDeposit = (i & 0b001000) === 0b001000;
            const hasClaimerBounty = (i & 0b010000) === 0b010000;
            const nativeToken = (i & 0b100000) === 0b100000;
            const nativeTokenDeposit = (i & 0b1000000) === 0b1000000;

            if(nativeToken && senderClaimer) continue;

            it("Valid initialize (senderClaimer="+senderClaimer+",payIn="+payIn+",reputation="+trackingReputation+",securityDeposit="+hasSecurityDeposit+",claimerBounty="+hasClaimerBounty+",usesNativeToken="+nativeToken+",usesNativeTokenForDeposit="+nativeTokenDeposit+")", async function () {
                const {account1, account2, erc20Contract1, erc20Contract2, initAndAssert} = await loadFixture(deploy);
                const escrowData = getRandomEscrowData();

                escrowData.token = nativeToken ? "0x0000000000000000000000000000000000000000" : await erc20Contract1.getAddress();
                escrowData.depositToken = nativeTokenDeposit ? "0x0000000000000000000000000000000000000000" : await erc20Contract2.getAddress();

                escrowData.offerer = await account1.getAddress();
                escrowData.claimer = await account2.getAddress();
                escrowData.amount = 1000n;
                escrowData.flags = 0n;
                if(payIn) escrowData.flags |= 0b010n;
                if(trackingReputation) escrowData.flags |= 0b100n;
                escrowData.securityDeposit = hasSecurityDeposit ? 500n : 0n;
                escrowData.claimerBounty = hasClaimerBounty ? 400n : 0n;

                await initAndAssert(senderClaimer ? account2 : account1, senderClaimer ? account1 : account2, escrowData, randomBytes(randomUnsigned(8)));
            });
        }

        it("Valid initialize (claimer is an erc1271 account)", async function() {
            const {contract, account1, initAssert, account3, erc20Contract1, eip712domain, erc1271Account, getInitSignature} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account1.address,
                claimer: await erc1271Account.getAddress(), //Account1, so claimer initiates, therefore signature is required
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b100n, //Tracking reputation (therefore requires claimer signature) and not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            const unsignedTx = await contract.initialize.populateTransaction(
                escrowData,
                await getInitSignature(account3, escrowData, timeout), //erc1271Account account uses account3 as signer
                timeout,
                "0x"
            );
            await initAssert(account1, escrowData, unsignedTx);
        });

        it("Invalid initialize not enough balance (payIn)", async function() {
            const {account1, account2, erc20Contract1, initTx} = await loadFixture(deploy);
            await expect(account2.sendTransaction(await initTx(account2, account1, {
                offerer: account2.address,
                claimer: account1.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 2_000_000_000_000_000_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            }))).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
        });

        it("Invalid initialize not enough balance (not payIn)", async function() {
            const {account1, account2, erc20Contract1, initTx} = await loadFixture(deploy);
            await expect(account2.sendTransaction(await initTx(account2, account1, {
                offerer: account2.address,
                claimer: account1.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 2_000_000_000_000_000_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            }))).to.be.revertedWith("_xferIn: not enough balance");
        });

        it("Invalid initialize not enough native token sent to the contract", async function() {
            const {account1, account2, initTx} = await loadFixture(deploy);
            const unsignedTx = await initTx(account2, account1, {
                offerer: account2.address,
                claimer: account1.address,
                token: "0x0000000000000000000000000000000000000000",
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 2_000_000_000_000_000_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            });
            unsignedTx.value = 1000n; //Set the transaction value to be low

            await expect(account2.sendTransaction(unsignedTx)).to.be.revertedWith("transferIn: value too low");
        });

        it("Invalid initialize (check correct handling of msg.value)", async function() {
            const {account1, account2, initTx} = await loadFixture(deploy);
            const unsignedTx = await initTx(account2, account1, {
                offerer: account2.address,
                claimer: account1.address,
                token: "0x0000000000000000000000000000000000000000",
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000_000_000_000_000_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 1_000_000_000_000_000_000n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            }); //Tx value required now should be 2_000_000_000_000_000_000n in total
            unsignedTx.value = 1_000_000_000_000_000_000n; //Set the transaction value to be just 1_000_000_000_000_000_000n

            await expect(account2.sendTransaction(unsignedTx)).to.be.revertedWith("transferIn: value too low");
        });

        it("Invalid initialize not enough allowance (payIn erc-20)", async function() {
            const {contract, account1, account2, erc20Contract1, initTx} = await loadFixture(deploy);

            await erc20Contract1.approve(await contract.getAddress(), 500n); //Approve too little
            await expect(contract.initialize(
                {
                    offerer: account1.address,
                    claimer: account2.address,
                    token: await erc20Contract1.getAddress(),
                    refundHandler: randomAddress(),
                    claimHandler: randomAddress(),
                    flags: 0b010n, //Pay-in
                    claimData: randomBytes32(),
                    refundData: randomBytes32(),
                    amount: 1_000n,
                    depositToken: "0x0000000000000000000000000000000000000000",
                    securityDeposit: 0n,
                    claimerBounty: 0n,
                    successActionCommitment: randomBytes32()
                }, 
                "0x",
                BigInt(Math.floor((Date.now()/1000) + 60*60)),
                "0x"
            )).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientAllowance");
        });

        it("Invalid initialize not enough deposit token balance (erc-20)", async function() {
            const {account1, account2, erc20Contract1, erc20Contract2, initTx} = await loadFixture(deploy);

            const unsignedTx = await initTx(account2, account1, {
                offerer: account2.address,
                claimer: account1.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b010n, //Pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: await erc20Contract2.getAddress(),
                securityDeposit: 2_000_000_000_000_000_000n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            });
            await expect(account2.sendTransaction(unsignedTx)).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
        });

        it("Invalid initialize not enough deposit token allowance (erc-20)", async function() {
            const {contract, account1, account2, erc20Contract1, erc20Contract2} = await loadFixture(deploy);

            await erc20Contract1.approve(await contract.getAddress(), 1_000n);
            await erc20Contract2.approve(await contract.getAddress(), 100n); //Approve too little
            await expect(contract.initialize(
                {
                    offerer: account1.address,
                    claimer: account2.address,
                    token: await erc20Contract1.getAddress(),
                    refundHandler: randomAddress(),
                    claimHandler: randomAddress(),
                    flags: 0b010n, //Pay-in
                    claimData: randomBytes32(),
                    refundData: randomBytes32(),
                    amount: 1_000n,
                    depositToken: await erc20Contract2.getAddress(),
                    securityDeposit: 500n,
                    claimerBounty: 0n,
                    successActionCommitment: randomBytes32()
                },
                "0x",
                BigInt(Math.floor((Date.now()/1000) + 60*60)),
                "0x"
            )).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientAllowance");
        });

        it("Invalid initialize wrong signer", async function() {
            const {contract, account1, account2, account3, erc20Contract1, eip712domain, getInitSignature} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account2.address,
                claimer: account1.address, //Account1, so claimer initiates, therefore signature is required
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await expect(contract.initialize(
                escrowData,
                await getInitSignature(account3, escrowData, timeout), //Sign with different signer
                timeout,
                "0x"
            )).to.be.revertedWith("init: invalid signature");
        });

        it("Invalid initialize bad sign message", async function() {
            const {contract, account1, account2, erc20Contract1, getInitSignature} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account2.address,
                claimer: account1.address, //Account1, so claimer initiates, therefore signature is required
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await expect(contract.initialize(
                escrowData,
                await getInitSignature(account2, getRandomEscrowData(), randomUnsignedBigInt(32)), //Sign different data
                timeout,
                "0x"
            )).to.be.revertedWith("init: invalid signature");
        });

        it("Invalid initialize bad sign message (extra data)", async function() {
            const {contract, account1, account2, erc20Contract1, getInitSignature} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account2.address,
                claimer: account1.address, //Account1, so claimer initiates, therefore signature is required
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };
            const extraData = randomBytes(128);

            await expect(contract.initialize(
                escrowData,
                await getInitSignature(account2, escrowData, timeout, randomBytes(64)), //Sign different extraData
                timeout,
                extraData
            )).to.be.revertedWith("init: invalid signature");
        });

        it("Invalid initialize 3rd party caller", async function() {
            const {contract, account1, account2, account3, erc20Contract1, eip712domain} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await expect(contract.connect(account3).initialize( //Initiate with account3
                escrowData,
                "0x",
                timeout,
                "0x"
            )).to.be.revertedWith("init: Caller address");
        });

        it("Invalid initialize expired", async function() {
            const {contract, account1, account2, account3, erc20Contract1, eip712domain} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) - 60*60));

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await expect(contract.connect(account3).initialize( //Initiate with account3
                escrowData,
                "0x",
                timeout,
                "0x"
            )).to.be.revertedWith("init: Authorization expired");
        });

        it("Invalid initialize sign different timeout", async function() {
            const {contract, account1, account2, erc20Contract1, getInitSignature} = await loadFixture(deploy);

            const timeout = BigInt(Math.floor((Date.now()/1000) + 60*60));

            const escrowData = {
                offerer: account2.address,
                claimer: account1.address, //Account1, so claimer initiates, therefore signature is required
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await expect(contract.initialize(
                escrowData,
                await getInitSignature(account2, escrowData, 0n), //Sign different timeout
                timeout,
                "0x"
            )).to.be.revertedWith("init: invalid signature");
        });
        
        it("Invalid initialize commit twice", async function() {
            const {contract, account1, account2, erc20Contract1, initTx} = await loadFixture(deploy);

            const escrowData = {
                offerer: account1.address,
                claimer: account2.address,
                token: await erc20Contract1.getAddress(),
                refundHandler: randomAddress(),
                claimHandler: randomAddress(),
                flags: 0b000n, //Not pay-in
                claimData: randomBytes32(),
                refundData: randomBytes32(),
                amount: 1_000n,
                depositToken: "0x0000000000000000000000000000000000000000",
                securityDeposit: 0n,
                claimerBounty: 0n,
                successActionCommitment: randomBytes32()
            };

            await account1.sendTransaction(await initTx(account1, account2, escrowData));
            await expect(account1.sendTransaction(await initTx(account1, account2, escrowData))).to.be.revertedWith("_commit: Already committed");
        });
    });

});
