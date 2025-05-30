import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { fromBuffer } from "../../utils/buffer_utils";

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
            const swapHash = "0x"+randomBytes(32).toString("hex");
            const timeout = fromBuffer(randomBytes(32), "be");
            const hash = hre.ethers.TypedDataEncoder.hash(domain, {
                Initialize: [
                    { name: "swapHash", type: "bytes32" },
                    { name: "timeout", type: "uint256" }
                ]
            }, {swapHash, timeout});
            return [swapHash, timeout, hash] as const;
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
            const [swapHash, timeout, result] = getRandomInitTest();
            assert.strictEqual(await contract.EIP712Sighash_getInitSighash(swapHash, timeout), result);
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
