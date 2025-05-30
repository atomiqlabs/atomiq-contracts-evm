// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./EIP712Sighash.sol";

contract EIP712SighashWrapper is EIP712Sighash {
    function EIP712Sighash_getInitSighash(bytes32 escrowHash, uint256 timeout) view external returns (bytes32 sighash) {
        return _EIP712Sighash_getInitSighash(escrowHash, timeout);
    }
    function EIP712Sighash_getRefundSighash(bytes32 escrowHash, uint256 timeout) view external returns (bytes32 sighash) {
        return _EIP712Sighash_getRefundSighash(escrowHash, timeout);
    }
}
