// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import "./BitcoinMerkleTree.sol";

contract BitcoinMerkleTreeTest is Test {

    function getMerkleRoot(bytes32 leaf, bytes32[] calldata proof, uint256 index) public returns (uint256) {
        uint256 startGas = gasleft();
        BitcoinMerkleTree.getMerkleRoot(leaf, proof, index);
        return startGas - gasleft();
    }

    function test_getMerkleRoot() public returns (uint256) {
        bytes32[] memory proof = new bytes32[](10);
        proof[0] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[1] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[2] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[3] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[4] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[5] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[6] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[7] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[8] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        proof[9] = 0xee25997c2520236892c6a67402650e6b721899869dcf6715294e98c0b45623f9;
        return BitcoinMerkleTreeTest(address(this)).getMerkleRoot(
            0xacf931fe8980c6165b32fe7a8d25f779af7870a638599db1977d5309e24d2478,
            proof,
            414
        );
    }

}