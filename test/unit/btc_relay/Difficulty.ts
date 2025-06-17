import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { serializeBitcoindBlockheader, serializeBlockheader } from "../../utils/evm/blockheader";
import { getBlockheader, randomBitcoinEpoch, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { reverseUint32 } from "../../utils/endianness";
import { generateComputeNewTargetTest, generateGetChainworkRandomTest, generateGetChainworkTest } from "./generators/difficulty";
import { nbitsToTarget, targetTonBits } from "../../utils/nbits";

describe("Difficulty", function () {
    async function deploy() {
        const DifficultyWrapper = await hre.ethers.getContractFactory("DifficultyWrapper");
        const contract = await DifficultyWrapper.deploy();

        return contract;
    }

    it("Get chainwork random data", async function() {
        const contract = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            const result = await generateGetChainworkRandomTest();
            assert.strictEqual(await contract.getChainWork(result.target), result.chainwork);
        }
    });

    it("Compute new target real adjustments", async function() {
        const contract = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            const epoch = randomBitcoinEpoch()
            const result = await generateComputeNewTargetTest(epoch);
            // const normalResult = await contract._computeNewTarget(result.timestampEnd, result.timestampStart, result.oldTarget);
            // assert.strictEqual(targetTonBits(normalResult[0]), result.newNbits);
            const altResult = await contract.computeNewTarget(result.timestampEnd, result.timestampStart, reverseUint32(result.oldNbits), true);
            assert.strictEqual(altResult[1], reverseUint32(result.newNbits));
            assert.strictEqual(altResult[0], nbitsToTarget(result.newNbits));
        }
    });

    it("Get chainwork real data", async function() {
        const contract = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            const result = await generateGetChainworkTest(randomBitcoinHeight());
            assert.strictEqual(await contract.getChainWork(result.target), result.chainwork);
        }
    });

});
