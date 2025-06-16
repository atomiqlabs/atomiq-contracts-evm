// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../utils/MathUtils.sol";

//Escrow data, this is hashed and used as a storage key for the escrow state mapping
struct EscrowData {
    //Account funding the escrow
    address offerer;
    //Account entitled to claim the funds from the escrow
    address claimer;

    //Amount of tokens in the escrow
    uint256 amount;
    //Token of the escrow
    address token;

    //Misc escrow data flags, currently defined: payIn, payOut, reputation.
    //It is recommended to randomize the other unused bits in the flags to act as a salt,
    // such that no 2 escrow data are the same, even if all the other data in them match. 
    uint256 flags;

    //Address of the IClaimHandler deciding if this escrow is claimable
    address claimHandler;
    //Data provided to the claim handler along with the witness to check claimability
    bytes32 claimData;

    //Address of the IRefundHandler deciding if this escrow is refundable
    address refundHandler;
    //Data provided to the refund handler along with the witness to check for refundability
    bytes32 refundData;

    //Security deposit taken by the offerer if swap expires without claimer claiming (i.e. options premium)
    uint256 securityDeposit;
    //Claimer bounty that can be claimed by a 3rd party claimer if he were to claim this swap on behalf of claimer
    uint256 claimerBounty;
    //Deposit token of the swap used for securityDeposit and claimerBounty
    address depositToken;

    //ExecutionAction hash commitment to be executed on claim, left 0x0 if no execution should happen on claim
    bytes32 successActionCommitment;
}
uint256 constant EscrowDataByteLength = 416;

library EscrowDataImpl {
    uint256 internal constant FLAG_PAY_OUT = 0x01;
    uint256 internal constant FLAG_PAY_IN = 0x02;
    uint256 internal constant FLAG_REPUTATION = 0x04;

    //A keccak256 hash of the struct, used as a key for mapping storing the escrow state
    function hash(EscrowData calldata self) pure internal returns (bytes32 result) {
        //The following assembly block is an equivalent to:
        // result = keccak256(abi.encode(self));
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            //We don't need to allocate memory properly here (with mstore(0x40, newOffset)), 
            // since we only use it as scratch-space for hashing, we can keep the free memory
            // pointer as-is
            // mstore(0x40, add(ptr, EscrowDataByteLength))
            calldatacopy(ptr, self, EscrowDataByteLength)
            result := keccak256(ptr, EscrowDataByteLength)
        }
    }

    //Checks if the payIn flag is set
    function isPayIn(EscrowData calldata self) pure internal returns (bool result) {
        result = self.flags & FLAG_PAY_IN == FLAG_PAY_IN;
    }

    //Checks if the payOut flag is set
    function isPayOut(EscrowData calldata self) pure internal returns (bool result) {
        result = self.flags & FLAG_PAY_OUT == FLAG_PAY_OUT;
    }

    //Checks if the reputation flag is set
    function isTrackingReputation(EscrowData calldata self) pure internal returns (bool result) {
        result = self.flags & FLAG_REPUTATION == FLAG_REPUTATION;
    }

    //Returns total deposit, since only one of security_deposit (on claim) & claimer_bounty (on refund) can ever be paid
    // we use maximum of the two as the amount of funds in gas token that needs to be transfered to the escrow
    function getTotalDeposit(EscrowData calldata self) pure internal returns (uint256 amount) {
        amount = MathUtils.maxUint256(self.claimerBounty, self.securityDeposit);
    }
}
