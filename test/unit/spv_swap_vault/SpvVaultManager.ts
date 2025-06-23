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
import { getValidSpvVaultBtcTx, parseSpvVaultBtcTx } from "./generators/spv_vault_btc_tx";
import { generateMerkleRoot } from "../../utils/merkle_tree";
import { mineBitcoinBlock } from "../../utils/blockchain_utils";
import { serializeBitcoindStoredBlockheaderToStruct } from "../../utils/evm/stored_blockheader";
import { getExecutionHash, getRandomExecution } from "../../utils/evm/execution";
import { BitcoinVaultTransactionData, getBitcoinVaultTransactionDataHash } from "../../utils/evm/bitcoin_vault_transaction_data";
import { Transaction } from "bitcoinjs-lib";

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

        async function assertClosed(
            owner: string, vaultId: bigint, vaultParams: SpvVaultParameters, btcTx: Transaction, 
            blockHeaderStruct: {data: [string, string, string, string, string]}, proof: Buffer[], position: number,
            expectedError: string
        ) {
            const preVaultState = await contract.getVault(owner, vaultId);
            const preBalance = await account1.provider.getBalance(owner);

            await expect(
                contract.connect(account3).claim(
                    owner,
                    vaultId, 
                    vaultParams,
                    btcTx.toBuffer(),
                    blockHeaderStruct,
                    proof,
                    position
                )
            ).to.emit(contract, "Closed").withArgs(
                account1.address, vaultId, btcTx.getHash(), Buffer.from(expectedError)
            );

            //Ensure vault closed
            const vaultState = await contract.getVault(owner, vaultId);
            assert.strictEqual(vaultState.spvVaultParametersCommitment, "0x0000000000000000000000000000000000000000000000000000000000000000");

            //And funds transfered back to the account1
            const postBalance = await account1.provider.getBalance(owner);

            assert.strictEqual(postBalance, preBalance + preVaultState.token0Amount + preVaultState.token1Amount);
        }

        async function getBtcRelayAndProof(btcTx: Transaction): Promise<{
            btcRelayAddress: string,
            blockHeaderStruct: {data: [string, string, string, string, string]},
            proof: Buffer[],
            position: number
        }> {
            const [root, proof, position] = generateMerkleRoot(btcTx.getHash(), 5);

            const genesis = mineBitcoinBlock(randomBytes(32).toString("hex"), 1_500_000_000, "1f7fffff", 1_500_000_000, undefined, undefined, undefined, Buffer.from(root, "hex").reverse().toString("hex"));
            const blockHeaderStruct = serializeBitcoindStoredBlockheaderToStruct(genesis);
            const relayContract = await BtcRelay.deploy(blockHeaderStruct, false);
            
            return {
                btcRelayAddress: await relayContract.getAddress(),
                blockHeaderStruct,
                proof: proof.map(val => Buffer.from(val, "hex")),
                position
            };
        }

        async function getBtcRelayWithTransaction(
            utxoTxHash: string, utxoVout: bigint, recipient: string, amount0: bigint, callerFee: bigint, frontingFee: bigint, executionFee: bigint, amount1?: bigint, executionHash?: string, executionExpiry?: bigint
        ): Promise<{
            vaultTransactionData: BitcoinVaultTransactionData,
            btcTx: Transaction,
            btcRelayAddress: string,
            blockHeaderStruct: {data: [string, string, string, string, string]},
            proof: Buffer[],
            position: number
        }> {
            const btcTx = getValidSpvVaultBtcTx(recipient, amount0, callerFee, frontingFee, executionFee, amount1, executionHash, executionExpiry);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            return {
                vaultTransactionData: parseSpvVaultBtcTx(btcTx),
                btcTx,
                ...await getBtcRelayAndProof(btcTx)
            };
        }

        async function getClosedVault() {
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const {btcTx, btcRelayAddress, blockHeaderStruct, proof, position} = await getBtcRelayWithTransaction(utxoTxHash, utxoVout, account3.address, 1000n, 0n, 0n, 0n);

            const spvVaultParams = getRandomSpvVaultParameters();
            spvVaultParams.btcRelayContract = btcRelayAddress;
            spvVaultParams.confirmations = 1n;
            const vaultId = 0n;

            await contract.open(vaultId, spvVaultParams, utxoTxHash, utxoVout);
            await expect(contract.claim(
                account1.address, vaultId, spvVaultParams, 
                btcTx.toBuffer(), blockHeaderStruct, proof, position
            )).to.emit(contract, "Closed");

            return {
                owner: account1.address,
                vaultId,
                spvVaultParams
            };
        }

        async function openAndDeposit(
            vaultId: bigint, vaultParams: SpvVaultParameters, utxoTxHash: string, utxoVout: bigint, rawAmount0: bigint, rawAmount1: bigint = 0n
        ) {
            await contract.open(vaultId, vaultParams, utxoTxHash, utxoVout);

            const amount0 = rawAmount0 * vaultParams.token0Multiplier;
            const amount1 = rawAmount1 * vaultParams.token0Multiplier;
            
            let msgValue = 0n;
            if(vaultParams.token0 !== "0x0000000000000000000000000000000000000000") {
                await (ERC20.attach(vaultParams.token0) as any).approve(await contract.getAddress(), amount0);
            } else msgValue += amount0;
            
            if(vaultParams.token1 !== "0x0000000000000000000000000000000000000000") {
                await (ERC20.attach(vaultParams.token1) as any).approve(await contract.getAddress(), vaultParams.token0===vaultParams.token1 ? amount0+amount1 : amount1);
            } else msgValue += amount1;

            await contract.deposit(account1.address, vaultId, vaultParams, amount0, amount1, {
                value: msgValue
            });
        }

        async function front(
            fronter: HardhatEthersSigner, owner: string, vaultId: bigint, vaultParams: SpvVaultParameters, vaultTransactionData: BitcoinVaultTransactionData, btcTxHash: Buffer
        ) {
            const amount0 = (vaultTransactionData.amount0 + vaultTransactionData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
            const amount1 = vaultTransactionData.amount1 * vaultParams.token1Multiplier;
            
            let msgValue = 0n;
            if(vaultParams.token0 !== "0x0000000000000000000000000000000000000000") {
                await (ERC20.attach(vaultParams.token0) as any).approve(await contract.getAddress(), amount0);
            } else msgValue += amount0;
            
            if(vaultParams.token1 !== "0x0000000000000000000000000000000000000000") {
                await (ERC20.attach(vaultParams.token1) as any).approve(await contract.getAddress(), vaultParams.token0===vaultParams.token1 ? amount0+amount1 : amount1);
            } else msgValue += amount1;

            await contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, vaultTransactionData, {
                value: msgValue
            });
        }

        return {
            executionContract, ERC20, BtcRelay, contract, account1, account2, account3, erc20Contract1, erc20Contract2, dummyContract,
            getClosedVault, getBalances, getBalance, getBtcRelayWithTransaction, openAndDeposit, front, getBtcRelayAndProof, assertClosed
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
                    1n,
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

            it("Valid front (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",thirdPartyFront="+thirdPartyFront+",noToken0="+noToken0+",noToken1="+noToken1+",usesExecution="+usesExecution+")", async function() {
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
                assert.strictEqual(await contract.getFronterById(account1.address, vaultId, getBitcoinVaultTransactionDataHash(btcTxData, btcTxHash)), fronter.address);
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

            it("Invalid front - not enough balance erc-20 (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughBalance="+token0NotEnoughBalance+",token1NotEnoughBalance="+token1NotEnoughBalance+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
                
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
                    executionHash: randomBytes32()
                };
                const btcTxHash = randomBytes32();

                const totalDepositAmount0 = (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
                const totalDepositAmount1 = amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), totalDepositAmount0);
                } else msgValue += totalDepositAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), token0===token1 ? (totalDepositAmount0 + totalDepositAmount1) : totalDepositAmount1);
                } else msgValue += totalDepositAmount1;

                await expect(
                    contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
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

            it("Invalid front - not enough allowance erc-20 (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughAllowance="+token0NotEnoughAllowance+",token1NotEnoughAllowance="+token1NotEnoughAllowance+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
                
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
                    executionHash: randomBytes32()
                };
                const btcTxHash = randomBytes32();

                const approveAmount0 = token0NotEnoughAllowance ? 1n : (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
                const approveAmount1 = token1NotEnoughAllowance ? 1n : amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), approveAmount0);
                } else msgValue += approveAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), token0===token1 ? (approveAmount0 + approveAmount1) : approveAmount1);
                } else msgValue += approveAmount1;

                await expect(
                    contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
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

            it("Invalid front - not enough msg.value (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",token0NotEnoughMsgValue="+token0NotEnoughMsgValue+",token1NotEnoughMsgValue="+token1NotEnoughMsgValue+")", async function() {
                const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
                
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
                    executionHash: randomBytes32()
                };
                const btcTxHash = randomBytes32();

                const approveAmount0 = token0NotEnoughMsgValue ? 1n : (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
                const approveAmount1 = token1NotEnoughMsgValue ? 1n : amount1 * vaultParams.token1Multiplier;

                let msgValue = 0n;
                if(token0 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token0) as any).approve(await contract.getAddress(), approveAmount0);
                } else msgValue += approveAmount0;
                
                if(token1 !== "0x0000000000000000000000000000000000000000") {
                    await (ERC20.attach(token1) as any).approve(await contract.getAddress(), approveAmount1);
                } else msgValue += approveAmount1;

                await expect(
                    contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                        value: msgValue
                    })
                ).to.be.revertedWith("transferIn: value too low");
            });
        }

        it("Invalid front - msg.value only enough for one deposit", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
            
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
                executionHash: randomBytes32()
            };
            const btcTxHash = randomBytes32();

            await expect(
                contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                    value: 1100n //Enough for one amount, but not for both
                })
            ).to.be.revertedWith("transferIn: value too low");
        });
        
        it("Invalid front - vault not opened", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
            
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
                executionHash: randomBytes32()
            };
            const btcTxHash = randomBytes32();

            const totalDepositAmount0 = (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
            const totalDepositAmount1 = amount1 * vaultParams.token1Multiplier;

            await expect(
                contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                    value: totalDepositAmount0 + totalDepositAmount1
                })
            ).to.be.revertedWith("spvState: closed");
        });
        
        it("Invalid front - vault got closed", async function() {
            const {contract, getClosedVault, account3} = await loadFixture(deploy);
            
            const {vaultId, owner, spvVaultParams} = await getClosedVault();

            const amount0 = 1000n;
            const amount1 = 500n;

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
                executionHash: randomBytes32()
            };
            const btcTxHash = randomBytes32();

            await expect(
                contract.front(owner, vaultId, spvVaultParams, 0n, btcTxHash, btcTxData)
            ).to.be.revertedWith("spvState: closed");
        });
        
        it("Invalid front - already fronted", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
            
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
                executionHash: randomBytes32()
            };
            const btcTxHash = randomBytes32();

            const totalDepositAmount0 = (amount0 + btcTxData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
            const totalDepositAmount1 = amount1 * vaultParams.token1Multiplier;

            await contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                value: totalDepositAmount0 + totalDepositAmount1
            });

            await expect(
                contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                    value: totalDepositAmount0 + totalDepositAmount1
                })
            ).to.be.revertedWith("front: already fronted"); //Try to front again from a different account
        });

        it("Invalid front - already claimed", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3, openAndDeposit, getBtcRelayWithTransaction} = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const amount0 = 1000n;
            const amount1 = 500n;

            const {
                btcTx,
                btcRelayAddress,
                vaultTransactionData,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayWithTransaction(utxoTxHash, utxoVout, account3.address, amount0, 10000n, 5000n, 1000n, amount1, randomBytes32(), 1_000_000_000n);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = getRandomSpvVaultParameters();
            vaultParams.btcRelayContract = btcRelayAddress
            vaultParams.token0 = token0;
            vaultParams.token1 = token1;
            vaultParams.token0Multiplier = 1n;
            vaultParams.token1Multiplier = 1n;
            vaultParams.confirmations = 1n;
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            //Claim
            await contract.claim(account1.address, vaultId, vaultParams, btcTx.toBuffer(), blockHeaderStruct, proof, position);

            const totalDepositAmount0 = (amount0 + vaultTransactionData.executionHandlerFeeAmount0) * vaultParams.token0Multiplier;
            const totalDepositAmount1 = amount1 * vaultParams.token1Multiplier;

            await expect(
                contract.front(account1.address, vaultId, vaultParams, 0n, btcTx.getHash(), vaultTransactionData, {
                    value: totalDepositAmount0 + totalDepositAmount1
                })
            ).to.be.revertedWith("front: already processed");
        });
        
        it("Invalid front - amount0 overflow 64-bits", async function() {
            const {contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3} = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = getRandomSpvVaultParameters();
            vaultParams.token0 = token0;
            vaultParams.token1 = token1;
            vaultParams.token0Multiplier = 1n;
            vaultParams.token1Multiplier = 1n;
            await contract.open(vaultId, vaultParams, randomBytes32(), randomUnsignedBigInt(32));

            const amount0 = 0xfffffffffffffffen;
            const amount1 = 500n;

            const btcTxData = {
                recipient: account3.address,
                amount0,
                amount1,
                callerFee0: 100n,
                callerFee1: 50n,
                frontingFee0: 50n,
                frontingFee1: 25n,
                executionHandlerFeeAmount0: 100000n,
                executionExpiry: 0n,
                executionHash: randomBytes32()
            };
            const btcTxHash = randomBytes32();

            await expect(
                contract.front(account1.address, vaultId, vaultParams, 0n, btcTxHash, btcTxData, {
                    value: 0
                })
            ).to.be.revertedWithPanic(0x11);
        });
    });

    
    describe("Claim", function() {
        
        for(let i=0;i<256;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const thirdPartyClaim = (i & 0b10000) !== 0;
            const noToken0 = (i & 0b100000) !== 0;
            const noToken1 = (i & 0b1000000) !== 0;
            const usesExecution = (i & 0b10000000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(noToken0 && noToken1) continue;

            it("Valid claim (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",thirdPartyFront="+thirdPartyClaim+",noToken0="+noToken0+",noToken1="+noToken1+",usesExecution="+usesExecution+")", async function() {
                const {
                    contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3, 
                    executionContract,
                    getBalances, getBalance, getBtcRelayWithTransaction, openAndDeposit
                } = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const claimer = thirdPartyClaim ? account2 : account3;

                const amount0 = noToken0 ? 0n : 1000n;
                const amount1 = noToken1 ? 0n : 500n;

                const callerFeeShare = 15213n;
                const frontingFeeShare = 6941n;
                const executionFeeShare = 8411n;

                const executionHash = usesExecution ? getExecutionActionHash({
                    calls: [],
                    drainTokens: [],
                    gasLimit: 5000n
                }) : null;

                const utxoTxHash = randomBytes32();
                const utxoVout = randomUnsignedBigInt(32);
                const {
                    btcRelayAddress,
                    vaultTransactionData,
                    btcTx,
                    proof,
                    position,
                    blockHeaderStruct
                } = await getBtcRelayWithTransaction(
                    utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                    executionHash, 1_000_000_000n
                );

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = {
                    btcRelayContract: btcRelayAddress,
                    token0: token0,
                    token1: token1,
                    token0Multiplier: 1n,
                    token1Multiplier: 1n,
                    confirmations: 1n
                };
                await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

                const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                    {address: claimer.address, tokenAddress: token0},
                    {address: account3.address, tokenAddress: token0},
                    {address: await contract.getAddress(), tokenAddress: token0},
                    {address: await executionContract.getAddress(), tokenAddress: token0},
                    {address: claimer.address, tokenAddress: token1},
                    {address: account3.address, tokenAddress: token1},
                    {address: await executionContract.getAddress(), tokenAddress: token1},
                    {address: await contract.getAddress(), tokenAddress: token1},
                ]);
                const preVaultState = await contract.getVault(account1.address, vaultId);

                const tx = await contract.connect(claimer).claim(account1.address, vaultId, vaultParams, btcTx.toBuffer(), blockHeaderStruct, proof, position);

                await expect(
                    tx
                ).to.emit(contract, "Claimed").withArgs(
                    packAddressAndVaultId(account1.address, vaultId),
                    account3.address,
                    btcTx.getHash(),
                    executionHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
                    "0x0000000000000000000000000000000000000000",
                    1n,
                    amount0 + vaultTransactionData.callerFee0 + vaultTransactionData.frontingFee0 + vaultTransactionData.executionHandlerFeeAmount0,
                    amount1 + vaultTransactionData.callerFee1 + vaultTransactionData.frontingFee1
                );
                
                const postVaultState = await contract.getVault(account1.address, vaultId);

                assert.strictEqual(postVaultState.spvVaultParametersCommitment, preVaultState.spvVaultParametersCommitment);
                assert.strictEqual(postVaultState.utxoTxHash, "0x"+btcTx.getHash().toString("hex"));
                assert.strictEqual(postVaultState.utxoVout, 0n);
                assert.strictEqual(postVaultState.openBlockheight, preVaultState.openBlockheight);
                assert.strictEqual(postVaultState.withdrawCount, preVaultState.withdrawCount + 1n);
                assert.strictEqual(postVaultState.depositCount, preVaultState.depositCount);
                assert.strictEqual(postVaultState.token0Amount, preVaultState.token0Amount - amount0 - vaultTransactionData.callerFee0 - vaultTransactionData.frontingFee0 - vaultTransactionData.executionHandlerFeeAmount0);
                assert.strictEqual(postVaultState.token1Amount, preVaultState.token1Amount - amount1 - vaultTransactionData.callerFee1 - vaultTransactionData.frontingFee1);

                //Update balances with the gas fee paid
                if(preBalances[claimer.address]["0x0000000000000000000000000000000000000000"]!=null) {
                    const receipt = await tx.wait();
                    preBalances[claimer.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
                }

                if(usesExecution) assert.strictEqual(await executionContract.getExecutionCommitmentHash(account3.address, btcTx.getHash()), getExecutionHash({
                    executionActionHash: executionHash,
                    executionFee: vaultTransactionData.executionHandlerFeeAmount0 * vaultParams.token0Multiplier,
                    token: vaultParams.token0,
                    expiry: vaultTransactionData.executionExpiry,
                    amount: vaultTransactionData.amount0 * vaultParams.token0Multiplier
                }));

                preBalances[await contract.getAddress()][token0] -= amount0 + vaultTransactionData.callerFee0 + vaultTransactionData.frontingFee0 + vaultTransactionData.executionHandlerFeeAmount0;
                preBalances[await contract.getAddress()][token1] -= amount1 + vaultTransactionData.callerFee1 + vaultTransactionData.frontingFee1;
                preBalances[usesExecution ? await executionContract.getAddress() : account3.address][token0] += amount0 + vaultTransactionData.executionHandlerFeeAmount0;
                preBalances[account3.address][token1] += amount1;
                preBalances[claimer.address][token0] += vaultTransactionData.frontingFee0 + vaultTransactionData.callerFee0;
                preBalances[claimer.address][token1] += vaultTransactionData.frontingFee1 + vaultTransactionData.callerFee1;

                //Assert balances
                for(let address in preBalances) {
                    for(let tokenAddress in preBalances[address]) {
                        assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address), "address: "+address+", token: "+tokenAddress);
                    }
                }

            });
        }

        
        for(let i=0;i<256;i++) {
            const token0Native = (i & 0b0001) !== 0;
            const token1Native = (i & 0b0010) !== 0;
            const token0type = (i & 0b0100) !== 0;
            const token1type = (i & 0b1000) !== 0;
            const thirdPartyClaim = (i & 0b10000) !== 0;
            const noToken0 = (i & 0b100000) !== 0;
            const noToken1 = (i & 0b1000000) !== 0;
            const usesExecution = (i & 0b10000000) !== 0;

            if(token0Native && token0type) continue;
            if(token1Native && token1type) continue;
            if(noToken0 && noToken1) continue;

            it("Valid claim - fronted (token0Native="+token0Native+",token1Native="+token1Native+",token0Type="+token0type+",token1Type="+token1type+",thirdPartyFront="+thirdPartyClaim+",noToken0="+noToken0+",noToken1="+noToken1+",usesExecution="+usesExecution+")", async function() {
                const {
                    contract, erc20Contract1, erc20Contract2, ERC20, account1, account2, account3, 
                    executionContract,
                    getBalances, getBalance, getBtcRelayWithTransaction, openAndDeposit, front
                } = await loadFixture(deploy);
                
                const token0 = token0Native ? "0x0000000000000000000000000000000000000000" : (token0type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());
                const token1 = token1Native ? "0x0000000000000000000000000000000000000000" : (token1type ? await erc20Contract2.getAddress() : await erc20Contract1.getAddress());

                const claimer = thirdPartyClaim ? account2 : account3;
                const fronter = account1;

                const amount0 = noToken0 ? 0n : 1000n;
                const amount1 = noToken1 ? 0n : 500n;

                const callerFeeShare = 15213n;
                const frontingFeeShare = 6941n;
                const executionFeeShare = 8411n;

                const executionHash = usesExecution ? getExecutionActionHash({
                    calls: [],
                    drainTokens: [],
                    gasLimit: 5000n
                }) : null;

                const utxoTxHash = randomBytes32();
                const utxoVout = randomUnsignedBigInt(32);
                const {
                    btcRelayAddress,
                    vaultTransactionData,
                    btcTx,
                    proof,
                    position,
                    blockHeaderStruct
                } = await getBtcRelayWithTransaction(
                    utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                    executionHash, 1_000_000_000n
                );

                const vaultId = randomUnsignedBigInt(96);
                const vaultParams = {
                    btcRelayContract: btcRelayAddress,
                    token0: token0,
                    token1: token1,
                    token0Multiplier: 1n,
                    token1Multiplier: 1n,
                    confirmations: 1n
                };
                await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

                const preVaultState = await contract.getVault(account1.address, vaultId);

                await front(fronter, account1.address, vaultId, vaultParams, vaultTransactionData, btcTx.getHash());

                if(usesExecution) assert.strictEqual(await executionContract.getExecutionCommitmentHash(account3.address, btcTx.getHash()), getExecutionHash({
                    executionActionHash: executionHash,
                    executionFee: vaultTransactionData.executionHandlerFeeAmount0 * vaultParams.token0Multiplier,
                    token: vaultParams.token0,
                    expiry: vaultTransactionData.executionExpiry,
                    amount: vaultTransactionData.amount0 * vaultParams.token0Multiplier
                }));

                const preBalances: {[address: string]: {[tokenAddress: string]: bigint}} = await getBalances([
                    {address: fronter.address, tokenAddress: token0},
                    {address: claimer.address, tokenAddress: token0},
                    {address: account3.address, tokenAddress: token0},
                    {address: await contract.getAddress(), tokenAddress: token0},
                    {address: await executionContract.getAddress(), tokenAddress: token0},
                    {address: fronter.address, tokenAddress: token1},
                    {address: claimer.address, tokenAddress: token1},
                    {address: account3.address, tokenAddress: token1},
                    {address: await executionContract.getAddress(), tokenAddress: token1},
                    {address: await contract.getAddress(), tokenAddress: token1},
                ]);

                const tx = await contract.connect(claimer).claim(account1.address, vaultId, vaultParams, btcTx.toBuffer(), blockHeaderStruct, proof, position);

                await expect(
                    tx
                ).to.emit(contract, "Claimed").withArgs(
                    packAddressAndVaultId(account1.address, vaultId),
                    account3.address,
                    btcTx.getHash(),
                    executionHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
                    fronter.address,
                    1n,
                    amount0 + vaultTransactionData.callerFee0 + vaultTransactionData.frontingFee0 + vaultTransactionData.executionHandlerFeeAmount0,
                    amount1 + vaultTransactionData.callerFee1 + vaultTransactionData.frontingFee1
                );
                
                const postVaultState = await contract.getVault(account1.address, vaultId);

                assert.strictEqual(postVaultState.spvVaultParametersCommitment, preVaultState.spvVaultParametersCommitment);
                assert.strictEqual(postVaultState.utxoTxHash, "0x"+btcTx.getHash().toString("hex"));
                assert.strictEqual(postVaultState.utxoVout, 0n);
                assert.strictEqual(postVaultState.openBlockheight, preVaultState.openBlockheight);
                assert.strictEqual(postVaultState.withdrawCount, preVaultState.withdrawCount + 1n);
                assert.strictEqual(postVaultState.depositCount, preVaultState.depositCount);
                assert.strictEqual(postVaultState.token0Amount, preVaultState.token0Amount - amount0 - vaultTransactionData.callerFee0 - vaultTransactionData.frontingFee0 - vaultTransactionData.executionHandlerFeeAmount0);
                assert.strictEqual(postVaultState.token1Amount, preVaultState.token1Amount - amount1 - vaultTransactionData.callerFee1 - vaultTransactionData.frontingFee1);

                //Update balances with the gas fee paid
                if(preBalances[claimer.address]["0x0000000000000000000000000000000000000000"]!=null) {
                    const receipt = await tx.wait();
                    preBalances[claimer.address]["0x0000000000000000000000000000000000000000"] -= receipt.gasUsed * receipt.gasPrice;
                }

                preBalances[await contract.getAddress()][token0] -= amount0 + vaultTransactionData.callerFee0 + vaultTransactionData.frontingFee0 + vaultTransactionData.executionHandlerFeeAmount0;
                preBalances[await contract.getAddress()][token1] -= amount1 + vaultTransactionData.callerFee1 + vaultTransactionData.frontingFee1;
                preBalances[fronter.address][token0] += amount0 + vaultTransactionData.executionHandlerFeeAmount0 + vaultTransactionData.frontingFee0;
                preBalances[fronter.address][token1] += amount1 + vaultTransactionData.frontingFee1;
                preBalances[claimer.address][token0] += vaultTransactionData.callerFee0;
                preBalances[claimer.address][token1] += vaultTransactionData.callerFee1;

                //Assert balances
                for(let address in preBalances) {
                    for(let tokenAddress in preBalances[address]) {
                        assert.strictEqual(preBalances[address][tokenAddress], await getBalance(tokenAddress, address), "address: "+address+", token: "+tokenAddress);
                    }
                }
            });
        }

        it("Invalid claim - vault not opened", async function() {
            const {
                contract, account1, account3, getBtcRelayWithTransaction, openAndDeposit
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const {
                btcRelayAddress,
                btcTx,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayWithTransaction(
                utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                null, 1_000_000_000n
            );

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            // await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n); //Don't open

            await expect(
                contract.claim(account1.address, vaultId, vaultParams, btcTx.toBuffer(), blockHeaderStruct, proof, position)
            ).to.be.revertedWith("spvState: closed");
        });

        it("Invalid claim - invalid tx confirmations", async function() {
            const {
                contract, account1, account3, getBtcRelayWithTransaction, openAndDeposit
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const {
                btcRelayAddress,
                btcTx,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayWithTransaction(
                utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                null, 1_000_000_000n
            );

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 3n //Require 3 confirmations, but tx only has 1
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n); //Don't open

            await expect(
                contract.claim(account1.address, vaultId, vaultParams, btcTx.toBuffer(), blockHeaderStruct, proof, position)
            ).to.be.revertedWith("claim: confirmations");
        });

        it("Invalid claim - invalid merkle proof", async function() {
            const {
                contract, account1, account3, getBtcRelayWithTransaction, openAndDeposit
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const {
                btcRelayAddress,
                btcTx,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayWithTransaction(
                utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                null, 1_000_000_000n
            );

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await expect(
                contract.claim(
                    account1.address,
                    vaultId, 
                    vaultParams,
                    btcTx.toBuffer(),
                    blockHeaderStruct,
                    proof.map(() => randomBytes(32)), //Use random merkle proof
                    position
                )
            ).to.be.revertedWith("merkleTree: verify failed");
        });

        it("Invalid claim - invalid merkle proof (position)", async function() {
            const {
                contract, account1, account3, getBtcRelayWithTransaction, openAndDeposit
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const {
                btcRelayAddress,
                btcTx,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayWithTransaction(
                utxoTxHash, utxoVout, account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1,
                null, 1_000_000_000n
            );

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await expect(
                contract.claim(
                    account1.address,
                    vaultId, 
                    vaultParams,
                    btcTx.toBuffer(),
                    blockHeaderStruct,
                    proof,
                    position ^ 0b01101001011101 //Use XORed position
                )
            ).to.be.revertedWith("merkleTree: verify failed");
        });
        
        it("Invalid claim - btc tx empty inputs", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);
            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1);

            //Remove all inputs
            btcTx.ins.splice(0, btcTx.ins.length);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await expect(
                contract.claim(
                    account1.address,
                    vaultId, 
                    vaultParams,
                    btcTx.toBuffer(),
                    blockHeaderStruct,
                    proof,
                    position
                )
            ).to.be.revertedWith("btcTx: Input not found");
        });
        
        it("Invalid claim - btc tx empty inputs", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof
            } = await loadFixture(deploy);
            
            const token0 = "0x0000000000000000000000000000000000000000";
            const token1 = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 500n;

            const callerFeeShare = 15213n;
            const frontingFeeShare = 6941n;
            const executionFeeShare = 8411n;

            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            //This uses random utxo as input 0 already
            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, callerFeeShare, frontingFeeShare, executionFeeShare, amount1);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token0,
                token1: token1,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await expect(
                contract.claim(
                    account1.address,
                    vaultId, 
                    vaultParams,
                    btcTx.toBuffer(),
                    blockHeaderStruct,
                    proof,
                    position
                )
            ).to.be.revertedWith("claim: incorrect in_0 utxo");
        });
        
        it("Invalid claim (vault close) - output 1 not found", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            //Transaction with just 1 output
            btcTx.outs.splice(1, btcTx.outs.length-1);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: output count <2");
        });
        
        it("Invalid claim (vault close) - input 1 not found", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            //Transaction with just 1 input
            btcTx.ins.splice(1, btcTx.ins.length-1);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: input count <2");
        });
        
        it("Invalid claim (vault close) - output 1 empty script", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            btcTx.outs[1].script = Buffer.alloc(0); //Empty output 1

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: output 1 empty script");
        });
        
        it("Invalid claim (vault close) - output 1 not OP_RETURN", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            btcTx.outs[1].script = Buffer.from([0x21]); //Use different op code (OP_RETURN is 0x6a)

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: output 1 not OP_RETURN");
        });
        
        it("Invalid claim (vault close) - output 1 invalid len", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            btcTx.outs[1].script = Buffer.from([0x6a, 0x20, ...randomBytes(32)]); //Use 32-byte long OP_RETURN data, which should be invalid length

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: output 1 invalid len");
        });
        
        it("Invalid claim (vault close) - caller fee 0 overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 0xffffffffffffffffn; //Amount is the highest 64-bit value
            const amount1 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const callerFee = 200_000n; //200% of the amount should result in an overflow

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, callerFee, 0n, 0n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: caller fee 0");
        });

        it("Invalid claim (vault close) - fronting fee 0 overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 0xffffffffffffffffn; //Amount is the highest 64-bit value
            const amount1 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const frontingFee = 200_000n; //200% of the amount should result in an overflow

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 0n, frontingFee, 0n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: fronting fee 0");
        });
        
        it("Invalid claim (vault close) - execution fee 0 overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 0xffffffffffffffffn; //Amount is the highest 64-bit value
            const amount1 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const executionFee = 200_000n; //200% of the amount should result in an overflow

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 0n, 0n, executionFee, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: execution fee 0");
        });
        
        it("Invalid claim (vault close) - caller fee 1 overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 100n;
            const amount1 = 0xffffffffffffffffn; //Amount is the highest 64-bit value
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const callerFee = 200_000n; //200% of the amount should result in an overflow

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, callerFee, 0n, 0n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: caller fee 1");
        });

        it("Invalid claim (vault close) - fronting fee 1 overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 100n;
            const amount1 = 0xffffffffffffffffn; //Amount is the highest 64-bit value
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const frontingFee = 200_000n; //200% of the amount should result in an overflow

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 0n, frontingFee, 0n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "txData: fronting fee 1");
        });

        it("Invalid claim (vault close) - amount 0 sum overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 0xffffffffffffffffn;
            const amount1 = 1000n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 100_000n, 100_000n, 100_000n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "claim: full amounts");
        });

        it("Invalid claim (vault close) - amount 1 sum overflow", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 1000n;
            const amount1 = 0xffffffffffffffffn;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 100_000n, 100_000n, 100_000n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "claim: full amounts");
        });

        it("Invalid claim (vault close) - withdraw too much token0", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 5000n; //If we add fees to the amount, the total will be >10_000n
            const amount1 = 100n;
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 100_000n, 100_000n, 100_000n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "withdraw: amount 0");
        });

        it("Invalid claim (vault close) - withdraw too much token1", async function() {
            const {
                contract, account1, account3, openAndDeposit, getBtcRelayAndProof, assertClosed
            } = await loadFixture(deploy);
            
            const token = "0x0000000000000000000000000000000000000000";

            const amount0 = 100n;
            const amount1 = 5000n; //If we add fees to the amount, the total will be >10_000n
            const utxoTxHash = randomBytes32();
            const utxoVout = randomUnsignedBigInt(32);

            const btcTx = getValidSpvVaultBtcTx(account3.address, amount0, 100_000n, 100_000n, 100_000n, amount1);
            btcTx.ins[0].hash = Buffer.from(utxoTxHash.substring(2), "hex");
            btcTx.ins[0].index = Number(utxoVout);

            const {
                btcRelayAddress,
                proof,
                position,
                blockHeaderStruct
            } = await getBtcRelayAndProof(btcTx);

            const vaultId = randomUnsignedBigInt(96);
            const vaultParams = {
                btcRelayContract: btcRelayAddress,
                token0: token,
                token1: token,
                token0Multiplier: 1n,
                token1Multiplier: 1n,
                confirmations: 1n
            };
            await openAndDeposit(vaultId, vaultParams, utxoTxHash, utxoVout, 10_000n, 10_000n);

            await assertClosed(account1.address, vaultId, vaultParams, btcTx, blockHeaderStruct, proof, position, "withdraw: amount 1");
        });
    });

});
