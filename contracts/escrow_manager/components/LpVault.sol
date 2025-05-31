// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../transfer_utils/TransferUtils.sol";

struct LpVaultBalanceQuery {
    address owner;
    address token;
}

interface ILpVault {
    //Deposit funds to the LP vault
    function deposit(address token, uint256 amount) external payable;
    //Withdraw funds from the LP vault
    function withdraw(address token, uint256 amount, address destination) external;
    //Returns LP vault balances, the data parameter is in the format (owner, tokenAddress)
    function getBalance(LpVaultBalanceQuery[] calldata data) external view returns (uint256[] memory balances);
}

contract LpVault is ILpVault {

    mapping(address => mapping(address => uint256)) _lpVault;

    //Public external functions
    function deposit(address token, uint256 amount) external payable {
        _lpVault[msg.sender][token] += amount;
        TransferUtils.transferIn(token, msg.sender, amount);
    }

    function withdraw(address token, uint256 amount, address destination) external {
        _lpVault[msg.sender][token] -= amount; //This anyway reverts if sender doesn't have enough balance due to safe arithmetics
        TransferUtils.transferOut(token, destination, amount);
    }

    function getBalance(LpVaultBalanceQuery[] calldata data) external view returns (uint256[] memory balances) {
        balances = new uint256[](data.length);
        for(uint i = 0; i < data.length; i++) {
            balances[i] = _lpVault[data[i].owner][data[i].token];
        }
    }

    //Internal functions
    function _LpVault_transferOut(address token, address dst, uint256 amount) internal {
        _lpVault[dst][token] += amount;
    }

    function _LpVault_transferIn(address token, address dst, uint256 amount) internal {
        _lpVault[dst][token] -= amount; //This anyway reverts if sender doesn't have enough balance due to safe arithmetics
    }

}
