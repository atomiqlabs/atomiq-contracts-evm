// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./structs/Execution.sol";
import "../execution_proxy/structs/ExecutionAction.sol";
import "../execution_proxy/ExecutionProxy.sol";
import "../transfer_utils/TransferUtils.sol";
import "./Events.sol";
import "../execution_proxy/Executor.sol";

interface IExecutionContract {
    //Creates a new execution
    function create(address owner, bytes32 salt, Execution calldata execution) external payable;

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

contract ExecutionContract is Executor {

    using ExecutionImpl for Execution;
    using ExecutionActionImpl for ExecutionAction;

    //Stores hash commitments of the scheduled executions
    mapping(address => mapping(bytes32 => bytes32)) executionCommitments;

    function create(address owner, bytes32 salt, Execution calldata execution) external payable {
        //Make sure execution not yet initialized
        require(executionCommitments[owner][salt]==bytes32(0x0), "create: Already initiated");

        //Commit execution
        bytes32 executionHash = execution.hash();
        executionCommitments[owner][salt] = executionHash;

        //Transfer token amount to the contract
        uint256 totalAmount = execution.amount + execution.executionFee;
        TransferUtils.transferIn(execution.token, msg.sender, totalAmount);

        //Emit event
        emit Events.ExecutionCreated(owner, salt, executionHash);
    }

    function execute(address owner, bytes32 salt, Execution calldata execution, ExecutionAction calldata executionAction) external {
        //Check if already processed, or not scheduled
        bytes32 executionHash = execution.hash();
        require(executionCommitments[owner][salt]==executionHash, "execute: Not scheduled");

        //Check if hash matches
        require(execution.executionActionHash == executionAction.hash(), "execute: Invalid executionAction");
        
        //Clear execution
        delete executionCommitments[owner][salt];

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
        require(executionCommitments[owner][salt]==executionHash, "refundExp: Not scheduled");

        //Clear execution
        delete executionCommitments[owner][salt];
        
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
        require(executionCommitments[msg.sender][salt]==executionHash, "refund: Not scheduled");

        //Clear execution
        delete executionCommitments[msg.sender][salt];
        
        //Transfer full amount & execution fee to caller/owner
        TransferUtils.transferOut(execution.token, msg.sender, execution.amount + execution.executionFee);

        //Emit event
        emit Events.ExecutionProcessed(msg.sender, salt, executionHash, false, "");
    }

    function getExecutionCommitmentHash(address owner, bytes32 salt) external view returns (bytes32) {
        return executionCommitments[owner][salt];
    }

}
