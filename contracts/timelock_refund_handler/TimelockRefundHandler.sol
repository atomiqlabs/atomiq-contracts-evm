// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../common/IRefundHandler.sol";

//Refund handler for timestamp based timelocks
//Claim data: C = uint256 expiry timestamp
//Witness: W = empty
contract TimelockRefundHandler is IRefundHandler {
    
    function refund(bytes32 refundData, bytes calldata witness) external view returns (bytes memory witnessResult) {
        require(witness.length==0, "timestampLock: witness len!=0");
        require(block.timestamp > uint256(refundData), "timestampLock: not expired");
        witnessResult = abi.encodePacked(refundData);
    }

}
