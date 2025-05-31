// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../structs/Escrow.sol";
import "../state/EscrowState.sol";

interface IEscrowStorageView {
    function getState(EscrowData calldata escrowData) external view returns (EscrowState memory result);
    function getHashState(bytes32 escrowHash) external view returns (EscrowState memory result);
    function getHashStateMultiple(bytes32[] calldata escrowHash) external view returns (EscrowState[] memory result);
}

contract EscrowStorage is IEscrowStorageView {
    uint8 internal constant STATE_NOT_COMMITTED = 0;
    uint8 internal constant STATE_COMMITTED = 1;
    uint8 internal constant STATE_CLAIMED = 2;
    uint8 internal constant STATE_REFUNDED = 3;

    using EscrowDataImpl for EscrowData;

    mapping(bytes32 => EscrowState) _escrowState;

    //Public external functions
    function getState(EscrowData calldata escrowData) external view returns (EscrowState memory result) {
        result = _escrowState[escrowData.getStructHash()];
    }

    function getHashState(bytes32 escrowHash) external view returns (EscrowState memory result) {
        result = _escrowState[escrowHash];
    }

    function getHashStateMultiple(bytes32[] calldata escrowHash) external view returns (EscrowState[] memory result) {
        result = new EscrowState[](escrowHash.length);
        for(uint i = 0; i < escrowHash.length; i++) {
            result[i] = _escrowState[escrowHash[i]];
        }
    }

    //Internal functions
    
    //Commits/saves the escrow to the on-chain storage with COMMITTED state, fails if 
    // escrow is/was already initialized
    function _EscrowStorage_commit(EscrowData calldata escrow) internal returns (bytes32 escrowHash) {
        //Check if already committed
        escrowHash = escrow.getStructHash();
        require(_escrowState[escrowHash].state == STATE_NOT_COMMITTED, "_commit: Already committed");

        //Commit
        _escrowState[escrowHash] = EscrowState({
            state: STATE_COMMITTED,
            initBlockheight: uint64(block.number),
            finishBlockheight: 0
        });
    }

    //Finalizes the escrow state on-chain, fails if escrow is not initialized/committed
    function _EscrowStorage_finalize(EscrowData calldata escrow, bool success) internal returns (bytes32 escrowHash) {
        //Check committed
        escrowHash = escrow.getStructHash();
        EscrowState memory escrowState = _escrowState[escrowHash];
        require(escrowState.state == STATE_COMMITTED, "_finalize: Not committed");

        //Set state to claimed
        escrowState.state = success ? STATE_CLAIMED : STATE_REFUNDED;
        escrowState.finishBlockheight = uint64(block.number);
        _escrowState[escrowHash] = escrowState;
    }

}
