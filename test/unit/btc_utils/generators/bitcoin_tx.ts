import { getBlockWithTransactions, getTransaction, randomBitcoinHeight } from "../../../utils/bitcoin_rpc_utils";
import {Transaction} from "bitcoinjs-lib";
import { getRandomTransaction } from "../../../utils/bitcoin_tx";

export type BitcoinTxTestData = {
    data: Buffer,
    hash: string,
    txId: string,
    version: number,
    locktime: number,
    ins: {
        utxo: {
            hash: string,
            txId: string,
            vout: number
        },
        script: Buffer,
        nSequence: number
    }[],
    outs: {
        value: bigint,
        script: Buffer
    }[]
};

async function getRandomRealTxId() {
    const height = randomBitcoinHeight();
    const block = await getBlockWithTransactions(height);
    const txIndex = Math.floor(Math.random() * block.tx.length);
    return block.tx[txIndex];
}

export function getRandomTransactionTest(): BitcoinTxTestData {
    const tx = getRandomTransaction();
    return {
        data: tx.toBuffer(),
        txId: tx.getId(),
        hash: tx.getHash().toString("hex"),
        version: tx.version,
        locktime: tx.locktime,
        ins: tx.ins.map(val => {
            return {
                utxo: {
                    hash: val.hash.toString("hex"),
                    txId: Buffer.from(val.hash).reverse().toString("hex"),
                    vout: val.index
                },
                nSequence: val.sequence,
                script: val.script
            }
        }),
        outs: tx.outs.map(val => {
            return {
                value: BigInt(val.value),
                script: val.script
            }
        })
    };
}

export async function getRealTransactionTest(txId: string): Promise<BitcoinTxTestData> {
    const tx = await getTransaction(txId);

    const strippedTx = Transaction.fromHex(tx.hex);
    strippedTx.ins.forEach(val => val.witness = []);
    const strippedTxData = strippedTx.toBuffer();
    
    return {
        data: strippedTxData,
        txId: tx.txid,
        hash: Buffer.from(tx.txid, "hex").reverse().toString("hex"),
        version: tx.version,
        locktime: tx.locktime,
        ins: tx.vin.map(val => {
            val.txid ??= "0000000000000000000000000000000000000000000000000000000000000000";
            return {
                utxo: {
                    hash: Buffer.from(val.txid, "hex").reverse().toString("hex"),
                    txId: val.txid,
                    vout: val.vout ?? 0xFFFFFFFF
                },
                nSequence: val.sequence,
                script: Buffer.from(val.scriptSig?.hex ?? val.coinbase, "hex")
            }
        }),
        outs: tx.vout.map(val => {
            return {
                value: BigInt(Math.floor((val.value*100_000_000) + 0.5)),
                script: Buffer.from(val.scriptPubKey.hex, "hex")
            }
        })
    };
}

export async function getRealRandomTransactionTest(): Promise<BitcoinTxTestData> {
    const txId = await getRandomRealTxId();
    console.log("getRealRandomTransactionTest(): "+txId);
    return await getRealTransactionTest(txId);
}
