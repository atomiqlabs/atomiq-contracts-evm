import "deploy-yul/YulDeployer.sol";

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import "./btc_relay/BtcRelay.sol";

contract ContractBTest is Test {
    YulDeployer yulDeployer = new YulDeployer();
    address contractAddress;

    function setUp() public {
        contractAddress = yulDeployer.deployContract("BtcRelay", hex"00000020a5376a85ea4e0b982e5305d0fb17b57307d7b4e20398000000000000000000001d5649615cffcd110ad492ae83c54034f12d41f44dd69094c875b750539e1031f65afc58731c02187a15fac4000000000000000000000000000000000000000000501ba97ac01f852a2537100007111b58eee9a658fc438658fc45de58fc483658fc4a8e58fc4ce658fc4f3e58fc519658fc53ee58fc564658fc589e");
    }

    function test_yul() public {
        vm.warp(1841070800);
        IBtcRelay(contractAddress).submitMainBlockheaders(hex"00000020a5376a85ea4e0b982e5305d0fb17b57307d7b4e20398000000000000000000001d5649615cffcd110ad492ae83c54034f12d41f44dd69094c875b750539e1031f65afc58731c02187a15fac4000000000000000000000000000000000000000000501ba97ac01f852a2537100007111b58eee9a658fc438658fc45de58fc483658fc4a8e58fc4ce658fc4f3e58fc519658fc53ee58fc564658fc589e00000020da44094fbe83dd0c7567d2dede1cd632a844eecdc80469b2d38173a38adb6d37fc5bfc58731c021805c5ce0a");
        // (uint256 result) = abi.decode(returnData, (uint256));
        // console.log("%x", result);
        // assertEq(result, 1);
    }
}
