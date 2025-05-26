// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract EIP712Sighash is EIP712 {
    
    constructor() EIP712("atomiq.exchange", "1") {}

    bytes32 private constant INITIALIZE_STRUCT_TYPE_HASH = keccak256(
        "Initialize(bytes32 swapHash,uint256 timeout)"
    );
    bytes32 private constant REFUND_STRUCT_TYPE_HASH = keccak256(
        "Refund(bytes32 swapHash,uint256 timeout)"
    );

    function _EIP712Sighash_getInitSighash(bytes32 escrowHash, uint256 timeout) view internal returns (bytes32 sighash) {
        sighash = _hashTypedDataV4(keccak256(abi.encode(
            INITIALIZE_STRUCT_TYPE_HASH,
            escrowHash,
            timeout
        )));
    }

    function _EIP712Sighash_getRefundSighash(bytes32 escrowHash, uint256 timeout) view internal returns (bytes32 sighash) {
        sighash = _hashTypedDataV4(keccak256(abi.encode(
            REFUND_STRUCT_TYPE_HASH,
            escrowHash,
            timeout
        )));
    }

}
