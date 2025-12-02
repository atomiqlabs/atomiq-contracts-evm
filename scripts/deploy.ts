import { ethers, network, run } from "hardhat";
import { getBlockchainInfo, getBlockheader } from "../test/utils/bitcoin_rpc_utils";
import { serializeBitcoindStoredBlockheaderToStruct } from "../test/utils/evm/stored_blockheader";

// Check if Etherscan/Blockscout verification is available for the current network
function isEtherscanConfigured(): boolean {
    try {
        const hre = require("hardhat");
        const currentNetwork = network.name;
        const etherscanConfig = hre.config?.etherscan;
        if (!etherscanConfig) {
            return false;
        }
        const hasCustomChain = etherscanConfig.customChains?.some(
            (chain: any) => chain.network === currentNetwork
        );
        const hasApiKey = etherscanConfig.apiKey && etherscanConfig.apiKey[currentNetwork];

        // Verification is available if either custom chain is configured or API key exists
        return hasCustomChain || hasApiKey;
    } catch (error) {
        console.log(`⚠️  Error checking Etherscan configuration: ${error}`);
        return false;
    }
}

// Helper function to verify contract on block explorer
async function verifyContract(address: string, constructorArguments: any[]) {
    if (!isEtherscanConfigured()) {
        console.log(`⊘ Skipping verification (block explorer not configured for ${network.name})`);
        return;
    }

    console.log(`Verifying contract at ${address}...`);
    try {
        await run("verify:verify", {
            address: address,
            constructorArguments: constructorArguments,
        });
        console.log(`✓ Contract verified successfully!`);
    } catch (error: any) {
        if (error.message.toLowerCase().includes("already verified")) {
            console.log(`✓ Contract already verified!`);
        } else {
            console.log(`✗ Verification failed: ${error.message}`);
        }
    }
}

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
    const wethContract: string = (network.config as any).wethAddress;
    const transferOutGasForward: number = (network.config as any).transferOutGasForward;
    if(wethContract==null || transferOutGasForward==null) throw new Error("wethContract & transferOutGasForward need to be specified for a chain!");
    if(typeof(wethContract)!=="string" || !ethers.isAddress(wethContract)) throw new Error("wethContract invalid address!");
    if(typeof(transferOutGasForward)!=="number" || transferOutGasForward < 2100) throw new Error("transferOutGasForward invalid value, must be at least 2100!");
    
    const testnet = process.env.BITCOIN_NETWORK==="TESTNET" || process.env.BITCOIN_NETWORK==="REGTEST";
    if(testnet) {
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("!!! Deploying BTC relay in TESTNET MODE !!!");
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    }

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
    const btcRelayConstructorArgs = [
        serializeBitcoindStoredBlockheaderToStruct({
            ...block,
            previousBlockTimestamps,
            epochstart: (await getBlockheader(2016*Math.floor(block.height/2016))).time
        }), 
        !testnet
    ];
    const btcRelayContract = await BtcRelay.deploy(...btcRelayConstructorArgs);
    await btcRelayContract.waitForDeployment();
    const btcRelayAddress = await btcRelayContract.getAddress();
    console.log("\n--- BtcRelay")
    console.log(`Contract address: ${btcRelayAddress}`);
    console.log(`Genesis height: ${(await ethers.provider.getTransactionReceipt(btcRelayContract.deploymentTransaction().hash)).blockNumber}`);

    //Deploy execution contract
    console.log("\n- Deploying execution contract");
    const ExecutionContract = await ethers.getContractFactory("ExecutionContract");
    const executionConstructorArgs = [wethContract, transferOutGasForward];
    const executionContract = await ExecutionContract.deploy(...executionConstructorArgs);
    await executionContract.waitForDeployment();
    const executionAddress = await executionContract.getAddress();
    console.log("\n--- ExecutionContract")
    console.log(`Contract address: ${executionAddress}`);
    console.log(`Genesis height: ${(await ethers.provider.getTransactionReceipt(executionContract.deploymentTransaction().hash)).blockNumber}`);

    //Deploy spv vault manager
    console.log("\n- Deploying spv vault manager");
    const SpvVaultManager = await ethers.getContractFactory("SpvVaultManager");
    const spvVaultConstructorArgs = [executionAddress, wethContract, transferOutGasForward];
    const spvVaultManager = await SpvVaultManager.deploy(...spvVaultConstructorArgs);
    await spvVaultManager.waitForDeployment();
    const spvVaultAddress = await spvVaultManager.getAddress();
    console.log("\n--- SpvVaultManager")
    console.log(`Contract address: ${spvVaultAddress}`);
    console.log(`Genesis height: ${(await ethers.provider.getTransactionReceipt(spvVaultManager.deploymentTransaction().hash)).blockNumber}`);

    //Deploy spv vault manager
    console.log("\n- Deploying escrow manager");
    const EscrowManager = await ethers.getContractFactory("EscrowManager");
    const escrowConstructorArgs = [wethContract, transferOutGasForward];
    const escrowManager = await EscrowManager.deploy(...escrowConstructorArgs);
    await escrowManager.waitForDeployment();
    const escrowAddress = await escrowManager.getAddress();
    console.log("\n--- EscrowManager")
    console.log(`Contract address: ${escrowAddress}`);
    console.log(`Genesis height: ${(await ethers.provider.getTransactionReceipt(escrowManager.deploymentTransaction().hash)).blockNumber}`);

    console.log("\n- Deploying claim handlers");
    const claimHandlerAddresses: {[key: string]: string} = {};
    for(let handler of claimHandlers) {
        const ClaimHandler = await ethers.getContractFactory(handler);
        const claimHandler = await ClaimHandler.deploy();
        await claimHandler.waitForDeployment();
        const handlerAddress = await claimHandler.getAddress();
        claimHandlerAddresses[handler] = handlerAddress;
        console.log("\n--- "+handler)
        console.log(`Contract address: ${handlerAddress}`);
    }

    console.log("\n- Deploying refund handlers");
    const refundHandlerAddresses: {[key: string]: string} = {};
    for(let handler of refundHandlers) {
        const RefundHandler = await ethers.getContractFactory(handler);
        const refundHandler = await RefundHandler.deploy();
        await refundHandler.waitForDeployment();
        const handlerAddress = await refundHandler.getAddress();
        refundHandlerAddresses[handler] = handlerAddress;
        console.log("\n--- "+handler)
        console.log(`Contract address: ${handlerAddress}`);
    }

    // Verify all contracts
    console.log("\n\n========================================");
    console.log("Starting contract verification...");
    console.log("========================================\n");

    if (!isEtherscanConfigured()) {
        console.log(`⊘ Block explorer verification is not configured for network: ${network.name}`);
        console.log(`⊘ Skipping all verification steps...`);
    } else {
        // Wait a bit for the contracts to be indexed by the block explorer
        console.log("Waiting 30 seconds for contracts to be indexed...");
        await new Promise(resolve => setTimeout(resolve, 30000));
    }

    console.log("\n- Verifying BtcRelay");
    await verifyContract(btcRelayAddress, btcRelayConstructorArgs);

    console.log("\n- Verifying ExecutionContract");
    await verifyContract(executionAddress, executionConstructorArgs);

    console.log("\n- Verifying SpvVaultManager");
    await verifyContract(spvVaultAddress, spvVaultConstructorArgs);

    console.log("\n- Verifying EscrowManager");
    await verifyContract(escrowAddress, escrowConstructorArgs);

    console.log("\n- Verifying claim handlers");
    for(let handler of claimHandlers) {
        console.log(`\n- Verifying ${handler}`);
        await verifyContract(claimHandlerAddresses[handler], []);
    }

    console.log("\n- Verifying refund handlers");
    for(let handler of refundHandlers) {
        console.log(`\n- Verifying ${handler}`);
        await verifyContract(refundHandlerAddresses[handler], []);
    }

    console.log("\n\n========================================");
    console.log("Deployment and verification complete!");
    console.log("========================================");
    console.log("\nDeployed contract addresses:");
    console.log(`BtcRelay: ${btcRelayAddress}`);
    console.log(`ExecutionContract: ${executionAddress}`);
    console.log(`SpvVaultManager: ${spvVaultAddress}`);
    console.log(`EscrowManager: ${escrowAddress}`);
    console.log("\nClaim Handlers:");
    for(let handler of claimHandlers) {
        console.log(`  ${handler}: ${claimHandlerAddresses[handler]}`);
    }
    console.log("\nRefund Handlers:");
    for(let handler of refundHandlers) {
        console.log(`  ${handler}: ${refundHandlerAddresses[handler]}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});