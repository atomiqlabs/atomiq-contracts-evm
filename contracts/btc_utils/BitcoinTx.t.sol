// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./BitcoinTx.sol";

contract BitcoinTxWrapper {
    function fromMemory(bytes memory data) pure external returns(BitcoinTx memory result) {
        return BitcoinTxImpl.fromMemory(data);
    }
    function getHash(BitcoinTx memory self) view external returns (bytes32 result) {
        return BitcoinTxImpl.getHash(self);
    }
    function getVersion(BitcoinTx memory self) pure external returns (uint32 result) {
        return BitcoinTxImpl.getVersion(self);
    }
    function getLocktime(BitcoinTx memory self) pure external returns (uint32 result) {
        return BitcoinTxImpl.getLocktime(self);
    }
    function inputsCount(BitcoinTx memory self) pure external returns (uint256) {
        return BitcoinTxImpl.inputsCount(self);
    }
    function getInputUtxo(BitcoinTx memory self, uint256 vin) pure external returns (bytes32, uint32) {
        return BitcoinTxImpl.getInputUtxo(self, vin);
    }
    function getInputNSequence(BitcoinTx memory self, uint256 vin) pure external returns (uint32) {
        return BitcoinTxImpl.getInputNSequence(self, vin);
    }
    function getInputScriptHash(BitcoinTx memory self, uint256 vin) pure external returns (bytes32) {
        return BitcoinTxImpl.getInputScriptHash(self, vin);
    }
    function outputsCount(BitcoinTx memory self) pure external returns (uint256) {
        return BitcoinTxImpl.outputsCount(self);
    }
    function getOutputValue(BitcoinTx memory self, uint256 vout) pure external returns (uint64) {
        return BitcoinTxImpl.getOutputValue(self, vout);
    }
    function getOutputScriptHash(BitcoinTx memory self, uint256 vout) pure external returns (bytes32) {
        return BitcoinTxImpl.getOutputScriptHash(self, vout);
    }
    function getOutputScript(BitcoinTx memory self, uint256 vout) pure external returns (bytes memory) {
        return BitcoinTxImpl.getOutputScript(self, vout);
    }
}
