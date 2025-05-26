// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import "forge-std/console.sol";
import "./Nbits.sol";

contract NbitsTest is Test {

    function test_toNbits() public {
        Nbits.toNbits(0x92340000);
        // console.log("%x", );
    }

}
