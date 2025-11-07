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
      botanixMainnet: "botanix"
    },
    customChains: [
      {
        network: "botanixMainnet",
        chainId: 3637,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/3637/etherscan",
          browserURL: "https://botanixscan.io"
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
    }
  },
  gasReporter: {
    enabled: false
  }
};

export default config;
