# Claim handler for hashlocks

## Provided data

Commitment/claim_data: C = bytes32 representation of the sha256 hash of a pre-image
Witness: W = bytes32 representation of the preimage to the sha256 hash

## Logic

Suceeds when the provided witness W properly hashes to commitment C, such that sha256(W)==C
