// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./Endianness.sol";

//Struct is kept for reference only. It is stored in the packed format in inputs field of the BitcoinTx struct
struct BitcoinTxInput {
    bytes32 prevTxHash; //UTXO txHash
    uint32 vout; //UTXO vout
    uint64 scriptOffset; //Indicates the offset of the input's scriptSig in the bytes data field of BitcoinTx struct
    uint64 scriptLength; //Indicates the length of the input's scriptSig in the bytes data field of BitcoinTx struct
    uint32 nSequence; //Input nSequence
} //56 bytes in total

//Struct is kept for reference only. It is stored in the packed format in outputs field of the BitcoinTx struct
struct BitcoinTxOutput {
    uint64 amount; //Output amount in base units - satoshis
    uint64 scriptOffset; //Indicates the offset of the output's scriptPubkey in the bytes data field of BitcoinTx struct
    uint64 scriptLength; //Indicates the length of the output's scriptPubkey in the bytes data field of BitcoinTx struct
} //24 bytes in total

struct BitcoinTx {
    bytes data; //Raw data of the transaction (witness data has to be stripped!)
    bytes inputs; //An array of packed BitcoinTxInput, stored back-to-back (size is therefore of 56 multiple)
    bytes outputs; //An array of packed BitcoinTxOutput, stored back-to-back (size is therefore of 24 multiple)
}

library BitcoinTxImpl {

    //Parses the bitcoin transation from memory in-place (without copying the content)
    function fromMemory(bytes memory data) pure internal returns(BitcoinTx memory result) {
        uint256 dataLength = data.length;
        //Security against spoofing bitcoin txs as merkle tree nodes
        // https://blog.rsk.co/ru/noticia/the-design-of-bitcoin-merkle-trees-reduces-the-security-of-spv-clients/
        require(dataLength != 64, "bitcointx: length 64");

        bytes memory inputs;
        bytes memory outputs;
        assembly ("memory-safe") {
            //Reverses endianness of 16-bit unsigned integer
            function reverseUint16(input) -> output {
                output := or(shr(8, and(input, 0xFF00)), shl(8, and(input, 0x00FF)))
            }

            //Reverses endianness of 32-bit unsigned integer
            function reverseUint32(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00)), shl(8, and(input, 0x00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000)), shl(16, and(output, 0x0000FFFF)))
            }

            //Reverses endianness of 64-bit unsigned integer
            function reverseUint64(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00FF00FF00)), shl(8, and(input, 0x00FF00FF00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000FFFF0000)), shl(16, and(output, 0x0000FFFF0000FFFF)))
                output := or(shr(32, and(output, 0xFFFFFFFF00000000)), shl(32, and(output, 0x00000000FFFFFFFF)))
            }

            //Reads compact size integer, returns the value + length in bytes read
            function readCompact(offset) -> value, length {
                let word := mload(offset)
                let first := shr(248, word) //Extract first byte
                switch lt(first, 0xFD) //Optimize for 1-byte long compact value, as that is most common
                case 1 {
                    value := first
                    length := 1
                }
                default {
                    switch first
                    case 0xFD {
                        value := reverseUint16(and(shr(232, word), 0xffff))
                        length := 3
                    }
                    case 0xFE {
                        value := reverseUint32(and(shr(216, word), 0xffffffff))
                        length := 5
                    }
                    case 0xFF {
                        value := reverseUint64(and(shr(184, word), 0xffffffffffffffff))
                        length := 9
                    }
                }
            }

            //Parses transaction's input, returns the pointer
            function readInput(ptr, inputsPtr, dataStartOffset) -> endPtr {
                //Previous output:
                //hash: bytes32
                //vout: uint32
                mcopy(inputsPtr, ptr, 36) //Copy the hash and vout of the UTXO to inputs
                ptr := add(ptr, 36)

                //input_script_length: CompactSize
                let scriptLength, bytesRead := readCompact(ptr)
                ptr := add(ptr, bytesRead)
                //input script: bytes(scriptLength)

                let packedData := or(
                    and(shl(192, sub(ptr, dataStartOffset)), 0xffffffffffffffff000000000000000000000000000000000000000000000000), //Save offset where scriptSig start
                    and(shl(128, scriptLength), 0x0000000000000000ffffffffffffffff00000000000000000000000000000000) //Save scriptSig byte length
                )

                ptr := add(ptr, scriptLength)
                
                //nSequence: uint32
                packedData := or(
                    packedData, 
                    and(shr(128, mload(ptr)), 0x00000000000000000000000000000000ffffffff000000000000000000000000) //Load, shift and save the nSequence
                )
                mstore(add(inputsPtr, 36), packedData) //Save packedData to memory

                endPtr := add(ptr, 4)
            }

            function readOutput(ptr, outputsPtr, dataStartOffset) -> endPtr {
                //value: uint64
                let packedData := and(mload(ptr), 0xffffffffffffffff000000000000000000000000000000000000000000000000) //Save output's value/amount
                ptr := add(ptr, 8)

                //output_script_length: CompactSize
                let scriptLength, bytesRead := readCompact(ptr)
                ptr := add(ptr, bytesRead)
                //output script: bytes(scriptLength)
                
                mstore(outputsPtr, or(
                    packedData,
                    or(
                        and(shl(128, sub(ptr, dataStartOffset)), 0x0000000000000000ffffffffffffffff00000000000000000000000000000000), //Script start offset
                        and(shl(64, scriptLength), 0x00000000000000000000000000000000ffffffffffffffff0000000000000000) //Script length
                    )
                ))

                endPtr := add(ptr, scriptLength)
            }

            let dataStartOffset := add(data, 32) //Skip the bytes length prefix

            //version: uint32
            let ptr := add(dataStartOffset, 4)

            //Check that segwit flag is not set (we only accept non-segwit transactions, or transactions with segwit data stripped)
            if eq(shr(240, mload(ptr)), 0x0001) {
                let revertPtr := mload(0x40)
                mstore(revertPtr, 0x08c379a000000000000000000000000000000000000000000000000000000000)
                mstore(add(revertPtr, 0x04), 0x20)
                mstore(add(revertPtr, 0x24), 31) mstore(add(revertPtr, 0x44), "bitcointx: witness not stripped") //bitcointx: witness not stripped
                revert(revertPtr, 0x64)
            }

            //inputCount: CompactSize
            let inputCount, inputBytesRead := readCompact(ptr)
            ptr := add(ptr, inputBytesRead)

            //Allocate input hints
            inputs := mload(0x40)
            let inputsLength := mul(inputCount, 56)
            mstore(inputs, inputsLength)
            let inputsPtr := add(inputs, 32)
            let inputsEnd := add(inputsPtr, inputsLength)
            mstore(0x40, inputsEnd)

            //Read inputs
            for
                { }
                lt(inputsPtr, inputsEnd)
                { inputsPtr := add(inputsPtr, 56) }
            {
                ptr := readInput(ptr, inputsPtr, dataStartOffset)
            }

            //outputCount: CompactSize
            let outputCount, outputBytesRead := readCompact(ptr)
            ptr := add(ptr, outputBytesRead)

            //Allocate output hints
            outputs := mload(0x40)
            let outputsLength := mul(outputCount, 24)
            mstore(outputs, outputsLength)
            let outputsPtr := add(outputs, 32)
            let outputsEnd := add(outputsPtr, outputsLength)
            mstore(0x40, outputsEnd)

            //Read outputs
            for
                { }
                lt(outputsPtr, outputsEnd)
                { outputsPtr := add(outputsPtr, 24) }
            {
                ptr := readOutput(ptr, outputsPtr, dataStartOffset)
            }

            //locktime: uint32
            ptr := add(ptr, 4)

            //Ensure there is no more data in the data buffer
            if iszero(eq(sub(ptr, dataStartOffset), dataLength)) {
                let revertPtr := mload(0x40)
                mstore(revertPtr, 0x08c379a000000000000000000000000000000000000000000000000000000000)
                mstore(add(revertPtr, 0x04), 0x20)
                mstore(add(revertPtr, 0x24), 20) mstore(add(revertPtr, 0x44), "bitcointx: more data") //bitcointx: more data
                revert(revertPtr, 0x64)
            }
        }

        result.data = data;
        result.inputs = inputs;
        result.outputs = outputs;
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

    function getVersion(BitcoinTx memory self) pure internal returns (uint32 result) {
        bytes memory data = self.data;
        assembly ("memory-safe") {
            result := shr(224, mload(add(data, 32))) //Version is in the first 4-bytes of the transaction data
        }
        result = Endianness.reverseUint32(result);
    }

    function getLocktime(BitcoinTx memory self) pure internal returns (uint32 result) {
        bytes memory data = self.data;
        assembly ("memory-safe") {
            let dataLength := mload(data)
            let txLastWord := mload(add(data, dataLength)) //Read the last 32byte word of the transaction data which is located at: data + len(data) + 32 - 32
            result := and(mload(add(data, dataLength)), 0xffffffff) //Extract the locktime, which is in the last 4-bytes
        }
        result = Endianness.reverseUint32(result);
    }

    function inputsCount(BitcoinTx memory self) pure internal returns (uint256 count) {
        count = self.inputs.length / 56;
    }

    //Get the UTXO of the input with the format: (txId, vout)
    function getInputUtxo(BitcoinTx memory self, uint256 vin) pure internal returns (bytes32 txId, uint32 vout) {
        bytes memory inputs = self.inputs;
        uint256 vinOffset = vin * 56;
        require(inputs.length > vinOffset, "btcTx: Input not found");
        assembly ("memory-safe") {
            let ptr := add(add(inputs, 32), vinOffset)
            txId := mload(ptr)
            vout := and(mload(add(ptr, 4)), 0xffffffff)
        }
        vout = Endianness.reverseUint32(vout);
    }

    //Returns the nSequence of the input
    function getInputNSequence(BitcoinTx memory self, uint256 vin) pure internal returns (uint32 nSequence) {
        bytes memory inputs = self.inputs;
        uint256 vinOffset = vin * 56;
        require(inputs.length > vinOffset, "btcTx: Input not found");
        assembly ("memory-safe") {
            let ptr := add(add(inputs, 56), vinOffset) //Load 32-bytes word at offset 24 (+32 bytes length prefix), so we can isolate the nSequence stored as last 4 bytes at offset 52
            nSequence := and(mload(ptr), 0xffffffff)
        }
        nSequence = Endianness.reverseUint32(nSequence);
    }

    //Get the keccak256 hash of the input script
    function getInputScriptHash(BitcoinTx memory self, uint256 vin) pure internal returns (bytes32 scriptHash) {
        bytes memory data = self.data;
        bytes memory inputs = self.inputs;
        uint256 vinOffset = vin * 56;
        require(inputs.length > vinOffset, "btcTx: Input not found");
        assembly ("memory-safe") {
            let ptr := add(add(inputs, 52), vinOffset) //Load 32-bytes word at offset 20 (+32 bytes length prefix), so we can isolate scriptOffset at offset 36 and scriptLength at offset 44
            let packedData := mload(ptr)
            let scriptOffset := and(shr(64, packedData), 0xffffffffffffffff)
            let scriptLength := and(packedData, 0xffffffffffffffff)
            scriptHash := keccak256(add(add(data, 32), scriptOffset), scriptLength)
        }
    }

    function outputsCount(BitcoinTx memory self) pure internal returns (uint256 count) {
        count = self.outputs.length / 24;
    }

    //Get the value of the output
    function getOutputValue(BitcoinTx memory self, uint256 vout) pure internal returns (uint64 value) {
        bytes memory outputs = self.outputs;
        uint256 voutOffset = vout * 24;
        require(outputs.length > voutOffset, "btcTx: Output not found");
        assembly ("memory-safe") {
            let ptr := add(add(outputs, 32), voutOffset)
            value := shr(192, mload(ptr))
        }
        value = Endianness.reverseUint64(value);
    }

    //Get the keccak256 hash of the output script
    function getOutputScriptHash(BitcoinTx memory self, uint256 vout) pure internal returns (bytes32 scriptHash) {
        bytes memory data = self.data;
        bytes memory outputs = self.outputs;
        uint256 voutOffset = vout * 24;
        require(outputs.length > voutOffset, "btcTx: Output not found");
        assembly ("memory-safe") {
            let ptr := add(add(outputs, 40), voutOffset) //Offset 8 (32+8 in total), so we can directly read script offset and length
            let packedData := mload(ptr)
            let scriptOffset := shr(192, packedData)
            let scriptLength := and(shr(128, packedData), 0xffffffffffffffff)
            scriptHash := keccak256(add(add(data, 32), scriptOffset), scriptLength)
        }
    }

    function getOutputScriptOffsets(BitcoinTx memory self, uint256 vout) pure internal returns (uint256 scriptOffset, uint256 scriptLength) {
        bytes memory outputs = self.outputs;
        uint256 voutOffset = vout * 24;
        require(outputs.length > voutOffset, "btcTx: Output not found");
        assembly ("memory-safe") {
            let ptr := add(add(outputs, 40), voutOffset) //Offset 8 (32+8 in total), so we can directly read script offset and length
            let packedData := mload(ptr)
            scriptOffset := shr(192, packedData)
            scriptLength := and(shr(128, packedData), 0xffffffffffffffff)
        }
    }

    function getOutputScript(BitcoinTx memory self, uint256 vout) pure internal returns (bytes memory script) {
        bytes memory data = self.data;
        bytes memory outputs = self.outputs;
        uint256 voutOffset = vout * 24;
        require(outputs.length > voutOffset, "btcTx: Output not found");
        assembly ("memory-safe") {
            let ptr := add(add(outputs, 40), voutOffset) //Offset 8 (32+8 in total), so we can directly read script offset and length
            let packedData := mload(ptr)
            let scriptOffset := shr(192, packedData)
            let scriptLength := and(shr(128, packedData), 0xffffffffffffffff)
            
            script := mload(0x40)
            mstore(0x40, add(add(script, 32), scriptLength))
            mstore(script, scriptLength)
            mcopy(add(script, 32), add(add(data, 32), scriptOffset), scriptLength)
        }
    }


}
