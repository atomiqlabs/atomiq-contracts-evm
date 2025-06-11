// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

struct Fork {
    mapping(uint256 => bytes32) chain;
    uint32 startHeight;
    uint32 tipHeight;
}

library ForkImpl {

    //Deletes startHeight and tipHeight saved in the fork storage slot
    function remove(Fork storage self) internal {
        assembly {
            sstore(add(self.slot, 1), 0)
        }
    }

}
