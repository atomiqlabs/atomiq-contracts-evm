// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library Nbits {

    //Calculates difficulty target from nBits
    //Description: https://btcinformation.org/en/developer-reference#target-nbits
    //This implementation panics on negative and overflown targets
    function toTarget(uint256 nbits) pure internal returns (uint256 target) {
        assembly {
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
        }
        require(target == 0 || nbits & 0x8000 == 0, "Nbits: negative");
    }

    //Compresses difficulty target to nBits
    //Description: https://btcinformation.org/en/developer-reference#target-nbits
    function toNbits(uint256 target) pure internal returns (uint256 nbits) {
        assembly {
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
    }

}