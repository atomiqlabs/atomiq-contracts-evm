// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library MathUtils {

    function saturatingAddOneUint32(uint32 a) pure internal returns (uint32 result) {
        assembly {
            result := add(a, lt(a, 0xffffffff))
        }
    }

    function saturatingAddUint224(uint224 a, uint256 b) pure internal returns (uint224 result) {
        assembly {
            let c := add(a, b)
            let overflow := or(lt(c, a), gt(c, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff))
            result := add(
                mul(overflow, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff), //Set value to 0xffffffff on overflow
                mul(iszero(overflow), c) //Set the resulting value if no overflow happens
            )
        }
    }

    function maxUint256(uint256 a, uint256 b) pure internal returns (uint256 result) {
        assembly {
            let aGt := gt(a, b)
            result := add(mul(aGt, a), mul(iszero(aGt), b))
        }
    }

}