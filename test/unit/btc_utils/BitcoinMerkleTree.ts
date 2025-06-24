import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { generateMerkleTreeRandomTest, generateMerkleTreeRealRandomTest } from "../../generators/btc_utils/merkle_tree";

describe("BitcoinMerkleTree", function () {
    async function deploy() {
        const BitcoinMerkleTree = await hre.ethers.getContractFactory("BitcoinMerkleTreeWrapper");
        const contract = await BitcoinMerkleTree.deploy();

        return contract;
    }

    it("Randomly generated tests", async function () {
        const contract = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            const [root, value, proof, position] = generateMerkleTreeRandomTest();
            await contract.verify("0x"+root, "0x"+value, proof.map(val => "0x"+val), position);
        }
    });

    it("Real data tests", async function () {
        const contract = await loadFixture(deploy);
        for(let i=0;i<10;i++) {
            const [root, value, proof, position] = await generateMerkleTreeRealRandomTest();
            await contract.verify("0x"+root, "0x"+value, proof.map(val => "0x"+val), position);
        }
    });

});
