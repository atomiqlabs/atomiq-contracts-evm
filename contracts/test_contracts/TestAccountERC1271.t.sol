// SPDX-License-Identifier: Apache-2.0
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.27;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TestAccountERC1271 is IERC1271 {
    address immutable _signer;

    receive() external payable {}

    constructor(address signer) {
        _signer = signer;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        public
        view
        override
        returns (bytes4)
    {
        (address result,,) = ECDSA.tryRecover(hash, signature);
        return result==_signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

}
