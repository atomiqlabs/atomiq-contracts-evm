import {randomBytes} from "crypto";
import { generateMerkleRoot } from "../../../utils/merkle_tree";
import { getBlockWithTransactions, randomBitcoinHeight } from "../../../utils/bitcoin_rpc_utils";
import { getMempoolApiMerkleProof } from "../../../utils/mempool_utils";

export async function generateMerkleTreeRealRandomTest(): Promise<[string, string, string[], number]> {
    const height = randomBitcoinHeight();
    const block = await getBlockWithTransactions(height);
    const txIndex = Math.floor(Math.random() * block.tx.length);
    const txId = block.tx[txIndex];
    const merkleProof = await getMempoolApiMerkleProof(txId);
    return [
        Buffer.from(block.merkleroot, "hex").reverse().toString("hex"),
        Buffer.from(txId, "hex").reverse().toString("hex"),
        merkleProof.merkle.map(val => Buffer.from(val, "hex").reverse().toString("hex")),
        merkleProof.pos
    ];
}

export function generateMerkleTreeRandomTest(): [string, string, string[], number] {
    const depth = Math.floor(24*Math.random());
    const value = randomBytes(32);
    const [root, proof, position] = generateMerkleRoot(value, depth);
    return [root, value.toString("hex"), proof, position];
}
