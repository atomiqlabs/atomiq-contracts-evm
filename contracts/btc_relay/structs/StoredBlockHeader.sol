pragma solidity ^0.8.28;

import "./BlockHeader.sol";
import "../utils/Nbits.sol";
import "../utils/Difficulty.sol";
import "../utils/Endianness.sol";

/**
 * Bitcoin stored blockheader decoding from bytes
 * Structure (total 160 bytes):
 * - bytes blockheader (80 bytes)
 * - uint256 chainWork
 * - uint32 blockHeight
 * - uint32 lastDiffAdjustment
 * - uint32[10] prevBlockTimestamps
 */
library StoredBlockHeader {
    uint256 public constant DIFFICULTY_ADJUSTMENT_INTERVAL = 2016;

    using BlockHeader for bytes;

    function verifyOutOfBounds(bytes memory self) pure internal {
        require(self.length >= 160, "StoredBlockHeader: out of bounds");
    }

    //Getters
    function headerMerkleRoot(bytes memory self) pure internal returns (bytes32 result) {
        assembly ("memory-safe") {
            result := mload(add(self, 68))
        }
    }

    function headerReversedTimestamp(bytes memory self) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, mload(add(self, 100)))
        }
    }

    function headerNbits(bytes memory self) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, mload(add(self, 104)))
        }
    }

    function chainWork(bytes memory self) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := mload(add(self, 112))
        }
    }

    function blockHeight(bytes memory self) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, mload(add(self, 144)))
        }
    }

    function lastDiffAdjustment(bytes memory self) pure internal returns (uint256 result) {
        assembly ("memory-safe") {
            result := shr(224, mload(add(self, 148)))
        }
    }

    //Functions
    function hash(bytes memory self) pure internal returns (bytes32 result) {
        assembly ("memory-safe") {
            result := keccak256(add(self, 32), 160)
        }
    }
    
    function headerDblSha256Hash(bytes memory self) view internal returns (bytes32 result) {
        assembly ("memory-safe") {
            //Invoke first sha256 hash on the memory region, destination is scratch space at 0x00
            pop(staticcall(gas(), 0x02, add(self, 32), 80, 0x00, 32))
            //Invoke seconds sha256 on the scratch space at 0x00
            pop(staticcall(gas(), 0x02, 0x00, 32, 0x00, 32))

            result := mload(0x00)
        }
    }

    function updateChain(bytes memory self, bytes calldata headers, uint256 offset) internal view {
        //Previous blockhash matches
        require(headerDblSha256Hash(self) == headers.previousBlockhash(offset), "updateChain: prev blockhash");

        uint256 prevBlockTimestamp = Endianness.reverseUint32(headerReversedTimestamp(self));
        uint256 currBlockTimestamp = Endianness.reverseUint32(headers.reversedTimestamp(offset));

        //Check correct nbits
        uint256 currBlockHeight = blockHeight(self) + 1;
        uint256 _lastDiffAdjustment = lastDiffAdjustment(self);
        uint256 newNbits = headers.nbits(offset);
        uint256 newTarget;
        if(currBlockHeight % DIFFICULTY_ADJUSTMENT_INTERVAL == 0) {
            //Compute new nbits, bitcoin uses the timestamp of the last block in the epoch to re-target PoW difficulty
            // https://github.com/bitcoin/bitcoin/blob/78dae8caccd82cfbfd76557f1fb7d7557c7b5edb/src/pow.cpp#L49
            newTarget = Difficulty.computeNewTarget(
                prevBlockTimestamp,
                _lastDiffAdjustment,
                headerNbits(self)
            );
            uint256 computedNbits = Nbits.toNbits(newTarget);
            require(newNbits == computedNbits, "updateChain: new nbits");
            //Even though timestamp of the last block in epoch is used to re-target PoW difficulty, the first
            // block in a new epoch is used as last_diff_adjustment, the time it takes to mine the first block
            // in every epoch is therefore not taken into consideration when retargetting PoW - one of many
            // bitcoin's quirks
            _lastDiffAdjustment = currBlockTimestamp;
        } else {
            //nbits must be same as last block
            require(newNbits == headerNbits(self), "updateChain: nbits");
            newTarget = Nbits.toTarget(newNbits);
        }

        //Check PoW
        require(uint256(Endianness.reverseBytes32(headers.dblSha256Hash(offset))) < newTarget, "updateChain: invalid PoW");

        //Verify timestamp is larger than median of last 11 block timestamps
        uint256 count = 0;
        uint256 prevBlockTimestampsArray1;
        uint256 prevBlockTimestampsArray2;
        assembly {
            prevBlockTimestampsArray1 := mload(add(self, 152)) //offset(32 + 120) Stores first 8 last block timestamps
            prevBlockTimestampsArray2 := mload(add(self, 160)) //offset(32 + 120 + 8) Stores last 2 last block timestamps in least significant bits
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
        }
        require(count > 5, "updateChain: timestamp median");

        //Update prev block timestamps
        assembly {
            prevBlockTimestampsArray1 := shl(32, prevBlockTimestampsArray1) //Shift to the left, to remove oldest timestamp
            prevBlockTimestampsArray1 := or(prevBlockTimestampsArray1, and(shr(32, prevBlockTimestampsArray2), 0xffffffff)) //Push timestamp from arr2 to arr1
            prevBlockTimestampsArray2 := shl(32, prevBlockTimestampsArray2) //Shift to the left
            prevBlockTimestampsArray2 := or(prevBlockTimestampsArray2, prevBlockTimestamp) //Add previous block timestamp
        }

        uint256 _chainWork = chainWork(self) + Difficulty.getChainWork(newTarget);

        //Save the stored blockheader to memory
        assembly ("memory-safe") {
            calldatacopy(add(self, 32), add(headers.offset, offset), 80)
            mstore(add(self, 112), _chainWork)
            mstore(add(self, 144), 
                or(
                    or(
                        shl(224, currBlockHeight),
                        shl(192, and(_lastDiffAdjustment, 0xffffffff))
                    ),
                    shr(64, prevBlockTimestampsArray1)
                )
            )
            mstore(add(self, 160), 
                or(
                    shl(64, prevBlockTimestampsArray1),
                    and(prevBlockTimestampsArray2, 0xffffffffffffffff)
                )
            )
        }
    }
}
