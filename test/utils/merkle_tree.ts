import {createHash, randomBytes} from "crypto";

function dblSha256(valueBuffer: Buffer): Buffer {
    return createHash("sha256").update(createHash("sha256").update(valueBuffer).digest()).digest();
}

export function generateMerkleRoot(value: Buffer, depth = Math.floor(24*Math.random())): [string, string[], number] {
    let position = 0;
    let root = Buffer.from([...value]);
    const proof = [];
    for(let i=0;i<depth;i++) {
        const sibling = randomBytes(32);
        proof.push(sibling);
        const leftOrRight = Math.floor(2*Math.random());
        root = dblSha256(Buffer.concat(leftOrRight==0 ? [
            root, sibling
        ] : [
            sibling, root
        ]));
        position += leftOrRight << i;
    }
    return [root.toString("hex"), proof.map(e => e.toString("hex")), position];
}
