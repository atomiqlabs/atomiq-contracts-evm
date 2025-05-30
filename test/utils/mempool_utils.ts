const mempoolApiUrl = process.env.MEMPOOL_URL ?? "https://mempool.space/api";

export type MempoolApiMerkleProof = {
    block_height: number,
    merkle: string[],
    pos: number
}

export async function getMempoolApiMerkleProof(txId: string): Promise<MempoolApiMerkleProof> {
    return (await (await fetch(mempoolApiUrl+"/tx/"+txId+"/merkle-proof")).json());
}
