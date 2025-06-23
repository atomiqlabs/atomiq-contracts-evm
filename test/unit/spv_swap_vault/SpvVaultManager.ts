import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import { EscrowDataType, getEscrowHash, getRandomEscrowData } from "../../utils/evm/escrow_data";
import { contracts, TestERC20 } from "../../../typechain-types";
import { packAddressAndVaultId, randomAddress, randomBytes32, structToArray } from "../../utils/evm/utils";
import { randomUnsigned, randomUnsignedBigInt } from "../../utils/random";
import { ExecutionAction, getExecutionActionHash } from "../../utils/evm/execution_action";
import {randomBytes} from "crypto";
import { getRandomSpvVaultParameters, getSpvVaultParametersHash, SpvVaultParameters } from "../../utils/evm/spv_vault_parameters";
import { getValidSpvVaultBtcTx } from "./generators/spv_vault_btc_tx";
import { generateMerkleRoot } from "../../utils/merkle_tree";
import { mineBitcoinBlock } from "../../utils/blockchain_utils";
import { serializeBitcoindStoredBlockheaderToStruct } from "../../utils/evm/stored_blockheader";
import { getExecutionHash, getRandomExecution } from "../../utils/evm/execution";

describe("SpvVaultManager", function () {

    async function deploy() {
        const BtcRelay = await hre.ethers.getContractFactory("BtcRelay");
        const ExecutionContract = await hre.ethers.getContractFactory("ExecutionContract");
        const executionContract = await ExecutionContract.deploy();

        const SpvVaultManager = await hre.ethers.getContractFactory("SpvVaultManager");
        const contract = await SpvVaultManager.deploy(await executionContract.getAddress());

        const ERC20 = await hre.ethers.getContractFactory("TestERC20");
        const erc20Contract1 = await ERC20.deploy();
        const erc20Contract2 = await ERC20.deploy();

        const DummyContract = await hre.ethers.getContractFactory("DummyContract");
        const dummyContract = await DummyContract.deploy();

        const [account1, account2, account3] = await hre.ethers.getSigners();

        //Ensure all accounts are funded
        await erc20Contract1.transfer(account2, 2_000_000_000_000_000_000n);
        await erc20Contract2.transfer(account2, 2_000_000_000_000_000_000n);

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

        async function getClosedVault() {
            const txThatWithdrawsTooMuch = getValidSpvVaultBtcTx(account3.address, 1000n, 0n, 0n, 0n);
            
            const [root, proof, position] = generateMerkleRoot(txThatWithdrawsTooMuch.getHash(), 5);

            const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));

            const blockHeaderStruct = serializeBitcoindStoredBlockheaderToStruct(genesis);
            const relayContract = await BtcRelay.deploy(blockHeaderStruct, false);
            
            const spvVaultParams = getRandomSpvVaultParameters();
            spvVaultParams.btcRelayContract = await relayContract.getAddress();
            spvVaultParams.confirmations = 1n;
            const utxoTxHash = txThatWithdrawsTooMuch.ins[0].hash;
            const utxoVout = txThatWithdrawsTooMuch.ins[0].index;
            const vaultId = 0n;

            await contract.open(vaultId, spvVaultParams, utxoTxHash, utxoVout);
            await expect(contract.claim(
                account1.address, vaultId, spvVaultParams, 
                txThatWithdrawsTooMuch.toBuffer(), blockHeaderStruct, proof.map(val => Buffer.from(val, "hex")), position
            )).to.emit(contract, "Closed");

            return {
                owner: account1.address,
                vaultId,
                spvVaultParams
            };
        }

        return {
            executionContract, ERC20, BtcRelay, contract, account1, account2, account3, erc20Contract1, erc20Contract2, dummyContract,
            getClosedVault, getBalances, getBalance
        };
    }

    describe("Open", function() {
        
        it("Valid open vault", async function() {
            const {contract, account1} = await loadFixture(deploy);

            const spvVaultParams = getRandomSpvVaultParameters();
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const vaultId = 0n;

            const receipt = await contract.open(vaultId, spvVaultParams, utxoTxHash, utxoVout);
            
            await expect(
                receipt
            ).to.emit(contract, "Opened").withArgs(hre.ethers.getAddress(account1.address), vaultId, utxoTxHash, utxoVout, structToArray(spvVaultParams));

            const vaultData = await contract.getVault(account1.address, vaultId);
            assert.strictEqual(vaultData.spvVaultParametersCommitment, getSpvVaultParametersHash(spvVaultParams));
            assert.strictEqual(vaultData.utxoTxHash, utxoTxHash);
            assert.strictEqual(vaultData.utxoVout, utxoVout);
            assert.strictEqual(vaultData.openBlockheight, BigInt(receipt.blockNumber));
            assert.strictEqual(vaultData.withdrawCount, 0n);
            assert.strictEqual(vaultData.depositCount, 0n);
            assert.strictEqual(vaultData.token0Amount, 0n);
            assert.strictEqual(vaultData.token1Amount, 0n);
        });

        it("Invalid open vault (already opened)", async function() {
            const {contract} = await loadFixture(deploy);

            const vaultId = 0n;

            await contract.open(vaultId, getRandomSpvVaultParameters(), randomBytes32(), randomUnsignedBigInt(32));
            
            await expect(
                contract.open(vaultId, getRandomSpvVaultParameters(), randomBytes32(), randomUnsignedBigInt(32))
            ).to.be.revertedWith("open: already opened");
        });

    });

    describe("Deposit", function() {
        
        for(let i=0;i<128;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const thirdPartyDeposit = (i & 0b10000) !== 0;
            const noToken0 = (i & 0b100000) !== 0;
            const noToken1 = (i & 0b1000000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(noToken0 && noToken1) continue;

            it("Valid deposit (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",thirdPartyDeposit="+thirdPartyDeposit+",noToken0="+noToken0+",noToken1="+noToken1+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, getBalances, getBalance} = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const depositor = thirdPartyDeposit ? account2 : account1;

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = getRandomSpvVaultParameters();
                vaultParams.token0 = token0;
                vaultParams.token1 = token1;
                vaultParams.token0Multiplier = 1n;
                vaultParams.token1Multiplier = 1n;
                const utxoTxHash = randomBytes32();
                const utxoVout = randomUnsignedBigInt(32);
                const openReceipt = await contract.open(vaultId, vaultParams, utxoTxHash, utxoVout);

                const amount0 = noToken0 ? 0n : 1000n;
                const amount1 = noToken1 ? 0n : 500n;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).connect(depositor).approve(await contract.getAddress(), amount0);
                } else msgValue += amount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).connect(depositor).approve(await contract.getAddress(), token0===token1 ? amount0+amount1 : amount1);
                } else msgValue += amount1;

                const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                    {address: depositor.address, tokenAddress: token0},
                    {address: await contract.getAddress(), tokenAddress: token0},
                    {address: depositor.address, tokenAddress: token1},
                    {address: await contract.getAddress(), tokenAddress: token1}
                ]);

                const tx = await contract.connect(depositor).deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                    value: msgValue
                });

                await expect(
                    tx
                ).to.emit(contract, "Deposited").withArgs(
                    packAddressAndVaultId(account1.address, vaultId),
                    0n,
                    amount0,
                    amount1
                );

                //Update balances with the gas fee paid
                if(preBalances[depositor.address]["0x0000000000000000000000000000000000000000"]!=null) {
                    const receipt = await tx.wait();
                    preBalances[depositor.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
                }

                const vaultData = await contract.getVault(account1.address, vaultId);
                assert.strictEqual(vaultData.spvVaultParametersCommitment, getSpvVaultParametersHash(vaultParams));
                assert.strictEqual(vaultData.utxoTxHash, utxoTxHash);
                assert.strictEqual(vaultData.utxoVout, utxoVout);
                assert.strictEqual(vaultData.openBlockheight, BigInt(openReceipt.blockNumber));
                assert.strictEqual(vaultData.withdrawCount, 0n);
                assert.strictEqual(vaultData.depositCount, 1n);
                assert.strictEqual(vaultData.token0Amount, amount0);
                assert.strictEqual(vaultData.token1Amount, amount1);

                preBalances[depositor.address][token0] -= amount0;
                preBalances[await contract.getAddress()][token0] += amount0;
                preBalances[depositor.address][token1] -= amount1;
                preBalances[await contract.getAddress()][token1] += amount1;

                //Assert balances
                for(let address in preBalances) {
                    for(let tokenAddress in preBalances[address]) {
                        assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address));
                    }
                }
            });
        }

        for(let i=0;i<64;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const token0NotEnoughBalance = (i & 0b10000) !== 0;
            const token1NotEnoughBalance = (i & 0b100000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(token0NotEnoughBalance && token0Native) continue;
            if(token1NotEnoughBalance && token1Native) continue;
            if(!token0NotEnoughBalance && !token1NotEnoughBalance) continue;

            it("Invalid deposit - not enough balance erc-20 (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughBalance="+token0NotEnoughBalance+",token1NotEnoughBalance="+token1NotEnoughBalance+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2} = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = getRandomSpvVaultParameters();
                vaultParams.token0 = token0;
                vaultParams.token1 = token1;
                vaultParams.token0Multiplier = token0NotEnoughBalance ? 1_000_000_000_000_000_000_000_000_000_000_000_000n : 1n;
                vaultParams.token1Multiplier = token1NotEnoughBalance ? 1_000_000_000_000_000_000_000_000_000_000_000_000n : 1n;
                await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32));

                const amount0 = token0NotEnoughBalance ? 1_000_000_000_000_000n : 1000n;
                const amount1 = token1NotEnoughBalance ? 1_000_000_000_000_000n : 500n;
                const approveAmount0 = amount0 * vaultParams.token0Multiplier;
                const approveAmount1 = amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), approveAmount0);
                } else msgValue += approveAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), token0===token1 ? (approveAmount0 + approveAmount1) : approveAmount1);
                } else msgValue += approveAmount1;

                await expect(
                    contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                        value: msgValue
                    })
                ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientBalance");
            });
        }

        for(let i=0;i<64;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const token0NotEnoughAllowance = (i & 0b10000) !== 0;
            const token1NotEnoughAllowance = (i & 0b100000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(token0NotEnoughAllowance && token0Native) continue;
            if(token1NotEnoughAllowance && token1Native) continue;
            if(!token0NotEnoughAllowance && !token1NotEnoughAllowance) continue;

            it("Invalid deposit - not enough allowance erc-20 (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughAllowance="+token0NotEnoughAllowance+",token1NotEnoughAllowance="+token1NotEnoughAllowance+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2} = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = getRandomSpvVaultParameters();
                vaultParams.token0 = token0;
                vaultParams.token1 = token1;
                vaultParams.token0Multiplier = 1n;
                vaultParams.token1Multiplier = 1n;
                await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32));

                const amount0 = 1000n;
                const amount1 = 500n;
                const approveAmount0 = token0NotEnoughAllowance ? 1n : amount0 * vaultParams.token0Multiplier;
                const approveAmount1 = token1NotEnoughAllowance ? 1n : amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), approveAmount0);
                } else msgValue += approveAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), token0===token1 ? (approveAmount0 + approveAmount1) : approveAmount1);
                } else msgValue += approveAmount1;

                await expect(
                    contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                        value: msgValue
                    })
                ).to.be.revertedWithCustomError(erc20Contract1, "ERC20InsufficientAllowance");
            });
        }

        for(let i=0;i<64;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const token0NotEnoughMsgValue = (i & 0b10000) !== 0;
            const token1NotEnoughMsgValue = (i & 0b100000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(token0NotEnoughMsgValue && !token0Native) continue;
            if(token1NotEnoughMsgValue && !token1Native) continue;
            if(!token0NotEnoughMsgValue && !token1NotEnoughMsgValue) continue;

            it("Invalid deposit - not enough msg.value (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughMsgValue="+token0NotEnoughMsgValue+",token1NotEnoughMsgValue="+token1NotEnoughMsgValue+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2} = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = getRandomSpvVaultParameters();
                vaultParams.token0 = token0;
                vaultParams.token1 = token1;
                vaultParams.token0Multiplier = 1n;
                vaultParams.token1Multiplier = 1n;
                await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32));

                const amount0 = 1000n;
                const amount1 = 500n;
                const approveAmount0 = token0NotEnoughMsgValue ? 1n : amount0 * vaultParams.token0Multiplier;
                const approveAmount1 = token1NotEnoughMsgValue ? 1n : amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), approveAmount0);
                } else msgValue += approveAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), approveAmount1);
                } else msgValue += approveAmount1;

                await expect(
                    contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                        value: msgValue
                    })
                ).to.be.revertedWith("transferIn: value too low");
            });
        }

        it("Invalid deposit - msg.value only enough for one deposit", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2} = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = getRandomSpvVaultParameters();
            vaultParams.token0 = token0;
            vaultParams.token1 = token1;
            vaultParams.token0Multiplier = 1n;
            vaultParams.token1Multiplier = 1n;
            await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32));

            const amount0 = 1000n;
            const amount1 = 500n;

            await expect(
                contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                    value: 1000n //Enough for one amount, but not for both
                })
            ).to.be.revertedWith("transferIn: value too low");
        });

        it("Invalid deposit - vault not opened", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2} = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = getRandomSpvVaultParameters();
            vaultParams.token0 = token0;
            vaultParams.token1 = token1;
            vaultParams.token0Multiplier = 1n;
            vaultParams.token1Multiplier = 1n;
            // await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32)); //Skip open vault

            const amount0 = 1000n;
            const amount1 = 500n;

            await expect(
                contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                    value: amount0 + amount1
                })
            ).to.be.revertedWith("spvState: closed");
        });

        it("Invalid deposit - vault got closed", async function() {
            const {contract, getClosedVault} = await loadFixture(deploy);
            
            const {vaultId, owner, spvVaultParams} = await getClosedVault();

            const amount0 = 1000n;
            const amount1 = 500n;

            await expect(
                contract.deposit(owner, vaultId, spvVaultParams, amount0, amount1, {
                    value: amount0 + amount1
                })
            ).to.be.revertedWith("spvState: closed");
        });
    });

    describe("Front", function() {
        
        for(let i=0;i<256;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const thirdPartyFront = (i & 0b10000) !== 0;
            const noToken0 = (i & 0b100000) !== 0;
            const noToken1 = (i & 0b1000000) !== 0;
            const usesExecution = (i & 0b10000000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(noToken0 && noToken1) continue;

            it("Valid front  (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",thirdPartyFront="+thirdPartyFront+",noToken0="+noToken0+",noToken1="+noToken1+",usesExecution="+usesExecution+")", async function() {
                const {
                    contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3, 
                    executionContract,
                    getBalances, getBalance
                } = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const fronter = thirdPartyFront ? account2 : account1;

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = getRandomSpvVaultParameters();
                vaultParams.token0 = token0;
                vaultParams.token1 = token1;
                vaultParams.token0Multiplier = 1n;
                vaultParams.token1Multiplier = 1n;
                const utxoTxHash = randomBytes32();
                const utxoVout = randomUnsignedBigInt(32);
                await contract.open(vaultId, vaultParams, utxoTxHash, utxoVout);

                const amount0 = noToken0 ? 0n : 1000n;
                const amount1 = noToken1 ? 0n : 500n;

                const executionHash = usesExecution ? getExecutionActionHash({
                    calls: [],
                    drainTokens: [],
                    gasLimit: 5000n
                }) : "0x0000000000000000000000000000000000000000000000000000000000000000";

                const btcTxData = {
                    recipient: account3.address,
                    amount0,
                    amount1,
                    callerFee0: 100n,
                    callerFee1: 50n,
                    frontingFee0: 50n,
                    frontingFee1: 25n,
                    executionHandlerFeeAmount0: 10n,
                    executionExpiry: 0n,
                    executionHash: executionHash
                };
                const btcTxHash = randomBytes32();

                const totalDepositAmount0 = (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
                const totalDepositAmount1 = amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).connect(fronter).approve(await contract.getAddress(), totalDepositAmount0);
                } else msgValue += totalDepositAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).connect(fronter).approve(await contract.getAddress(), token0===token1 ? totalDepositAmount0+totalDepositAmount1 : totalDepositAmount1);
                } else msgValue += totalDepositAmount1;

                const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                    {address: fronter.address, tokenAddress: token0},
                    {address: account3.address, tokenAddress: token0},
                    {address: await executionContract.getAddress(), tokenAddress: token0},
                    {address: fronter.address, tokenAddress: token1},
                    {address: account3.address, tokenAddress: token1},
                    {address: await executionContract.getAddress(), tokenAddress: token1}
                ]);

                const tx = await contract.connect(fronter).front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                    value: msgValue
                });

                await expect(
                    tx
                ).to.emit(contract, "Fronted").withArgs(
                    packAddressAndVaultId(account1.address, vaultId),
                    account3.address,
                    btcTxHash,
                    executionHash,
                    amount0,
                    amount1
                );

                //Update balances with the gas fee paid
                if(preBalances[fronter.address]["0x0000000000000000000000000000000000000000"]!=null) {
                    const receipt = await tx.wait();
                    preBalances[fronter.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
                }

                assert.strictEqual(await contract.getFronterAddress(account1.address, vaultId, btcTxHash, btcTxData), fronter.address);
                if(usesExecution) assert.strictEqual(await executionContract.getExecutionCommitmentHash(account3.address, btcTxHash), getExecutionHash({
                    executionActionHash: executionHash,
                    executionFee: btcTxData.executionHandlerFeeAmount0 * vaultParams.token0Multiplier,
                    token: vaultParams.token0,
                    expiry: btcTxData.executionExpiry,
                    amount: btcTxData.amount0 * vaultParams.token0Multiplier
                }));

                preBalances[fronter.address][token0] -= totalDepositAmount0;
                preBalances[fronter.address][token1] -= totalDepositAmount1;
                preBalances[usesExecution ? await executionContract.getAddress() : account3.address][token0] += totalDepositAmount0;
                preBalances[account3.address][token1] += totalDepositAmount1;

                //Assert balances
                for(let address in preBalances) {
                    for(let tokenAddress in preBalances[address]) {
                        assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address), "address: "+address+", token: "+tokenAddress);
                    }
                }

            });
        }
    });

});
