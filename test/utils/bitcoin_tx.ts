import { randomUnsigned } from "./random";
import { Transaction } from 'bitcoinjs-lib';
import {randomBytes} from "crypto";

export function getRandomTransaction(minInputs: number = 1, minOutputs: number = 1): Transaction {
    const tx = new Transaction();
    tx.locktime = randomUnsigned(32);
    tx.version = randomUnsigned(31);
    const inputs = minInputs+Math.floor(Math.random() * 5);
    for(let i=0;i<inputs;i++) {
        tx.addInput(randomBytes(32), randomUnsigned(32), randomUnsigned(32), randomBytes(Math.floor(Math.random() * 512)));
    }
    const outputs = minOutputs+Math.floor(Math.random() * 5);
    for(let i=0;i<outputs;i++) {
        tx.addOutput(randomBytes(Math.floor(Math.random() * 64)), randomUnsigned(32));
    }
    return tx;
}
