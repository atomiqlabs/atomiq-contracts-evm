import { Transaction } from "bitcoinjs-lib";
import {randomBytes} from "crypto";
import { randomUnsigned } from "../../../utils/random";
import { toBuffer } from "../../../utils/buffer_utils";

export function getSpvVaultBtcTx(inputSequences: bigint[], outputScripts: Buffer[], locktime: bigint): Transaction {

    const tx = new Transaction();
    inputSequences.forEach(sequence => tx.addInput(randomBytes(32), randomUnsigned(32), Number(sequence)));
    outputScripts.forEach(script => tx.addOutput(script, randomUnsigned(24)));
    tx.locktime = Number(locktime);

    return tx;

}

export function getValidSpvVaultBtcTx(
    recipient: string, amount0: bigint, callerFee: bigint, frontingFee: bigint, executionFee: bigint, amount1?: bigint, executionHash?: string, executionExpiry?: bigint
) {
    let length = 20 + 8;
    if(amount1!=null) length += 8;
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
