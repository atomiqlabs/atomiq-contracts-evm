object "BtcRelay" {
    code {
        let constructorOffset := add(dataoffset("runtime"), datasize("runtime"))
        datacopy(0x00, constructorOffset, 160)
        let commitHash := keccak256(0x00, 160)
        let blockHeight := shr(224, mload(112))
        let chainWork := mload(80)

        //Save the initial stored header
        mstore(0x00, blockHeight)
        mstore(0x20, 1)
        sstore(keccak256(0x00, 0x40), commitHash)
        sstore(0, or(shl(32, chainWork), and(blockHeight, 0xffffffff)))

        //Emit event

        // Deploy the contract
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            // Protection against sending Ether
            require(iszero(callvalue()))

            //State storage
            function readChainWorkAndBlockheight() -> chainWork, blockHeight {
                let result := sload(0)
                chainWork := shr(32, result)
                blockHeight := and(result, 0xffffffff)
            }
            function writeChainWorkAndBlockheight(chainWork, blockHeight) {
                sstore(0, or(shl(32, chainWork), and(blockHeight, 0xffffffff)))
            }
            function readMainChain(blockHeight) -> commitHash {
                mstore(0x00, blockHeight)
                mstore(0x20, 1)
                commitHash := sload(keccak256(0x00, 0x40))
            }
            function writeMainChain(blockHeight, commitHash) {
                mstore(0x00, blockHeight)
                mstore(0x20, 1)
                sstore(keccak256(0x00, 0x40), commitHash)
            }

            // Dispatcher
            switch shr(224, calldataload(0))
            case 0x59533237 /* "submitMainBlockheaders()" */ {
                submitMainBlockheaders()
            }
            default {
                revert(0, 0)
            }
            return(0, 0)

            //Functions
            function submitMainBlockheaders() {
                let dataOffset := add(calldataload(4), 36)
                let dataLength := calldataload(add(calldataload(4), 4))
                require(not(lt(dataLength, 208))) //At least one blockheader
                let dataEnd := add(dataOffset, dataLength)
                if iszero(mload(0x40)) {mstore(0x40, 0x80)}
                
                let storedHeader := mload(0x40)
                mstore(0x40, add(storedHeader, 160))
                calldatacopy(storedHeader, dataOffset, 160)

                //Verify stored header is latest committed
                let chainWork, blockHeight := readChainWorkAndBlockheight()
                require(eq(blockHeight, storedBlockHeader_blockHeight(storedHeader))) //submitMain: block height
                require(eq(readMainChain(blockHeight), storedBlockHeader_hash(storedHeader))) //submitMain: block commitment

                //Proccess new block headers
                let i := add(dataOffset, 160)
                for
                    { }
                    lt(i, dataEnd)
                    { i := add(i, 48) }
                {
                    //Process the blockheader
                    let blockHash := storedBlockHeader_updateChain(storedHeader, i, timestamp())
                    blockHeight := add(blockHeight, 1)

                    //Write header commitment
                    let commitHash := storedBlockHeader_hash(storedHeader)
                    writeMainChain(blockHeight, commitHash)
                    
                    //Emit event
                    log3(0, 0, 0xac4014b0399957a2dcf00a29069e30d20e389073e0b60908dc40507776517e2f, commitHash, blockHash)
                }
                
                //Update globals
                writeChainWorkAndBlockheight(storedBlockHeader_chainWork(storedHeader), blockHeight)
            }

            //StoredBlockHeader.sol (expects 160 bytes of continous data in memory)
            function storedBlockHeader_reversedTimestamp(offset) -> result {
                result := shr(224, mload(add(offset, 68)))
            }
            function storedBlockHeader_nbits(offset) -> result {
                result := shr(224, mload(add(offset, 72)))
            }
            function storedBlockHeader_chainWork(offset) -> result {
                result := mload(add(offset, 80))
            }
            function storedBlockHeader_blockHeight(offset) -> result {
                result := shr(224, mload(add(offset, 112)))
            }
            function storedBlockHeader_lastDiffAdjustment(offset) -> result {
                result := shr(224, mload(add(offset, 116)))
            }
            function storedBlockHeader_hash(offset) -> result {
                result := keccak256(offset, 160)
            }
            function storedBlockHeader_writeHeaderAndGetDblSha256Hash(offset, headerOffset) -> result {
                //Invoke first sha256 hash on the memory region storing the previous blockheader, destination is scratch space at 0x00
                pop(staticcall(gas(), 0x02, offset, 80, 0x00, 32))
                //Invoke second sha256 on the scratch space at 0x00, copy directly to where the previous blockhash should be stored for next stored blockheader
                pop(staticcall(gas(), 0x02, 0x00, 32, add(offset, 4), 32))

                //Copy other data to the stored blockheader from calldata
                calldatacopy(offset, headerOffset, 4)
                calldatacopy(add(offset, 36), add(headerOffset, 4), 44)

                //Invoke first sha256 hash on the memory region now storing the current blockheader, destination is scratch space at 0x00
                pop(staticcall(gas(), 0x02, offset, 80, 0x00, 32))
                //Invoke second sha256 on the scratch space at 0x00
                pop(staticcall(gas(), 0x02, 0x00, 32, 0x00, 32))

                //Load and return the result
                result := mload(0x00)
            }
            function storedBlockHeader_updateChain(offset, headerOffset, currentTimestamp) -> blockHash {
                //We don't check whether pevious header matches since submitted headers are submitted
                // without previousBlockHash fields, which is instead taken automatically from the
                // current StoredBlockHeader, this allows us to save at least 512 gas on calldata
                blockHeader_verifyOutOfBounds(headerOffset)

                let prevBlockTimestamp := endianness_reverseUint32(storedBlockHeader_reversedTimestamp(offset))
                let currBlockTimestamp := endianness_reverseUint32(blockHeader_reversedTimestamp(headerOffset))

                //Check correct nbits
                let currBlockHeight := storedBlockHeader_blockHeight(offset)
                let lastDiffAdjustment := storedBlockHeader_lastDiffAdjustment(offset)
                let newNbits := blockHeader_nbits(headerOffset)
                let newTarget
                switch mod(currBlockHeight, 2016)
                case 0 {
                    //Compute new nbits, bitcoin uses the timestamp of the last block in the epoch to re-target PoW difficulty
                    // https://github.com/bitcoin/bitcoin/blob/78dae8caccd82cfbfd76557f1fb7d7557c7b5edb/src/pow.cpp#L49
                    newTarget := difficulty_computeNewTarget(
                        prevBlockTimestamp,
                        lastDiffAdjustment,
                        storedBlockHeader_nbits(offset)
                    )
                    let computedNbits := nbits_toNbits(newTarget)
                    require(eq(newNbits, computedNbits)) //updateChain: new nbits
                    //Even though timestamp of the last block in epoch is used to re-target PoW difficulty, the first
                    // block in a new epoch is used as last_diff_adjustment, the time it takes to mine the first block
                    // in every epoch is therefore not taken into consideration when retargetting PoW - one of many
                    // bitcoin's quirks
                    lastDiffAdjustment := currBlockTimestamp
                }
                default {
                    //nbits must be same as last block
                    require(eq(newNbits, storedBlockHeader_nbits(offset))) //updateChain: nbits
                    newTarget := nbits_toTarget(newNbits)
                }

                //Check PoW
                blockHash := storedBlockHeader_writeHeaderAndGetDblSha256Hash(offset, headerOffset)
                require(lt(endianness_reverseUint256(blockHash), newTarget)) //updateChain: invalid PoW

                //Verify timestamp is larger than median of last 11 block timestamps
                let count := 0
                let prevBlockTimestampsArray1 := mload(add(offset, 120)) //offset(120) Stores first 8 last block timestamps
                let prevBlockTimestampsArray2 := mload(add(offset, 128)) //offset(120 + 8) Stores last 2 last block timestamps in least significant bits
                count := gt(currBlockTimestamp, prevBlockTimestamp)
                count := add(count, gt(currBlockTimestamp, shr(224, prevBlockTimestampsArray1)))
                count := add(count, gt(currBlockTimestamp, and(shr(192, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(160, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(128, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(96, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(64, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(32, prevBlockTimestampsArray1), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(prevBlockTimestampsArray1, 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(shr(32, prevBlockTimestampsArray2), 0xffffffff)))
                count := add(count, gt(currBlockTimestamp, and(prevBlockTimestampsArray2, 0xffffffff)))

                require(gt(count, 5)) //updateChain: timestamp median
                require(lt(currBlockTimestamp, add(currentTimestamp, 14400))) //updateChain: timestamp future
                
                //Update prev block timestamps
                prevBlockTimestampsArray1 := shl(32, prevBlockTimestampsArray1) //Shift to the left, to remove oldest timestamp
                prevBlockTimestampsArray1 := or(prevBlockTimestampsArray1, and(shr(32, prevBlockTimestampsArray2), 0xffffffff)) //Push timestamp from arr2 to arr1
                prevBlockTimestampsArray2 := shl(32, prevBlockTimestampsArray2) //Shift to the left
                prevBlockTimestampsArray2 := or(prevBlockTimestampsArray2, prevBlockTimestamp) //Add previous block timestamp

                let chainWork := add(storedBlockHeader_chainWork(offset), difficulty_getChainWork(newTarget))

                //Save the stored blockheader to memory
                //Blockheader is already written to memory with prior writeHeaderAndGetDblSha256Hash() call
                mstore(add(offset, 80), chainWork)
                mstore(add(offset, 112), 
                    or(
                        or(
                            shl(224, currBlockHeight),
                            shl(192, and(lastDiffAdjustment, 0xffffffff))
                        ),
                        shr(64, prevBlockTimestampsArray1)
                    )
                )
                //Ensure we don't write outside the region of the stored blockheader byte array, so we
                // have a little bit of an overlap here
                mstore(add(offset, 128), 
                    or(
                        shl(64, prevBlockTimestampsArray1),
                        and(prevBlockTimestampsArray2, 0xffffffffffffffff)
                    )
                )
            }

            //BlockHeader.sol (expects 48 bytes of continous data in calldata)
            function blockHeader_verifyOutOfBounds(offset) {
                require(not(lt(calldatasize(), add(offset, 48))))
            }
            function blockHeader_reversedTimestamp(offset) -> result {
                result := shr(224, calldataload(add(offset, 36)))
            }
            function blockHeader_nbits(offset) -> result {
                result := shr(224, calldataload(add(offset, 40)))
            }

            //Difficulty.sol
            function difficulty_getChainWork(target) -> chainwork {
                chainwork := add(div(not(target), add(target, 1)), 1)
            }
            function difficulty_computeNewTarget(prevTimestamp, startTimestamp, prevTarget) -> newTarget {
                require(gt(prevTimestamp, startTimestamp))
                let timespan := sub(prevTimestamp, startTimestamp)

                // //Difficulty increase/decrease multiples are clamped between 0.25 (-75%) and 4 (+300%)
                if lt(timespan, 302400) { timespan := 302400 }
                if gt(timespan, 4838400) { timespan := 4838400 }

                newTarget := div(mul(prevTarget, timespan), 1209600)
                if gt(newTarget, 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { 
                    newTarget := 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
                }
            }

            //Endianness.sol
            function endianness_reverseUint32(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00)), shl(8, and(input, 0x00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000)), shl(16, and(output, 0x0000FFFF)))
            }
            function endianness_reverseUint256(input) -> output {
                output := or(shr(8, and(input, 0xFF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00)), shl(8, and(input, 0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF)))
                output := or(shr(16, and(output, 0xFFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000)), shl(16, and(output, 0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF)))
                output := or(shr(32, and(output, 0xFFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000)), shl(32, and(output, 0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF)))
                output := or(shr(64, and(output, 0xFFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF0000000000000000)), shl(64, and(output, 0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF)))
                output := or(shr(128, output), shl(128, output))
            }

            //Nbits.sol
            function nbits_toTarget(nbits) -> target {
                let nSize := and(nbits, 0xFF)
                let nWord := or(
                    or(
                        and(shl(8, nbits), 0x7f0000),
                        and(shr(8, nbits), 0xff00)
                    ),
                    and(shr(24, nbits), 0xff)
                )

                switch lt(nSize, 3)
                case 1 {
                    target := shr(mul(sub(3, nSize), 8), nWord)
                }
                default {
                    target := shl(mul(sub(nSize, 3), 8), nWord)
                }
                require(or(iszero(target), iszero(and(nbits,0x8000)))) //Nbits: negative 
            }
            function nbits_toNbits(target) -> nbits {
                switch target
                case 0 {
                    nbits := 0x00000000
                }
                default {
                    //Find first non-zero byte
                    let start := 0
                    for
                        { }
                        iszero(byte(start, target))
                        { start := add(start, 1) }
                    {}
                    let nSize := sub(32, start)

                    switch lt(nSize, 3) case 1 {
                        nbits := shl(mul(sub(3, nSize), 8), target)
                    }
                    default {
                        nbits := shr(mul(sub(nSize, 3), 8), target)
                    }

                    if eq(and(nbits, 0x00800000), 0x00800000) {
                        nbits := shr(8, nbits)
                        nSize := add(nSize, 1)
                    }

                    nbits := or(
                        or(
                            and(shl(24, nbits), 0xff000000),
                            and(shl(8, nbits), 0xff0000)
                        ),
                        or(
                            and(shr(8, nbits), 0xff00),
                            nSize
                        )
                    )
                }
            }
            
            function require(condition) {
                if iszero(condition) { revert(0, 0) }
            }
        }
    }
}
