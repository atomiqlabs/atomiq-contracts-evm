import { ethers } from "hardhat";
import { getBlockchainInfo, getBlockheader } from "../test/utils/bitcoin_rpc_utils";
import { serializeBitcoindStoredBlockheaderToStruct } from "../test/utils/evm/stored_blockheader";


const claimHandlers = [
    "HashlockClaimHandler",
    "BitcoinTxIdClaimHandler",
    "BitcoinOutputClaimHandler",
    "BitcoinNoncedOutputClaimHandler"
];

const refundHandlers = [
    "TimelockRefundHandler"
];

async function main() {
    const testnet = process.env.BITCOIN_NETWORK==="TESTNET" || process.env.BITCOIN_NETWORK==="REGTEST";
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.log("!!! Deploying BTC relay in TESTNET MODE !!!");
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

    const blockchainInfo = await getBlockchainInfo();
    const finalizedHeight = Math.max(0, blockchainInfo.headers - 500);

    //Deploy light client btc relay
    console.log("\n- Deploying btc relay light client with height "+finalizedHeight);
    const block = await getBlockheader(finalizedHeight);
    const previousBlockTimestamps = [];
    for(let i=block.height-10;i<block.height;i++) {
        previousBlockTimestamps.push((await getBlockheader(i<0 ? 0 : i)).time);
    }
    const BtcRelay = await ethers.getContractFactory(testnet ? "BtcRelayTestnet" : "BtcRelay");
    const btcRelayContract = await BtcRelay.deploy(serializeBitcoindStoredBlockheaderToStruct({
        ...block,
        previousBlockTimestamps,
        epochstart: (await getBlockheader(2016*Math.floor(block.height/2016))).time
    }), !testnet);
    await btcRelayContract.waitForDeployment();
    console.log("\n--- BtcRelay")
    console.log(`Contract address: ${await btcRelayContract.getAddress()}`);
    return;

    //Deploy execution contract
    console.log("\n- Deploying execution contract");
    const ExecutionContract = await ethers.getContractFactory("ExecutionContract");
    const executionContract = await ExecutionContract.deploy();
    await executionContract.waitForDeployment();
    console.log("\n--- ExecutionContract")
    console.log(`Contract address: ${await executionContract.getAddress()}`);

    //Deploy spv vault manager
    console.log("\n- Deploying spv vault manager");
    const SpvVaultManager = await ethers.getContractFactory("SpvVaultManager");
    const spvVaultManager = await SpvVaultManager.deploy(await executionContract.getAddress());
    await spvVaultManager.waitForDeployment();
    console.log("\n--- SpvVaultManager")
    console.log(`Contract address: ${await spvVaultManager.getAddress()}`);

    //Deploy spv vault manager
    console.log("\n- Deploying escrow manager");
    const EscrowManager = await ethers.getContractFactory("EscrowManager");
    const escrowManager = await EscrowManager.deploy();
    await escrowManager.waitForDeployment();
    console.log("\n--- EscrowManager")
    console.log(`Contract address: ${await escrowManager.getAddress()}`);

    console.log("\n- Deploying claim handlers");
    for(let handler of claimHandlers) {
        const ClaimHandler = await ethers.getContractFactory(handler);
        const claimHandler = await ClaimHandler.deploy();
        await claimHandler.waitForDeployment();
        console.log("\n--- "+handler)
        console.log(`Contract address: ${await claimHandler.getAddress()}`);
    }

    console.log("\n- Deploying refund handlers");
    for(let handler of refundHandlers) {
        const RefundHandler = await ethers.getContractFactory(handler);
        const refundHandler = await RefundHandler.deploy();
        await refundHandler.waitForDeployment();
        console.log("\n--- "+handler)
        console.log(`Contract address: ${await refundHandler.getAddress()}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});