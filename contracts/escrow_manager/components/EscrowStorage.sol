// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {EscrowData, EscrowDataImpl} from "../structs/Escrow.sol";
import {EscrowState, EscrowStateImpl} from "../state/EscrowState.sol";

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
    using EscrowStateImpl for EscrowState;

    mapping(bytes32 => EscrowState) _escrowState;

    //Public external functions
    function getState(EscrowData calldata escrowData) external view returns (EscrowState memory result) {
        result = _escrowState[escrowData.hash()];
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
        escrowHash = escrow.hash();
        EscrowState storage escrowState = _escrowState[escrowHash];
        (,,uint8 state) = escrowState.read();
        require(state == STATE_NOT_COMMITTED, "_commit: Already committed");

        //Commit
        escrowState.write(uint64(block.number), 0, STATE_COMMITTED);
    }

    //Finalizes the escrow state on-chain, fails if escrow is not initialized/committed
    function _EscrowStorage_finalize(EscrowData calldata escrow, bool success) internal returns (bytes32 escrowHash) {
        //Check committed
        escrowHash = escrow.hash();
        EscrowState storage escrowState = _escrowState[escrowHash];
        (uint64 initBlockheight,,uint8 state) = escrowState.read();
        require(state == STATE_COMMITTED, "_finalize: Not committed");

        //Set state to claimed
        escrowState.write(initBlockheight, uint64(block.number), success ? STATE_CLAIMED : STATE_REFUNDED);
    }

}
