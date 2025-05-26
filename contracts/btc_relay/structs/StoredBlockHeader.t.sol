// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import "./StoredBlockHeader.sol";
import "./BlockHeader.sol";

contract StoredBlockHeaderTestWrapper {
    using StoredBlockHeaderImpl for bytes;

    function tStoredBlockheader(bytes memory storedblockheader, bytes calldata headers) public {
        // console.log("%x", uint256(headers.dblSha256Hash(0)));
        storedblockheader.updateChain(headers, 0, 1800000000);
    }

}

contract StoredBlockHeaderTest is Test {

    using StoredBlockHeader for bytes;
    StoredBlockHeaderTestWrapper wrapper;

    function setUp() public {
        wrapper = new StoredBlockHeaderTestWrapper();
    }

    function test_storedBlockheaderRead() public {
        bytes memory storedblockheader = hex"00000020a5376a85ea4e0b982e5305d0fb17b57307d7b4e20398000000000000000000001d5649615cffcd110ad492ae83c54034f12d41f44dd69094c875b750539e1031f65afc58731c02187a15fac4000000000000000000000000000000000000000000501ba97ac01f852a2537100007111b58eee9a658fc438658fc45de58fc483658fc4a8e58fc4ce658fc4f3e58fc519658fc53ee58fc564658fc589e";
        // console.log("%x", uint256(storedblockheader.headerDblSha256Hash()));
        bytes memory headers = hex"00000020da44094fbe83dd0c7567d2dede1cd632a844eecdc80469b2d38173a38adb6d37fc5bfc58731c021805c5ce0a";
        wrapper.tStoredBlockheader(storedblockheader, headers);
    }

}
