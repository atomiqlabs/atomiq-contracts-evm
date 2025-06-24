# Claim handler for bitcoin chain nonced output

## Nonce

A nonce in this context is derived from the the transaction's timelock & first input's nSequence:
- nonce n is computed as n = ((locktime - 500,000,000) << 24) | (nSequence & 0x00FFFFFF)
- first 4 bits of the nSequence need to be set for the first input (ensuring nSequence has no consensus meaning)

## Provided data

Commitment/claim_data: C = keccak256 hash of the following struct packed encoded
```solidity
{
    bytes32 txoHash; //txoHash = keccak256(uint64 nonce || uint64 outputAmount || keccak256(bytes outputScript))
    uint32 confirmations;
    address btcRelayContract;
}
```

Witness: W = witness struct, encoded as packed
```solidity
{
    //Commitment
    bytes32 txoHash; //txoHash = keccak256(uint64 nonce || uint64 outputAmount || keccak256(bytes outputScript))
    uint32 confirmations;
    address btcRelayContract;

    StoredBlockHeader blockheader;
    uint32 vout;
    bytes transaction;
    uint32 position;
    bytes32[] merkleProof;
}
```

## Logic

Suceeds if:
- the commitment specified in the witness W, correctly hashes to the commitment C, keccak256(W)==C
- stored __blockheader__ is part of the cannonical chain in the __btcRelayContract__ smart contract and has at least __confirmations__ as specified in the witness struct
- the provided __transaction__'s transaction ID is included in the blockheader as verified with the __merkleProof__
- the __transaction__ contains valid output at the specified __vout__ index and a valid nonce, such that keccak256(uint64 nonce || uint64 outputAmount || keccak256(bytes outputScript))==__txoHash__
