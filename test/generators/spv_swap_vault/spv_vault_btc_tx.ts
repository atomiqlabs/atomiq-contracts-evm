import { Transaction } from "bitcoinjs-lib";
import {randomBytes} from "crypto";
import { randomUnsigned } from "../../utils/random";
import { fromBuffer, toBuffer } from "../../utils/buffer_utils";
import { BitcoinVaultTransactionData } from "../../utils/evm/bitcoin_vault_transaction_data";

export function getSpvVaultBtcTx(inputSequences: bigint[], outputScripts: Buffer[], locktime: bigint): Transaction {

    const tx = new Transaction();
    inputSequences.forEach(sequence => tx.addInput(randomBytes(32), randomUnsigned(32), Number(sequence)));
    outputScripts.forEach(script => tx.addOutput(script, randomUnsigned(24)));
    tx.locktime = Number(locktime);

    return tx;

}

export function getValidSpvVaultBtcTx(
    recipient: string, amount0: bigint, callerFee: bigint = 0n, frontingFee: bigint = 0n, executionFee: bigint = 0n, amount1?: bigint, executionHash?: string, executionExpiry?: bigint
) {
    let length = 20 + 8;
    if(amount1!=null && amount1!==0n) length += 8;
    if(executionHash!=null) length += 32;

    return getSpvVaultBtcTx(
        [
            (((frontingFee >> 10n) & 0b11_1111_1111n) << 20n) | (callerFee & 0b1111_1111_1111_1111_1111n),
            ((frontingFee & 0b11_1111_1111n) << 20n) | (executionFee & 0b1111_1111_1111_1111_1111n)
        ],
        [
            Buffer.alloc(0),
            Buffer.concat([
                Buffer.from([0x6a, length]), //OP_RETURN OP_PUSH_length
                Buffer.from(recipient.substring(2), "hex"),
                toBuffer(amount0, 8, "be"),
                amount1 != null ? toBuffer(amount1, 8, "be") : Buffer.alloc(0),
                executionHash != null ? Buffer.from(executionHash.substring(2), "hex") : Buffer.alloc(0)
            ])
        ],
        executionExpiry != null ? executionExpiry - 1_000_000_000n : 0n
    );
}

export function parseSpvVaultBtcTx(tx: Transaction): BitcoinVaultTransactionData {
    const nSequence0 = BigInt(tx.ins[0].sequence);
    const nSequence1 = BigInt(tx.ins[1].sequence);

    const callerFeeShare = nSequence0 & 0b1111_1111_1111_1111_1111n;
    const executionFeeShare = nSequence1 & 0b1111_1111_1111_1111_1111n;
    const frontingFeeShare = (((nSequence0 >> 20n) & 0b11_1111_1111n) << 10n) | ((nSequence1 >> 20n) & 0b11_1111_1111n);

    const opReturnScript = tx.outs[1].script.subarray(2); //OP_RETURN OP_PUSH_length
    
    let recipient: string;
    let amount0: bigint = 0n;
    let amount1: bigint = 0n;
    let executionHash: string = "0x0000000000000000000000000000000000000000000000000000000000000000";

    recipient = "0x"+opReturnScript.subarray(0, 20).toString("hex");
    amount0 = fromBuffer(opReturnScript.subarray(20, 28), "be");

    switch(opReturnScript.length) {
        case 36:
            amount1 = fromBuffer(opReturnScript.subarray(28, 36), "be");
            break;
        case 60:
            executionHash = "0x"+opReturnScript.subarray(28, 60).toString("hex");
            break;
        case 68:
            amount1 = fromBuffer(opReturnScript.subarray(28, 36), "be");
            executionHash = "0x"+opReturnScript.subarray(36, 68).toString("hex");
            break;
    }

    return {
        recipient,
        amount0,
        amount1,
        executionHandlerFeeAmount0: amount0 * executionFeeShare / 100_000n,
        callerFee0: amount0 * callerFeeShare / 100_000n,
        callerFee1: amount1 * callerFeeShare / 100_000n,
        frontingFee0: amount0 * frontingFeeShare / 100_000n,
        frontingFee1: amount1 * frontingFeeShare / 100_000n,
        executionHash,
        executionExpiry: BigInt(tx.locktime) + 1_000_000_000n
    }
}