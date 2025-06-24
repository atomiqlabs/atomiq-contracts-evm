import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, assert } from "chai";
import hre from "hardhat";
import {randomBytes} from "crypto";
import { serializeBitcoindBlockheader, serializeBlockheader } from "../../utils/evm/blockheader";
import { getBlockheader, randomBitcoinHeight } from "../../utils/bitcoin_rpc_utils";
import { reverseUint32 } from "../../utils/endianness";

describe("CompactBlockHeader", function () {
    async function deploy() {
        const CompactBlockHeaderWrapper = await hre.ethers.getContractFactory("CompactBlockHeaderWrapper");
        const contract = await CompactBlockHeaderWrapper.deploy();

        return contract;
    }

    it("Valid verify out of bounds", async function () {
        const contract = await loadFixture(deploy);

        await contract.verifyOutOfBounds(randomBytes(48), 0);
    });

    it("Valid verify out of bounds with offset", async function () {
        const contract = await loadFixture(deploy);

        await contract.verifyOutOfBounds(randomBytes(128), 41);
    });

    it("Invalid verify out of bounds", async function () {
        const contract = await loadFixture(deploy);

        await expect(contract.verifyOutOfBounds(randomBytes(48), 14)).to.be.revertedWith("BlockHeader: out of bounds");
    });

    it("Valid read values", async function () {
        const contract = await loadFixture(deploy);
        
        const timestamp = 85727712;
        const nbits = 0x8732bcde;

        assert.equal(await contract.timestamp(serializeBlockheader(85384, randomBytes(32), timestamp, nbits, 763675653), 0), BigInt(timestamp));
        assert.equal(await contract.nBitsLE(serializeBlockheader(85384, randomBytes(32), timestamp, nbits, 763675653), 0), reverseUint32(nbits));
    });

    it("Existing blockheaders", async function () {
        const contract = await loadFixture(deploy);
        
        for(let i=0;i<10;i++) {
            const blockHeader = await getBlockheader(randomBitcoinHeight());

            const randomOffset = Math.floor(Math.random() * 512);
            const serialized = Buffer.concat([
                Buffer.alloc(randomOffset),
                serializeBitcoindBlockheader(blockHeader)
            ]);

            assert.equal(await contract.timestamp(serialized, randomOffset), BigInt(blockHeader.time));
            assert.equal(await contract.nBitsLE(serialized, randomOffset), reverseUint32(blockHeader.bits));
        }
    });
});
