// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./BitcoinMerkleTree.sol";

contract BitcoinMerkleTreeWrapper {

    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof, uint256 index) view external {
        BitcoinMerkleTree.verify(root, leaf, proof, index);
    }

}