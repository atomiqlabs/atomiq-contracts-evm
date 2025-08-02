// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Execution, ExecutionImpl} from "./structs/Execution.sol";
import {ExecutionAction, ExecutionActionImpl} from "../execution_proxy/structs/ExecutionAction.sol";
import {ExecutionProxy} from "../execution_proxy/ExecutionProxy.sol";
import {TransferUtils} from "../transfer_utils/TransferUtils.sol";
import {Events} from "./Events.sol";
import {Executor} from "../execution_proxy/Executor.sol";

interface IExecutionContract {
    //Creates a new execution
    function create(address owner, bytes32 creatorSalt, Execution calldata execution) external payable;

    //Execute calls on behalf of owner
    function execute(address owner, bytes32 salt, Execution calldata execution, ExecutionAction calldata executionAction) external;
    //Reclaims the deposited tokens held by the execution contract, anyone can call after expiry
    function refundExpired(address owner, bytes32 salt, Execution calldata execution) external;
    //Reclaims the deposited tokens held by the execution contract, only callable by owner
    function refund(bytes32 salt, Execution calldata execution) external;
}

interface IExecutionContractView {
    function getExecutionCommitmentHash(address owner, bytes32 salt) external view returns (bytes32);
}

contract ExecutionContract is Executor, IExecutionContract, IExecutionContractView {

    using ExecutionImpl for Execution;
    using ExecutionActionImpl for ExecutionAction;

    //Stores hash commitments of the scheduled executions
    mapping(address => mapping(bytes32 => bytes32)) _executionCommitments;

    function create(address owner, bytes32 creatorSalt, Execution calldata execution) external payable {
        //Compute the actual salt from the sender address and provided creator_salt,
        // this ensures that no one else can try to front-run the execution creation
        // and block the actual execution from being created
        bytes32 salt = _getSalt(creatorSalt);

        //Make sure execution not yet initialized
        require(_executionCommitments[owner][salt]==bytes32(0x0), "create: Already initiated");

        //Commit execution
        bytes32 executionHash = execution.hash();
        _executionCommitments[owner][salt] = executionHash;

        //Transfer token amount to the contract
        uint256 totalAmount = execution.amount + execution.executionFee;
        TransferUtils.transferIn(execution.token, msg.sender, totalAmount);

        //Emit event
        emit Events.ExecutionCreated(owner, salt, executionHash);
    }

    function execute(address owner, bytes32 salt, Execution calldata execution, ExecutionAction calldata executionAction) external {
        //Check if already processed, or not scheduled
        bytes32 executionHash = execution.hash();
        require(_executionCommitments[owner][salt]==executionHash, "execute: Not scheduled");

        //Check if hash matches
        require(execution.executionActionHash == executionAction.hash(), "execute: Invalid executionAction");
        
        //Clear execution
        delete _executionCommitments[owner][salt];

        //Transfer execution fee to caller
        TransferUtils.transferOut(execution.token, msg.sender, execution.executionFee);

        //Execute the success action
        (bool success, bytes memory callError) = _execute(execution.token, execution.amount, executionAction, owner);
        
        emit Events.ExecutionProcessed(owner, salt, executionHash, success, callError);
    }

    function refundExpired(address owner, bytes32 salt, Execution calldata execution) external {
        //Check if already expired
        require(execution.expiry <= block.timestamp, "refundExp: Not expired yet");

        //Check if already processed, or not scheduled
        bytes32 executionHash = execution.hash();
        require(_executionCommitments[owner][salt]==executionHash, "refundExp: Not scheduled");

        //Clear execution
        delete _executionCommitments[owner][salt];
        
        //Transfer execution fee to caller
        TransferUtils.transferOut(execution.token, msg.sender, execution.executionFee);

        //Transfer funds back to owner
        TransferUtils.transferOut(execution.token, owner, execution.amount);

        //Emit event
        emit Events.ExecutionProcessed(owner, salt, executionHash, false, "");
    }

    function refund(bytes32 salt, Execution calldata execution) external {
        //Owner needs to be caller in this case!
        //Check if already processed, or not scheduled
        bytes32 executionHash = execution.hash();
        require(_executionCommitments[msg.sender][salt]==executionHash, "refund: Not scheduled");

        //Clear execution
        delete _executionCommitments[msg.sender][salt];
        
        //Transfer full amount & execution fee to caller/owner
        TransferUtils.transferOut(execution.token, msg.sender, execution.amount + execution.executionFee);

        //Emit event
        emit Events.ExecutionProcessed(msg.sender, salt, executionHash, false, "");
    }

    function getExecutionCommitmentHash(address owner, bytes32 salt) external view returns (bytes32) {
        return _executionCommitments[owner][salt];
    }

    //Computes salt based on the creator-provided salt and caller address (msg.sender)
    function _getSalt(bytes32 creatorSalt) internal view returns (bytes32 salt) {
        //The following assembly block is the equivalent to:
        // salt = keccak256(abi.encode(msg.sender, creatorSalt));
        assembly ("memory-safe") {
            mstore(0, caller())
            mstore(32, creatorSalt)
            salt := keccak256(0, 64)
        }
    }

}
