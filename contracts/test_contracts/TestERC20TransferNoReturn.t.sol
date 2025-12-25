// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// wake-disable-next-line
contract TestERC20TransferNoReturn {
    string public name     = "TestToken";
    string public symbol   = "TTK";
    uint8  public decimals = 18;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);
    
    constructor() {
        _balances[msg.sender] += 1_000_000 ether;
    }

    /**
     * @notice Get the WETH balance of an account
     */
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Approve a spender to spend WETH
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfer WETH to another address
     */
    function transfer(address to, uint256 amount) public virtual {
        _transfer(msg.sender, to, amount);
    }

    /**
     * @notice Transfer WETH on behalf of another address
     */
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: allowance exceeded");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(_balances[from] >= amount, "ERC20: insufficient balance");
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

}
