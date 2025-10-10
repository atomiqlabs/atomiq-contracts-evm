import * as dotenv from "dotenv";
dotenv.config();

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.29",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 1000000
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      hardfork: "cancun"
    },
    citreaTestnet: {
      url: "https://rpc.testnet.citrea.xyz",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY]
    },
    botanixTestnet: {
      url: "https://node.botanixlabs.dev",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY]
    },
    botanixMainnet: {
      url: "https://rpc.botanixlabs.com",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY]
    }
  },
  gasReporter: {
    enabled: false
  }
};

export default config;
