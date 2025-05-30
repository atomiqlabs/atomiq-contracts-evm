import { math } from "../../typechain-types/@openzeppelin/contracts/utils";

const bitcoindRpc = process.env.BITCOIND_RPC ?? "https://bitcoin-mainnet.public.blastapi.io";

export type BitcoindTransactionIn = {
    txid: string,
    vout: number,
    scriptSig: {
        asm: string,
        hex: string
    },
    coinbase?: string,
    sequence: number,
    txinwitness: string[]
}

export type BitcoindTransactionOut = {
    value: number,
    n: number,
    scriptPubKey: {
        asm: string,
        hex: string,
        reqSigs: number,
        type: string,
        addresses: string[]
    }
}

export type BitcoindTransaction = {
    hex: string,
    txid: string,
    hash: string,
    size: number,
    vsize: number,
    weight: number,
    version: number,
    locktime: number,
    vin: BitcoindTransactionIn[],
    vout: BitcoindTransactionOut[],
    blockhash: string,
    confirmations: number,
    blocktime: number,
    time: number
};

export type BitcoinBlockWithTransactions = {
    hash: string,
    confirmations: number,
    size: number,
    strippedsize: number,
    weight: number,
    height: number,
    version: number,
    versionHex: string,
    merkleroot: string,
    tx: string[],
    time: number,
    mediantime: number,
    nonce: number,
    bits: string,
    difficulty: number,
    chainwork: string,
    nTx: number,
    previousblockhash: string,
    nextblockhash: string
};

export type BitcoindBlockheader = {
    hash: string,
    confirmations: number,
    height: number,
    version: number,
    versionHex: string,
    merkleroot: string,
    time: number,
    mediantime: number,
    nonce: number,
    bits: string,
    difficulty: number,
    chainwork: string,
    nTx: number,
    previousblockhash: string,
    nextblockhash: string
}

export async function getBlockhash(height: number): Promise<string> {
    return (await (await fetch(bitcoindRpc, {method: "POST", body: JSON.stringify({
        "jsonrpc":"1.0","id":0,"method":"getblockhash","params":[height]
    })})).json()).result;
}

export async function getBlockheader(height: number): Promise<BitcoindBlockheader> {
    const blockhash = await getBlockhash(height);
    return (await (await fetch(bitcoindRpc, {method: "POST", body: JSON.stringify({
        "jsonrpc":"1.0","id":0,"method":"getblockheader","params":[blockhash]
    })})).json()).result;
}

export async function getBlockWithTransactions(height: number): Promise<BitcoinBlockWithTransactions> {
    const blockhash = await getBlockhash(height);
    return (await (await fetch(bitcoindRpc, {method: "POST", body: JSON.stringify({
        "jsonrpc":"1.0","id":0,"method":"getblock","params":[blockhash, 1]
    })})).json()).result;
}

export async function getTransaction(txId: string): Promise<BitcoindTransaction> {
    return (await (await fetch(bitcoindRpc, {method: "POST", body: JSON.stringify({
        "jsonrpc":"1.0","id":0,"method":"getrawtransaction","params":[txId, true]
    })})).json()).result;
}

export function randomBitcoinHeight(): number {
    return Math.floor(Math.random() * 850000);
}

export function randomBitcoinEpoch(): number {
    return Math.floor(Math.random() * 430);
}