// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

library MathUtils {

    function castToUint64(uint256 value) pure internal returns (bool success, uint64 result) {
        assembly {
            success := lt(value, 0x10000000000000000)
            result := value
        }
    }

    function checkedSubUint64(uint64 a, uint256 b) pure internal returns (bool success, uint64 result) {
        assembly {
            success := iszero(lt(a, b))
            result := sub(a, b)
        }
    }

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
                mul(overflow, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff), //Set value to 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff on overflow
                mul(iszero(overflow), c) //Set the resulting value if no overflow happens
            )
        }
    }

    function maxUint256(uint256 a, uint256 b) pure internal returns (uint256 result) {
        assembly {
            result := b
            if gt(a, b) {
                result := a
            }
        }
    }

}