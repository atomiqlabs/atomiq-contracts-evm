import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";
import { randomBytes32 } from "../../utils/evm/utils";

describe("HashlockClaimHandler", function () {
    async function deploy() {
        const HashlockClaimHandler = await hre.ethers.getContractFactory("HashlockClaimHandler");
        const contract = await HashlockClaimHandler.deploy();

        return {contract};
    }

    it("Valid witness", async function () {
        const {contract} = await loadFixture(deploy);

        const preimage = "0x3e034aa6ed661aff4841fcc4d6b5dac8f7985f5208655334429cc18de49d3244";
        const hash = "0x00e8912f52e9a58074af5bf7821fd0d63e96300845c31d1d830ac9e0ae973f06";

        assert.strictEqual(await contract.claim(hash, preimage), preimage);
    });

    it("Invalid witness with more than 32 bytes", async function () {
        const {contract} = await loadFixture(deploy);

        let preimage = "0x3e034aa6ed661aff4841fcc4d6b5dac8f7985f5208655334429cc18de49d3244099b8c76d6a6e76d6e";
        const hash = "0x60210b8f24f606dd9bd7192e4189b6d8d3ef9837613ca8e81008536447fb605c";

        await expect(contract.claim(hash, preimage)).to.be.revertedWith("hashlock: Invalid witness len");
    });

    it("Invalid witness", async function () {
        const {contract} = await loadFixture(deploy);

        let preimage = "0x5391edba7315699306b214ea8463ea4c063056dddf16277b0dd1183f9ce41b11";
        const hash = "0x00e8912f52e9a58074af5bf7821fd0d63e96300845c31d1d830ac9e0ae973f06";

        await expect(contract.claim(hash, preimage)).to.be.revertedWith("hashlock: Invalid witness");
    });

    it("Random valid witnesses", async function () {
        const {contract} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const preimage = randomBytes32();
            const hash = hre.ethers.sha256(preimage);

            assert.strictEqual(await contract.claim(hash, preimage), preimage);
        }
    });

});
