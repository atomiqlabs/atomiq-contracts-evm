// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../btc_utils/BitcoinTx.sol";
import "../../utils/MathUtils.sol";

import "./BitcoinVaultTransactionData.sol";

contract BitcoinVaultTransactionDataWrapper {

    using BitcoinTxImpl for BitcoinTx;

    function fromTx(BitcoinTx memory btcTx) pure external returns (bool success, BitcoinVaultTransactionData memory data, string memory error) {
        (success, data, error) = BitcoinVaultTransactionDataImpl.fromTx(btcTx);
    }
    
    //Returns hash of this vault data, salted by the transaction id, used as fronting ID
    function hash(BitcoinVaultTransactionData memory self, bytes32 btcTxHash) pure external returns (bytes32 vaultTransactionHash) {
        vaultTransactionHash = BitcoinVaultTransactionDataImpl.hash(self, btcTxHash);
    }

    //Returns full token amounts to be withdrawn from vault, if success=true is returned this implies that there is no overflow
    // when adding all the amounts & fees together!
    function getFullAmounts(BitcoinVaultTransactionData memory self) pure external returns (bool success, uint64 amount0, uint64 amount1) {
        (success, amount0, amount1) = BitcoinVaultTransactionDataImpl.getFullAmounts(self);
    }

}
