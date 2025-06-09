import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { fromBuffer } from "../../utils/buffer_utils";
import { getEscrowHash, getRandomEscrowData } from "../../utils/evm/escrow_data";

describe("EIP712Sighash", function () {
    async function deploy() {
        const EIP712SighashWrapper = await hre.ethers.getContractFactory("EIP712SighashWrapper");
        const contract = await EIP712SighashWrapper.deploy();

        const domain = {
            name: "atomiq.exchange",
            version: "1",
            chainId: (await contract.runner.provider.getNetwork()).chainId,
            verifyingContract: await contract.getAddress()
        };

        function getRandomInitTest() {
            const escrow = getRandomEscrowData();
            const swapHash = getEscrowHash(escrow);
            const timeout = fromBuffer(randomBytes(32), "be");
            const hash = hre.ethers.TypedDataEncoder.hash(domain, {
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
                    { name: "deadline", type: "uint256" }
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
                deadline: timeout
            });
            return [escrow, swapHash, timeout, hash] as const;
        }

        function getRandomRefundTest() {
            const swapHash = "0x"+randomBytes(32).toString("hex");
            const timeout = fromBuffer(randomBytes(32), "be");
            const hash = hre.ethers.TypedDataEncoder.hash(domain, {
                Refund: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout});
            return [swapHash, timeout, hash] as const;
        }

        return {contract, getRandomInitTest, getRandomRefundTest};
    }

    it("Random valid init", async function () {
        const {contract, getRandomInitTest} = await loadFixture(deploy);
        for(let i=0;i<100;i++) {
            const [escrow, swapHash, timeout, result] = getRandomInitTest();
            assert.strictEqual(await contract.EIP712Sighash_getInitSighash(escrow, swapHash, timeout), result);
        }
    });

    it("Random valid refund", async function () {
        const {contract, getRandomRefundTest} = await loadFixture(deploy);
        for(let i=0;i<100;i++) {
            const [swapHash, timeout, result] = getRandomRefundTest();
            assert.strictEqual(await contract.EIP712Sighash_getRefundSighash(swapHash, timeout), result);
        }
    });
});
