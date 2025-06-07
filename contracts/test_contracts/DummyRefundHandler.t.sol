// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../common/IRefundHandler.sol";

contract DummyRefundHandler is IRefundHandler {

    function refund(bytes32 refundData, bytes calldata witness) pure external returns (bytes memory witnessResult) {
        bytes32 witnessBytes;
        assembly {
            witnessBytes := calldataload(witness.offset)
        }
        require(refundData == witnessBytes, "dummyRefundHandler: bad witness");
        return witness;
    }

}
