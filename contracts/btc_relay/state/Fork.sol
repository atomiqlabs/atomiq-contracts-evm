pragma solidity ^0.8.28;

struct Fork {
    mapping(uint256 => bytes32) chain;
    uint32 startHeight;
    uint32 tipHeight;
}
