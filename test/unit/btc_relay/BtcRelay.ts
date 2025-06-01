import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { serializeBitcoindBlockheader, serializeBlockheader } from "../../utils/evm/blockheader";
import { BitcoindBlockheader, getBlockheader, randomBitcoinEpoch, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { reverseUint32 } from "../../utils/endianness";
import { generateComputeNewTargetTest, generateGetChainworkRandomTest, generateGetChainworkTest } from "./generators/difficulty";
import { nbitsToTarget, targetTonBits } from "../../utils/nbits";
import type {BtcRelay} from "../../../typechain-types/contracts/btc_relay/BtcRelay.sol/BtcRelay";
import { serializeBitcoindStoredBlockheader } from "../../utils/evm/stored_blockheader";

describe("BtcRelay", function () {
    async function deploy() {
        const BtcRelay = await hre.ethers.getContractFactory("BtcRelay");

        async function submitMainAndAssert(contract: BtcRelay, headers: (BitcoindBlockheader & {epochstart: number, previousBlockTimestamps: number[]})[]) {
            await contract.submitMainBlockheaders(Buffer.concat([
                serializeBitcoindStoredBlockheader(headers[0]),
                ...headers.slice(1).map(header => serializeBitcoindBlockheader(header))
            ]));

            //Make sure all events are emitted
            
        }

        return {BtcRelay};
    }

    it("Valid main chain", async function() {
        const {BtcRelay} = await loadFixture(deploy);

        const contract = await BtcRelay.deploy(true);

        for(let i=0;i<10;i++) {
            const result = await generateGetChainworkRandomTest();
            assert.strictEqual(await contract.getChainWork(result.target), result.chainwork);
        }
    });

});
