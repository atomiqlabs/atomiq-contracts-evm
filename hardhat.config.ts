import * as dotenv from "dotenv";
dotenv.config();

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

const config: HardhatUserConfig & {networks: {[chainName: string]: {wethAddress: string, transferOutGasForward: number}}} = {
  sourcify: {
    enabled: false
  },
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
  etherscan: {
    apiKey: {
      goatTestnet: "goat",
    },
    customChains: [
      {
        network: "goatTestnet",
        chainId: 48816,
        urls: {
          apiURL: "https://explorer.testnet3.goat.network/api",
          browserURL: "https://explorer.testnet3.goat.network"
        }
      }
    ]
  },
  networks: {
    hardhat: {
      hardfork: "cancun"
    } as any,
    goatTestnet: {
      url: "https://rpc.testnet3.goat.network",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0xbC10000000000000000000000000000000000000",
      transferOutGasForward: 40_000
    }
  },
  gasReporter: {
    enabled: false
  }
};

export default config;
