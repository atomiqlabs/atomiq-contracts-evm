// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {EscrowData, EscrowDataImpl} from "../structs/Escrow.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract EIP712Sighash is EIP712 {

    using EscrowDataImpl for EscrowData;
    
    constructor() EIP712("atomiq.exchange", "1") {}

    bytes32 constant INITIALIZE_STRUCT_TYPE_HASH = keccak256(
        "Initialize(bytes32 swapHash,address offerer,address claimer,uint256 amount,address token,bool payIn,bool payOut,bool trackingReputation,address claimHandler,bytes32 claimData,address refundHandler,bytes32 refundData,uint256 securityDeposit,uint256 claimerBounty,address depositToken,bytes32 claimActionHash,uint256 deadline,bytes32 extraDataHash)"
    );
    bytes32 constant REFUND_STRUCT_TYPE_HASH = keccak256(
        "Refund(bytes32 swapHash,uint256 timeout)"
    );

    function _EIP712Sighash_getInitSighash(EscrowData calldata escrow, bytes32 escrowHash, uint256 timeout, bytes memory _extraData) view internal returns (bytes32 sighash) {
        // The following assembly is equivalent to:
        // bytes32 structHash = keccak256(abi.encode(
        //     INITIALIZE_STRUCT_TYPE_HASH,
        //     escrowHash,
        //     escrow.offerer,
        //     escrow.claimer,
        //     escrow.amount,
        //     escrow.token,
        //     escrow.isPayIn(),
        //     escrow.isPayOut(),
        //     escrow.isTrackingReputation(),
        //     escrow.claimHandler,
        //     escrow.claimData,
        //     escrow.refundHandler,
        //     escrow.refundData,
        //     escrow.securityDeposit,
        //     escrow.claimerBounty,
        //     escrow.depositToken,
        //     escrow.successActionCommitment,
        //     timeout,
        //     keccak256(_extraData)
        // ));
        bytes32 structTypeHash = INITIALIZE_STRUCT_TYPE_HASH;
        bytes32 structHash;
        assembly ("memory-safe") {
            let ptr := mload(0x40)

            //We don't need to allocate memory properly here (with mstore(0x40, newOffset)), 
            // since we only use it as scratch-space for hashing, we can keep the free memory
            // pointer as-is
            // mstore(0x40, add(ptr, 608))

            mstore(ptr, structTypeHash)
            mstore(add(ptr, 32), escrowHash)

            //Save first part of the escrow: offerer, claimer, amount, token
            calldatacopy(add(ptr, 64), escrow, 128)
            
            //Save flags as decoded from the flags field
            let flags := calldataload(add(escrow, 128))
            mstore(add(ptr, 192), and(shr(1, flags), 0x1))
            mstore(add(ptr, 224), and(flags, 0x1))
            mstore(add(ptr, 256), and(shr(2, flags), 0x1))
            
            //Save second part of the escrow: claimHandler, claimData, refundHandler, refundData, securityDeposit, claimerBounty, depositToken, successActionCommitment
            calldatacopy(add(ptr, 288), add(escrow, 160), 256)
            
            mstore(add(ptr, 544), timeout)
            let extraDataHash := keccak256(add(_extraData, 32), mload(_extraData))
            mstore(add(ptr, 576), extraDataHash)
            structHash := keccak256(ptr, 608)
        }
        sighash = _hashTypedDataV4(structHash);
    }

    function _EIP712Sighash_getRefundSighash(bytes32 escrowHash, uint256 timeout) view internal returns (bytes32 sighash) {
        sighash = _hashTypedDataV4(keccak256(abi.encode(
            REFUND_STRUCT_TYPE_HASH,
            escrowHash,
            timeout
        )));
    }

}
