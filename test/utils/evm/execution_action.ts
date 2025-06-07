import hre from "hardhat";

export type ContractCall = {
    target: string,
    value: bigint,
    data: string
}

export type ExecutionAction = {
    gasLimit: bigint,
    calls: ContractCall[],
    drainTokens: string[]
}

export function getExecutionActionHash(executionAction: ExecutionAction) {
    const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint256 gasLimit, address[] drainTokens, tuple(address target, uint256 value, bytes data)[] calls)"],
        [executionAction]
    );
    return hre.ethers.keccak256(encoded);
}
