// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import "../common/IClaimHandler.sol";
import "../common/IRefundHandler.sol";

import "./components/EscrowStorage.sol";
import "./components/LpVault.sol";
import "./components/ReputationTracker.sol";
import "./components/EIP712Sighash.sol";

import "./structs/Escrow.sol";

import "./Events.sol";

interface IEscrowManager {
    //Initializes the escrow
    function initialize(EscrowData calldata escrow, bytes calldata signature, uint256 timeout, bytes calldata _extraData) external payable;
    //Claims the escrow by providing a witness to the claim handler
    function claim(EscrowData calldata escrow, bytes calldata witness) external;
    //Refunds the escrow by providing a witness to the refund handler
    function refund(EscrowData calldata escrow, bytes calldata witness) external;
    //Cooperatively refunds the escrow with a valid signature from claimer
    function cooperativeRefund(EscrowData calldata escrow, bytes calldata signature, uint256 timeout) external;
}

contract EscrowManager is EscrowStorage, LpVault, ReputationTracker, EIP712Sighash, IEscrowManager {

    using EscrowDataImpl for EscrowData;

    //_extraData parameter is used for data-availability/propagation of escrow-specific extraneous data on-chain
    // and is therefore unused in the function itself
    function initialize(EscrowData calldata escrow, bytes calldata signature, uint256 timeout, bytes calldata _extraData) external payable {
        //Check expiry
        require(block.timestamp < timeout, "init: Authorization expired");

        //Check committed & commit
        bytes32 escrowHash = _EscrowStorage_commit(escrow);

        //Verify signature
        if(msg.sender==escrow.offerer) {
            //Here we only require signature in case the reputation tracking flag is set,
            // otherwise there is no harm done to the claimer even if he were to be spammed
            // with many escrows
            if(escrow.isTrackingReputation()) {
                require(
                    SignatureChecker.isValidSignatureNow(escrow.claimer, _EIP712Sighash_getInitSighash(escrowHash, timeout), signature),
                    "init: invalid signature"
                );
            }
        } else if(msg.sender==escrow.claimer) {
            //In this case we always require signature because we are taking funds from the offerer
            require(
                SignatureChecker.isValidSignatureNow(escrow.offerer, _EIP712Sighash_getInitSighash(escrowHash, timeout), signature),
                "init: invalid signature"
            );
        } else {
            revert("init: Caller address");
        }

        //Transfer deposit
        uint256 depositAmount = escrow.getTotalDeposit();
        if(depositAmount > 0) {
            //Here we check if the depositToken matches the escrow token, the escrow is payIn and
            // transaction sender is offerer. This is done such that in case native token is used
            // we do not call TransferUtils.transferIn multiple times, which is problematic when
            // just checking msg.value (as the TransferUtils.transferIn does!)
            if(!(escrow.depositToken==escrow.token && escrow.isPayIn() && msg.sender==escrow.offerer)) {
                TransferUtils.transferIn(escrow.depositToken, msg.sender, depositAmount);
                depositAmount = 0;
            }
        }

        //Transfer funds
        _payIn(escrow.offerer, escrow.token, escrow.amount, escrow.isPayIn());

        //Emit event
        emit Events.Initialize(escrow.offerer, escrow.claimer, escrowHash);
    }

    function claim(EscrowData calldata escrow, bytes calldata witness) external {
        //Check committed & finalize
        bytes32 escrowHash = _EscrowStorage_finalize(escrow, true);

        //Check claim data
        bytes memory witnessResult = IClaimHandler(escrow.claimHandler).claim(escrow.claimData, witness);

        //Update reputation
        if(escrow.isTrackingReputation()) {
            _ReputationTracker_updateReputation(ReputationTracker.REPUTATION_SUCCESS, escrow.claimer, escrow.token, escrow.claimHandler, escrow.amount);
        }

        //Pay out claimer bounty
        if(escrow.claimerBounty != 0) {
            TransferUtils.transferOut(escrow.depositToken, msg.sender, escrow.claimerBounty);
        }
        if(escrow.securityDeposit > escrow.claimerBounty) {
            TransferUtils.transferOut(escrow.depositToken, escrow.claimer, escrow.securityDeposit - escrow.claimerBounty);
        }

        _payOut(escrow.claimer, escrow.token, escrow.amount, escrow.isPayOut());

        //Emit event
        emit Events.Claim(escrow.offerer, escrow.claimer, escrowHash, escrow.claimHandler, witnessResult);
    }
    
    function refund(EscrowData calldata escrow, bytes calldata witness) external {
        //Check committed & finalize
        bytes32 escrowHash = _EscrowStorage_finalize(escrow, false);

        //Check refund data
        bytes memory witnessResult = IRefundHandler(escrow.refundHandler).refund(escrow.refundData, witness);

        //Update reputation
        if(escrow.isTrackingReputation()) {
            _ReputationTracker_updateReputation(ReputationTracker.REPUTATION_FAILED, escrow.claimer, escrow.token, escrow.claimHandler, escrow.amount);
        }

        //Pay out security deposit
        if(escrow.securityDeposit != 0) {
            TransferUtils.transferOut(escrow.depositToken, escrow.offerer, escrow.securityDeposit);
        }
        if(escrow.claimerBounty > escrow.securityDeposit) {
            TransferUtils.transferOut(escrow.depositToken, escrow.claimer, escrow.claimerBounty - escrow.securityDeposit);
        }
        
        //Refund funds
        _payOut(escrow.offerer, escrow.token, escrow.amount, escrow.isPayIn());

        //Emit event
        emit Events.Refund(escrow.offerer, escrow.claimer, escrowHash, escrow.refundHandler, witnessResult);
    }

    function cooperativeRefund(EscrowData calldata escrow, bytes calldata signature, uint256 timeout) external {
        //Check expiry
        require(block.timestamp < timeout, "coopRefund: Auth expired");

        //Check committed & finalize
        bytes32 escrowHash = _EscrowStorage_finalize(escrow, false);

        //Check refund signature
        require(
            SignatureChecker.isValidSignatureNow(escrow.claimer, _EIP712Sighash_getRefundSighash(escrowHash, timeout), signature),
            "coopRefund: invalid signature"
        );

        //Update reputation
        if(escrow.isTrackingReputation()) {
            _ReputationTracker_updateReputation(ReputationTracker.REPUTATION_COOP_REFUND, escrow.claimer, escrow.token, escrow.claimHandler, escrow.amount);
        }

        //Pay out the whole deposit
        TransferUtils.transferOut(escrow.depositToken, escrow.claimer, escrow.getTotalDeposit());

        
        //Refund funds
        _payOut(escrow.offerer, escrow.token, escrow.amount, escrow.isPayIn());

        //Emit event
        emit Events.Refund(escrow.offerer, escrow.claimer, escrowHash, address(0x0), "");
    }

    //Internal functions
    function _payOut(address src, address token, uint256 amount, bool payOut) internal {
        if(payOut) {
            TransferUtils.transferOut(token, src, amount);
        } else {
            _LpVault_transferOut(token, src, amount);
        }
    }

    function _payIn(address src, address token, uint256 amount, bool payIn) internal {
        if(payIn) {
            TransferUtils.transferIn(token, src, amount);
        } else {
            _LpVault_transferIn(token, src, amount);
        }
    }

}