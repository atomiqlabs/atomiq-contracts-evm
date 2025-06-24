# Claim handler for bitcoin chain txId

## Provided data

Commitment/claim_data: C = keccak256 hash of the following struct packed encoded
```solidity
{
    bytes32 txHash;
    uint32 confirmations;
    address btcRelayContract;
}
```

Witness: W = witness struct, encoded as packed
```solidity
{
    //Commitment
    bytes32 txHash;
    uint32 confirmations;
    address btcRelayContract;

    StoredBlockHeader blockheader;
    uint32 position;
    bytes32[] merkleProof;
}
```

## Logic

Suceeds if:
- the commitment specified in the witness W, correctly hashes to the commitment C, poseidon(W)==C
- stored __blockheader__ is part of the cannonical chain in the __btcRelayContract__ smart contract and has at least __confirmations__ as specified in the witness struct
- the __txHash__ is included in the blockheader as verified with the __merkleProof__
