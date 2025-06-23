import hre from "hardhat";

export type BitcoinVaultTransactionData = {
    recipient: string,
    amount0: bigint,
    amount1: bigint,
    callerFee0: bigint,
    callerFee1: bigint,
    frontingFee0: bigint,
    frontingFee1: bigint,
    executionHandlerFeeAmount0: bigint,
    executionHash: string,
    executionExpiry: bigint
};

export function getBitcoinVaultTransactionDataHash(struct: BitcoinVaultTransactionData, btcTxHash: string) {
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address recipient, uint64 amount0, uint64 amount1, uint64 callerFee0, uint64 callerFee1, uint64 frontingFee0, uint64 frontingFee1, uint64 executionHandlerFeeAmount0, bytes32 executionHash, uint256 executionExpiry)"],
        [struct]
    );
    const structHash = hre.ethers.keccak256(encoded);
    const encoded2 = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32"],
        [structHash, btcTxHash]
    );
    return hre.ethers.keccak256(encoded2);
}
