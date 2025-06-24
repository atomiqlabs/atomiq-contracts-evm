# Refund handler for timestamp based timelocks

## Provided data

Commitment/claim_data: C = uint256 expiry timestamp
Witness: W = empty

## Logic

Suceeds when the current block's timestamp is larger than the u64 expiry timestamp specified in commitment C.

