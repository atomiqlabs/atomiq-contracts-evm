# atomiq.exchange EVM contracts

atomiq.exchange enables trustless swaps between smart chains (chains supporting complex smart contracts - Solana, EVM, Starknet, etc.) and Bitcoin (both on-chain - L1 and lightning network - L2). On-chain swaps are based on an escrow system (similar to atomic swaps) and utilize [permissionless bitcoin light clients](/contracts/btc_relay) deployed on smart chains to secure swaps. Lightning network swaps use HTLC atomic swaps. Please refer to our [docs](https://docs.atomiq.exchange/) for detailed system overview.

## Contracts structure

### Escrow manager

Manages initialization, claiming & refunds of swap escrows, LP vaults & reputation tracking:
- Escrow - structure holding funds, can be claimed by __claimer__ (the intended recipient of the escrow funds) upon satisfying the conditions as set in the __claim handler__ (external contract) used for the escrow & can be refunded by the __offerer__ (who funded the escrow), upon satisfying the conditions as set in the __refund handler__ (external contract) used in the escrow. Escrow can also be cooperatively closed with the __claimer__'s signature, immediately returning funds to __offerer__ and skipping refund handler verification.
- LP vault - funds deposited into the smart contract by the LPs (intermediary nodes), that can be used for swaps
- Reputation tracking - the contract tracks count & volume of swaps with a specific outcome (success, failed, cooperative_close), enabling users to identify LPs that fail to process swaps often.

Also supports safe execution of arbitrary contract calls through execution proxy library on claim, such that funds can be directly used to swap on AMM, deposit to lending pool, etc.

### Claim handlers

Set the conditions that need to be satisfied by the __claimer__ before they are able to claim the swap funds. The escrow contains the address of a specific claim handler to be used, along with a commitment to the conditions that need to be satisified. In order to claim the __claimer__ provides a witness that satisfies the conditions set forth by the claim handler.

### Refund handlers

Set the conditions that need to be satisfied by the __offerer__ before they are able to refund the swap funds. The escrow contains the address of a specific refund handler to be used, along with a commitment to the conditions that need to be satisified. In order to refund the __offerer__ provides a witness that satisfies the conditions set forth by the refund handler.

### Spv swap vault

Implementation of the [new __BTC (on-chain) -> SC__ swap protocol](https://docs.atomiq.exchange/spv-swaps-on-chain), using UTXO connectors to assign ownership to the EVM swap vault, enabling PSBT-based cross-chain swaps which require no liquidity pre-locking from the LP.

Also supports scheduling of arbitrary contract call execution using execution contract, this is purposefully externalized to the execution contract, because of no data-availability guarantees of the actual execution action data.

## Contents

### Libraries

- [`/contracts/btc_utils`](/contracts/btc_utils) - bitcoin utilities (bitcoin SPV merkle tree verification & transaction parsing)
- [`/contracts/common`](/contracts/common) - common (claim & refund handler interfaces)
- [`/contracts/erc20_utils`](/contracts/transfer_utils) - erc20 & native token transfer utilities (transfer from, transfer, approve & balance)
- [`/contracts/utils`](/contracts/utils) - math utilities (saturating, checked, unchecked subtractions, additions, efficient uint256 max calculation)
- [`/contracts/execution_proxy`](/contracts/execution_proxy) - execution proxy base (allows safe execution of arbitrary contract call through a proxy contract)

### Smart contracts

- [`/contracts/btc_relay`](/contracts/btc_relay) - bitcoin relay (bitcoin SPV light client)
- [`/contracts/escrow_manager`](/contracts/escrow_manager) - escrow manager (handling swap escrows, lp vaults & reputation)
- Refund handlers:
    - [`/contracts/timelock_refund_handler`](/contracts/timelock_refund_handler) - allows refund after a specifed timestamp, used by all current swaps.
- Claim handlers:
    - [`/contracts/hashlock_claim_handler`](/contracts/hashlock_claim_handler) - claim based on the knowledge of a secret preimage of a sha256 hash, __BTC (lightning) -> SC__ & __SC -> BTC (lightning)__ swaps.
    - [`/contracts/btc_txid_claim_handler`](/contracts/btc_txid_claim_handler) - claim based on the confirmation of a specific transaction id on the bitcoin chain, as verified through the btc_relay contract, currently not used, future uses include ordinals/runes/rgb/taro swaps.
    - [`/contracts/btc_output_claim_handler`](/contracts/btc_output_claim_handler) - claim based on the confirmation of a transaction containing a pre-specified output script & amount on the bitcoin chain, as verified through the btc_relay contract, used for __BTC (on-chain) -> SC__ swaps.
    - [`/contracts/btc_nonced_output_claim_handler`](/contracts/btc_nonced_output_claim_handler) - claim based on the confirmation of a transaction containing a pre-specified output script & amount + pre-specified nonce (a combination of transaction's timelock & input's nSequence) on the bitcoin chain, as verified through the btc_relay contract, used for __SC -> BTC (on-chain)__ swaps.
- [`/contracts/spv_swap_vault`](/contracts/spv_swap_vault) - SPV vault connector-based cross-chain swap handler (implements new swap protocol for __BTC (on-chain) -> SC__ swaps)
- [`/contracts/execution_contract`](/contracts/execution_contract) - safe execution scheduler (used by spv_swap_vault to safely schedule and execute execution actions on claim)

## Tests

In order to test the contracts simply run `npx hardhat test`, this will use hardhat to test all the contracts and libraries.
