import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";

function getEscrowData(flags: bigint, securityDeposit: bigint, claimerBounty: bigint) {
    return {
        offerer: "0x0000000000000000000000000000000000000000",
        claimer: "0x0000000000000000000000000000000000000000",
        token: "0x0000000000000000000000000000000000000000",
        refundHandler: "0x0000000000000000000000000000000000000000",
        claimHandler: "0x0000000000000000000000000000000000000000",
        flags,
        claimData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        refundData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        amount: 0n,
        depositToken: "0x0000000000000000000000000000000000000000",
        securityDeposit,
        claimerBounty
    };
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

});
