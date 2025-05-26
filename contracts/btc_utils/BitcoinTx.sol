// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Endianness.sol";

struct BitcoinTxOutput {
    uint256 valueOffset;
    uint256 scriptOffset;
    uint256 scriptLength;
}

library BitcoinTxOutputImpl {

    //Get the value of the output
    function getValue(BitcoinTxOutput memory self) pure internal returns (uint256 value) {
        uint256 ptr = self.valueOffset;
        assembly ("memory-safe") {
            value := shr(192, mload(ptr))
        }
        value = Endianness.reverseUint64(value);
    }

    //Get the keccak256 hash of the output script
    function getScriptHash(BitcoinTxOutput memory self) pure internal returns (bytes32 scriptHash) {
        uint256 ptr = self.scriptOffset;
        uint256 scriptLen = self.scriptLength;
        assembly ("memory-safe") {
            scriptHash := keccak256(ptr, scriptLen)
        }
    }

}

struct BitcoinTxInput {
    uint256 startOffset;
    uint256 scriptOffset;
    uint256 scriptLength;
}

library BitcoinTxInputImpl {

    function getUtxo(BitcoinTxInput memory self) pure internal returns (bytes32 txId, uint256 vout) {
        uint256 ptr = self.startOffset;
        assembly ("memory-safe") {
            txId := mload(ptr)
            vout := and(mload(add(ptr, 4)), 0xffffffff)
        }
        vout = Endianness.reverseUint32(vout);
    }

    function getNSequence(BitcoinTxInput memory self) pure internal returns (uint256 nSequence) {
        uint256 ptr = self.scriptOffset + self.scriptLength;
        assembly ("memory-safe") {
            nSequence := shr(224, mload(ptr))
        }
        nSequence = Endianness.reverseUint32(nSequence);
    }

    //Get the keccak256 hash of the input script
    function getScriptHash(BitcoinTxInput memory self) pure internal returns (bytes32 scriptHash) {
        uint256 ptr = self.scriptOffset;
        uint256 scriptLen = self.scriptLength;
        assembly ("memory-safe") {
            scriptHash := keccak256(ptr, scriptLen)
        }
    }

}

struct BitcoinTx {
    bytes data;
    BitcoinTxInput[] ins;
    BitcoinTxOutput[] outs;
}

//Optimized bitcoin transaction parser
library BitcoinTxImpl {

    function fromMemory(bytes memory data) pure internal returns(BitcoinTx memory result) {
        uint256 dataLength = data.length;
        require(dataLength != 64, "bitcointx: length 64");

        BitcoinTxInput[] memory inputHints;
        BitcoinTxOutput[] memory outputHints;
        assembly ("memory-safe") {
            function reverseUint16(input) -> output {
                output := or(shr(8, and(input, 0xFF00)), shl(8, and(input, 0x00FF)))
            }

            function reverseUint32(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00)), shl(8, and(input, 0x00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000)), shl(16, and(output, 0x0000FFFF)))
            }

            function reverseUint64(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00FF00FF00)), shl(8, and(input, 0x00FF00FF00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000FFFF0000)), shl(16, and(output, 0x0000FFFF0000FFFF)))
                output := or(shr(32, and(output, 0xFFFFFFFF00000000)), shl(32, and(output, 0x00000000FFFFFFFF)))
            }

            function readCompact(offset) -> value, length {
                let word := mload(offset)
                let first := shr(248, word)
                switch offset
                case 0xFD {
                    value := reverseUint16(and(shr(232, first), 0xffff))
                    length := 3
                }
                case 0xFE {
                    value := reverseUint32(and(shr(216, first), 0xffffffff))
                    length := 5
                }
                case 0xFF {
                    value := reverseUint64(and(shr(184, first), 0xffffffffffffffff))
                    length := 9
                }
                default {
                    value := first
                    length := 1
                }
            }

            function readInput(ptr, hintsOffset) -> endPtr {
                let startOffset := ptr //Start offset
                //Previous output:
                //hash: bytes32
                //vout: uint32
                ptr := add(ptr, 36)

                //input_script_length: CompactSize
                let scriptLength, bytesRead := readCompact(ptr)
                ptr := add(ptr, bytesRead)
                //input script: bytes(scriptLength)
                
                mstore(hintsOffset, startOffset) 
                mstore(add(hintsOffset, 32), ptr) //Script start offset
                mstore(add(hintsOffset, 64), scriptLength) //Script length

                //nSequence: uint32
                endPtr := add(add(ptr, scriptLength), 4)
            }

            function readOutput(ptr, hintsOffset) -> endPtr {
                let valueOffset := ptr //Value offset
                //value: uint64
                ptr := add(ptr, 8)

                //output_script_length: CompactSize
                let scriptLength, bytesRead := readCompact(ptr)
                ptr := add(ptr, bytesRead)
                //output script: bytes(scriptLength)
            
                mstore(hintsOffset, valueOffset)
                mstore(add(hintsOffset, 32), ptr) //Script start offset
                mstore(add(hintsOffset, 64), scriptLength) //Script length

                endPtr := add(ptr, scriptLength)
            }

            //version: uint32
            let ptr := add(data, 36)

            //Check that segwit flag is not set (we only accept non-segwit transactions, or transactions with segwit data stripped)
            if eq(shr(240, mload(ptr)), 0x0001) { revert(0, 0) } //bitcointx: witness not stripped

            //inputCount: CompactSize
            let inputCount, inputBytesRead := readCompact(ptr)
            ptr := add(ptr, inputBytesRead)

            //Allocate input hints
            inputHints := mload(0x40)
            mstore(0x40, add(add(inputHints, 32), mul(inputCount, 96)))
            mstore(inputHints, inputCount)

            //Read inputs
            let inputHintsPtr := add(inputHints, 32)
            for
                { let index := 0 }
                lt(index, inputCount)
                { index := add(index, 1) }
            {
                ptr := readInput(ptr, inputHintsPtr)
                inputHintsPtr := add(inputHintsPtr, 96)
            }

            //outputCount: CompactSize
            let outputCount, outputBytesRead := readCompact(ptr)
            ptr := add(ptr, outputBytesRead)

            //Allocate output hints
            outputHints := mload(0x40)
            mstore(0x40, add(add(outputHints, 32), mul(outputCount, 96)))
            mstore(outputHints, outputCount)

            //Read outputs
            let outputHintsPtr := add(outputHints, 32)
            for
                { let index := 0 }
                lt(index, outputCount)
                { index := add(index, 1) }
            {
                ptr := readOutput(ptr, outputHintsPtr)
                outputHintsPtr := add(outputHintsPtr, 96)
            }

            //locktime: uint32
            ptr := add(ptr, 4)

            //Ensure there is no more data in the data buffer
            if iszero(eq(sub(sub(ptr, data), 32), dataLength)) {
                revert(0, 0) //bitcointx: more data
            }
        }

        result = BitcoinTx({
            data: data,
            ins: inputHints,
            outs: outputHints
        });
    }
    
    function getHash(BitcoinTx memory self) view internal returns (bytes32 result) {
        bytes memory data = self.data;
        assembly ("memory-safe") {
            //Invoke first sha256 hash on the memory region storing the transaction
            pop(staticcall(gas(), 0x02, add(data, 32), mload(data), 0x00, 32))
            //Invoke second sha256 on the scratch space at 0x00
            pop(staticcall(gas(), 0x02, 0x00, 32, 0x00, 32))

            //Load and return the result
            result := mload(0x00)
        }
    }

    function getVersion(BitcoinTx memory self) pure internal returns (uint256 result) {
        bytes memory data = self.data;
        assembly ("memory-safe") {
            result := shr(224, mload(add(data, 32)))
        }
        result = Endianness.reverseUint32(result);
    }

    function getLocktime(BitcoinTx memory self) pure internal returns (uint256 result) {
        bytes memory data = self.data;
        assembly ("memory-safe") {
            result := and(mload(add(data, mload(data))), 0xffffffff) //Read the last 32byte word of the transaction data which is located at: data + len(data) + 32 - 32
        }
        result = Endianness.reverseUint32(result);
    }

}
