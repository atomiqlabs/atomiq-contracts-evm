import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getEscrowHash, getRandomEscrowData } from "../../utils/evm/escrow_data";

function getEscrowData(flags: bigint, securityDeposit: bigint, claimerBounty: bigint) {
    const escrowData = getRandomEscrowData();
    escrowData.flags = flags;
    escrowData.securityDeposit = securityDeposit;
    escrowData.claimerBounty = claimerBounty;
    return escrowData;
}
        
describe("Escrow", function () {
    async function deploy() {
        const EscrowDataWrapper = await hre.ethers.getContractFactory("EscrowDataWrapper");
        const contract = await EscrowDataWrapper.deploy();

        return {contract};
    }

    it("Parse flags", async function () {
        const {contract} = await loadFixture(deploy);
        {
            const escrowData = getEscrowData(0b000n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), false);
            assert.strictEqual(await contract.isPayIn(escrowData), false);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), false);
        }
        {
            const escrowData = getEscrowData(0b001n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), true);
            assert.strictEqual(await contract.isPayIn(escrowData), false);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), false);
        }
        {
            const escrowData = getEscrowData(0b010n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), false);
            assert.strictEqual(await contract.isPayIn(escrowData), true);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), false);
        }
        {
            const escrowData = getEscrowData(0b011n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), true);
            assert.strictEqual(await contract.isPayIn(escrowData), true);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), false);
        }
        {
            const escrowData = getEscrowData(0b100n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), false);
            assert.strictEqual(await contract.isPayIn(escrowData), false);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), true);
        }
        {
            const escrowData = getEscrowData(0b101n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), true);
            assert.strictEqual(await contract.isPayIn(escrowData), false);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), true);
        }
        {
            const escrowData = getEscrowData(0b110n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), false);
            assert.strictEqual(await contract.isPayIn(escrowData), true);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), true);
        }
        {
            const escrowData = getEscrowData(0b111n, 0n, 0n);
            assert.strictEqual(await contract.isPayOut(escrowData), true);
            assert.strictEqual(await contract.isPayIn(escrowData), true);
            assert.strictEqual(await contract.isTrackingReputation(escrowData), true);
        }
    });

    it("Total deposit calculation", async function () {
        const {contract} = await loadFixture(deploy);

        assert.strictEqual(await contract.getTotalDeposit(getEscrowData(0n, 0n, 0n)), 0n);
        assert.strictEqual(await contract.getTotalDeposit(getEscrowData(0n, 100n, 100n)), 100n);
        assert.strictEqual(await contract.getTotalDeposit(getEscrowData(0n, 150n, 100n)), 150n);
        assert.strictEqual(await contract.getTotalDeposit(getEscrowData(0n, 100n, 150n)), 150n);
    });

    it("Random hash", async function () {
        const {contract} = await loadFixture(deploy);

        for(let i=0;i<10;i++) {
            const escrowData = getRandomEscrowData();
            assert.strictEqual(await contract.hash(escrowData), getEscrowHash(escrowData));
        }
    });

});
