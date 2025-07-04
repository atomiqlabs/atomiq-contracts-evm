# EVM bitcoin SPV vault

A vault of funds on EVM that is fully controlled through bitcoin transactions and UTXO chaining. The main purpose of this is to allow [trustless swaps between bitcoin and EVM asset](https://docs.atomiq.exchange/spv-swaps-on-chain).

## Funding

The vault can be funded by depositing tokens to it on the EVM side (doesn't require any bitcoin transaction).

### Tokens

Each vault supports holding 2 tokens (this opinionated approach was choosen due to bitcoin transaction data size limitation - more amounts wouldn't fit in the OP_RETURN data). Token 0 is intended to be the primary token of the vault and Token 1 should be the secondary token - e.g. a native gas token on EVM (e.g. ETH).

### Scaling

Representing token amounts as uint256 on bitcoin would require too many bytes, that's why we represent the tokens as uint64 and use multipliers (pre-specified in the EVM spv vault parameters) to scale the values back to uint256.

## Liquidity fronting

The contract allows for any party to front the withdrawal before it happens. This might be useful when the vault specifies it needs to wait for e.g. 3 confirmations but someone is willing to assume the risk of bitcoin on-chain re-org and front the withdrawal with the withdrawal tx on bitcoin having just 1 confirmation. The withdrawal transaction on bitcoin can also specify a **fronting fee** to be paid to whoever fronts the liquidity, acting as an incentive/risk premium for other parties to perform liquidity fronting.

## Caller/Watchtower fee

The contract allows incentivization of 3rd parties to call claim() function with the most recent withdrawal bitcoin transactions. This is done by specifying a **caller fee** in the withdrawal bitcoin transactions, which is then awarded to the 3rd party which called claim() on this contract.

## Arbitrary execution on the EVM side

The contract allows scheduling arbitrary actions (contract calls) on the EVM side as a result of successful withdrawal, in that case the amount of Token 0 is not transfered directly to recipient but instead to an [execution contract](../execution_contract), with the **execution action hash**, **execution fee** & **execution expiry** provided in the withdrawal bitcoin transaction.

Execution contract is used instead of direct low-level calls because only the hash of the execution action is stored and available on bitcoin, with the actual execution action being published/shared/saved on possibily unreliable medium. If low-level calls were used and execution action data lost this might freeze the specific vault indefinitely (as no execution action satisfying the hash can be submitted). Execution contract has built-in expiry through which a user can still access their funds even when they lose the execution action data.

## Assigning ownership

When a vault is opened, a specific bitcoin UTXO is provided which acts as an ownership control of the vault - i.e. anyone who can spend that UTXO on the bitcoin side is able to withdraw funds out of the vault.

## Withdrawals with bitcoin transactions

To withdraw funds from the vault, a user needs to create a valid bitcoin transaction spending the last defined ownership UTXO as the first input, and committing to the withdrawal data in the transaction OP_RETURN data output.

### Withdrawal data

Withdrawal specifies a set of data:

- **recipient** - recipient of the funds on EVM
- **token 0 amount** - amount of token 0 to send to recipient (scaled by the respective multiplier)
- **token 1 amount** (optional) - amount of token 1 to send to recipient (scaled by the respective multiplier), assumed 0 if omitted
- **execution action hash** (optional) - allows scheduling of arbitrary action on EVM through execution contract, if specified then token 0 amount is not transfered to the recipient but to the execution contract instead
- **caller fee** - fee awarded to 3rd party caller of the claim() function
- **fronting fee** - fee awarded to whoever fronts the liquidity for the withdrawal, if no fronting occurs, it is paid to the recipient
- **execution fee** - fee passed to the execution contract, if execution hash is unspecified it is paid out to the recipient
- **execution expiry** - defines expiry of the scheduled action on execution contract

### Withdrawal transaction format

Minimal withdrawal transaction

```                         
      Inputs:                  Outputs:       
>---- Owner UTXO (input 0) ---+---+-- New owner UTXO (output 0) -->
>------- UTXO (input 1) ------+   +-- OP_RETURN data (output 1) -->
```

Withdrawal has to spend the last owner UTXO defined in the vault. Output 0 is then used as a next owner UTXO for the vault.

#### OP_RETURN (primary data)

We use OP_RETURN in output 1 as a primary way to store/carry data, the following formats are supported (amounts are decoded in big-endian order!):

- OP_RETURN OP_PUSH28 \<**recipient**: address (20-bytes)\> \<**token_0_amount**: uint64\>
- OP_RETURN OP_PUSH36 \<**recipient**: address (20-bytes)\> \<**token_0_amount**: uint64\> \<**token_1_amount**: uint64\>
- OP_RETURN OP_PUSH60 \<**recipient**: address (20-bytes)\> \<**token_0_amount**: uint64\> \<**execution_hash**: bytes32\>
- OP_RETURN OP_PUSH68 \<**recipient**: address (20-bytes)\> \<**token_0_amount**: uint64\> \<**token_1_amount**: uint64\> \<**execution_hash**: bytes32\>

#### Input nSequence (fees)

We use input nSequence fields (only first 2 inputs) to store data about the fees. We use 30 least significant bits of the nSequence for storage. Each fee value has 20-bits. Fees are calculated as \<fee in percentage\> \* 1000 (i.e. 10% is saved as 10,000). Fees are applied to both amounts, except for **execution fee** - which is only used for Token 0, since only Token 0 is deposited to execution contract.

- c - **caller fee**
- e - **execution fee**
- f - **fronting fee** (high order bits are saved in nSequence0, low bits in nSequence1)

Bit view of the nSequences:

```
nSequence0: 10ff ffff ffff cccc cccc cccc cccc cccc
nSequence1: 10ff ffff ffff eeee eeee eeee eeee eeee
```

#### Transaction locktime (execution expiry)

The **execution expiry** is stored in the transaction's locktime field, the **execution expiry** is simply calculated as transaction's locktime + 1,000,000,000.

### Transaction verification

The provided bitcoin withdrawal transactions are verified through a bitcoin light client smart contract ([`/contracts/btc_relay`](../btc_relay)).
