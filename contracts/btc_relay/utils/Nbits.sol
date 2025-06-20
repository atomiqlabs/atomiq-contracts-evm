// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library Nbits {

    //Calculates difficulty target from nBits
    //Description: https://btcinformation.org/en/developer-reference#target-nbits
    //This implementation panics on negative targets, accepts oveflown targets
    function toTarget(uint32 reversedNbits) pure internal returns (uint256 target) {
        uint256 nSize;
        assembly {
            nSize := and(reversedNbits, 0xFF)
            let nWord := or(
                or(
                    and(shl(8, reversedNbits), 0x7f0000),
                    and(shr(8, reversedNbits), 0xff00)
                ),
                and(shr(24, reversedNbits), 0xff)
            )

            switch lt(nSize, 3)
            case 1 {
                target := shr(mul(sub(3, nSize), 8), nWord)
            }
            default {
                target := shl(mul(sub(nSize, 3), 8), nWord)
            }
        }
        require(target == 0 || reversedNbits & 0x8000 == 0, "Nbits: negative");
    }

    //Compresses difficulty target to nBits
    //Description: https://btcinformation.org/en/developer-reference#target-nbits
    function toReversedNbits(uint256 target) pure internal returns (uint32 reversedNbits) {
        assembly {
            switch target
            case 0 {
                reversedNbits := 0x00000000
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

                let result
                switch lt(nSize, 3) case 1 {
                    result := shl(mul(sub(3, nSize), 8), target)
                }
                default {
                    result := shr(mul(sub(nSize, 3), 8), target)
                }

                //Check that nbits are not encoding negative number, in case yes, shift
                // the result one byte to the right and adjust nSize accordingly
                if eq(and(result, 0x00800000), 0x00800000) {
                    result := shr(8, result)
                    nSize := add(nSize, 1)
                }

                reversedNbits := or(
                    or(
                        and(shl(24, result), 0xff000000),
                        and(shl(8, result), 0xff0000)
                    ),
                    or(
                        and(shr(8, result), 0xff00),
                        nSize
                    )
                )
            }
        }
    }

}