import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { assert } from "chai";
import hre from "hardhat";
import { getSpvVaultBtcTx, getValidSpvVaultBtcTx } from "./generators/spv_vault_btc_tx";
import { randomAddress, randomBytes32 } from "../../utils/evm/utils";
import { Transaction } from "bitcoinjs-lib";
import { toBuffer } from "../../utils/buffer_utils";
import { getSpvVaultParametersHash } from "../../utils/evm/spv_vault_parameters";
import { randomUnsignedBigInt } from "../../utils/random";

describe("Utils", function () {
    async function deploy() {
        const UtilsWrapper = await hre.ethers.getContractFactory("UtilsWrapper");
        const contract = await UtilsWrapper.deploy();

        return {contract};
    }

    it("Valid pack address and vault id", async function () {
        const {contract} = await loadFixture(deploy);

        const address = randomAddress();
        const vaultId = randomUnsignedBigInt(96);
        const result = await contract.packAddressAndVaultId(address, vaultId);
        
        assert.strictEqual(result, "0x"+Buffer.concat([
            Buffer.from(address.substring(2), "hex"),
            toBuffer(vaultId, 12, "be")
        ]).toString("hex"));
    });
});
