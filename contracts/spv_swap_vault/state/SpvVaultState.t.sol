// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../structs/SpvVaultParameters.sol";

import "./SpvVaultState.sol";

contract SpvVaultStateWrapper {

    SpvVaultState _self;

    using SpvVaultStateImpl for SpvVaultState;

    function isOpened(SpvVaultState memory self) external returns (bool opened) {
        _self = self;
        opened = _self.isOpened();
    }

    function checkOpenedAndParams(SpvVaultState memory self, SpvVaultParameters calldata vaultParams) external {
        _self = self;
        _self.checkOpenedAndParams(vaultParams);
    }

    function open(SpvVaultState memory self, SpvVaultParameters calldata vaultParams, bytes32 utxoTxHash, uint32 utxoVout) external returns (SpvVaultState memory result) {
        _self = self;
        _self.open(vaultParams, utxoTxHash, utxoVout);
        result = _self;
    }

    function close(SpvVaultState memory self) external returns (SpvVaultState memory result) {
        _self = self;
        _self.close();
        result = _self;
    }

    function withdraw(
        SpvVaultState memory self, bytes32 btcTxHash, uint32 vout, uint64 rawAmount0, uint64 rawAmount1
    ) external returns (SpvVaultState memory result, bool success, uint32 _withdrawCount, string memory error) {
        _self = self;
        (success, _withdrawCount, error) = _self.withdraw(btcTxHash, vout, rawAmount0, rawAmount1);
        result = _self;
    }

    function deposit(
        SpvVaultState memory self, uint64 rawAmount0, uint64 rawAmount1
    ) external returns (SpvVaultState memory result, uint32 depositCount) {
        _self = self;
        depositCount = _self.deposit(rawAmount0, rawAmount1);
        result = _self;
    }

}
