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
      citreaTestnet: "citrea",
      citreaMainnet: "citrea",
      botanixMainnet: "botanix",
      goatTestnet: "goat",
      alpenTestnet: "alpen",
    },
    customChains: [
      {
        network: "citreaTestnet",
        chainId: 5115,
        urls: {
          apiURL: "https://explorer.testnet.citrea.xyz/api",
          browserURL: "https://explorer.testnet.citrea.xyz/"
        }
      },
      {
        network: "citreaMainnet",
        chainId: 4114,
        urls: {
          apiURL: "https://explorer.mainnet.citrea.xyz/api",
          browserURL: "https://explorer.mainnet.citrea.xyz/"
        }
      },
      {
        network: "botanixMainnet",
        chainId: 3637,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan",
          browserURL: "https://botanixscan.io"
        }
      },
      {
        network: "goatTestnet",
        chainId: 48816,
        urls: {
          apiURL: "https://explorer.testnet3.goat.network/api",
          browserURL: "https://explorer.testnet3.goat.network"
        }
      },
      {
        network: "alpenTestnet",
        chainId: 8150,
        urls: {
          apiURL: "https://explorer.testnet.alpenlabs.io/api",
          browserURL: "https://explorer.testnet.alpenlabs.io/"
        }
      }
    ]
  },
  networks: {
    hardhat: {
      hardfork: "cancun"
    } as any,
    citreaTestnet: {
      url: "https://rpc.testnet.citrea.xyz",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0x3100000000000000000000000000000000000006",
      transferOutGasForward: 40_000
    },
    citreaMainnet: {
      url: "https://rpc.mainnet.citrea.xyz",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0x3100000000000000000000000000000000000006",
      transferOutGasForward: 40_000
    },
    botanixTestnet: {
      url: "https://node.botanixlabs.dev",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0x0D2437F93Fed6EA64Ef01cCde385FB1263910C56",
      transferOutGasForward: 40_000
    },
    botanixMainnet: {
      url: "https://rpc.botanixlabs.com",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0x0D2437F93Fed6EA64Ef01cCde385FB1263910C56",
      transferOutGasForward: 40_000
    },
    goatTestnet: {
      url: "https://rpc.testnet3.goat.network",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0xbC10000000000000000000000000000000000000",
      transferOutGasForward: 40_000
    },
    alpenTestnet: {
      url: "https://rpc.testnet.alpenlabs.io",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      wethAddress: "0x790BE3d1FacC9c5499094a6f9F69aad2b9E04684",
      transferOutGasForward: 40_000
    }
  },
  gasReporter: {
    enabled: false
  }
};

export default config;
