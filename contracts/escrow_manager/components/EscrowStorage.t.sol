// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../structs/Escrow.sol";
import "../state/EscrowState.sol";
import "./EscrowStorage.sol";

contract EscrowStorageWrapper is EscrowStorage {
    function EscrowStorage_commit(EscrowData calldata escrow) external returns (bytes32 escrowHash) {
        return _EscrowStorage_commit(escrow);
    }
    function EscrowStorage_finalize(EscrowData calldata escrow, bool success) internal returns (bytes32 escrowHash) {
        return _EscrowStorage_finalize(escrow, success);
    }
}
