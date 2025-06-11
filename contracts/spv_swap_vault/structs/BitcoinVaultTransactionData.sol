// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../btc_utils/BitcoinTx.sol";

struct BitcoinVaultTransactionData {
    address recipient;
    uint64[2] amount;
    uint64[2] callerFee;
    uint64[2] frontingFee;
    uint64 executionHandlerFeeAmount0;
    bytes32 executionHash;
    uint256 executionExpiry;
}

library BitcoinVaultTransactionDataImpl {

    using BitcoinTxImpl for BitcoinTx;

    function fromTx(BitcoinTx memory btcTx) pure internal returns (bool success, BitcoinVaultTransactionData memory data, string memory error) {
        //Extract data from the OP_RETURN, which should be output with index 1
        if(btcTx.outputsCount() < 2) return (false, data, "txData: output count <2");
        if(btcTx.inputsCount() < 2) return (false, data, "txData: input count <2");

        bytes memory btcTxData = btcTx.data;

        //Make sure output has correct format, starts with OP_RETURN
        (uint256 output1ScriptOffset, uint256 output1ScriptLength) = btcTx.getOutputScriptOffsets(1);
        if(output1ScriptLength == 0) return (false, data, "txData: output 1 empty script");
        if(btcTxData[output1ScriptOffset] != 0x6a) return (false, data, "txData: output 1 not OP_RETURN");

        //Use input 0 & 1 nSequences to determine fees: caller fee, fronting fee, execution handler fee
        // input 0 nsequence: <ignored> <b0 fronting fee> <b0 caller fee> <b1 caller fee>
        // input 1 nsequence: <ignored> <b1 fronting fee> <b0 execution fee> <b1 execution fee>
        uint256 input0nSequence = btcTx.getInputNSequence(0);
        uint256 input1nSequence = btcTx.getInputNSequence(1);

        //nSequence0: 10xx xxxx xxxx yyyy yyyy yyyy yyyy yyyy
        //nSequence1: 10xx xxxx xxxx zzzz zzzz zzzz zzzz zzzz
        uint256 callerFee_u20 = input0nSequence & 0xFFFFF /*0b1111_1111_1111_1111_1111*/;
        uint256 executionHandlerFee_u20 = input1nSequence & 0xFFFFF /*0b1111_1111_1111_1111_1111*/;
        uint256 frontingFee_u20 = ((input0nSequence >> 10) & 0xFFC00 /*0b1111_1111_1100_0000_0000*/) | ((input1nSequence >> 20) & 0x3FF /*0b11_1111_1111*/);

        //Use locktime to determine timeout of the execution handler
        uint256 executionExpiry = btcTx.getLocktime() + 1_000_000_000;
        
        //Make sure output has correct length
        address recipient;
        uint256 amount0;
        uint256 amount1;
        bytes32 executionHash;
        assembly ("memory-safe") {
            let start := add(add(btcTxData, 34), output1ScriptOffset)
            switch output1ScriptLength
            case 30 {
                //OP_RETURN OP_PUSH_28 <20 byte recipient || 8 byte amount0>
                let value := mload(start)
                recipient := shr(96, value)
                amount0 := and(shr(32, value), 0xffffffffffffffff)
            }
            case 38 {
                //OP_RETURN OP_PUSH_36 <20 byte recipient || 8 byte amount0 || 8 byte amount1>
                recipient := shr(96, mload(start))
                let value := mload(add(start, 20))
                amount0 := shr(192, value)
                amount1 := and(shr(128, value), 0xffffffffffffffff)
            }
            case 62 {
                //OP_RETURN OP_PUSH_60 <20 byte recipient || 8 byte amount0 || 32 byte execution hash>
                let value := mload(start)
                recipient := shr(96, value)
                amount0 := and(shr(32, value), 0xffffffffffffffff)
                executionHash := mload(add(start, 28))
            }
            case 70 {
                //OP_RETURN OP_PUSH_70 <20 byte recipient || 8 byte amount0 || 8 byte amount1 || 32 byte execution hash>
                recipient := shr(96, mload(start))
                let value := mload(add(start, 20))
                amount0 := shr(192, value)
                amount1 := and(shr(128, value), 0xffffffffffffffff)
                executionHash := mload(add(start, 36))
            }
        }

        if(recipient == address(0x0)) return (false, data, "txData: output 1 invalid len");

        uint256 callerFeeAmount0 = amount0 * callerFee_u20 / 100_000;
        if(callerFeeAmount0 > type(uint64).max) return (false, data, "txData: caller fee 0");
        uint256 frontingFeeAmount0 = amount0 * frontingFee_u20 / 100_000;
        if(frontingFeeAmount0 > type(uint64).max) return (false, data, "txData: fronting fee 0");
        uint256 executionHandlerFeeAmount0 = amount0 * executionHandlerFee_u20 / 100_000;
        if(executionHandlerFeeAmount0 > type(uint64).max) return (false, data, "txData: execution fee 0");

        uint256 callerFeeAmount1 = amount1 * callerFee_u20 / 100_000;
        if(callerFeeAmount1 > type(uint64).max) return (false, data, "txData: caller fee 1");
        uint256 frontingFeeAmount1 = amount1 * frontingFee_u20 / 100_000;
        if(frontingFeeAmount1 > type(uint64).max) return (false, data, "txData: fronting fee 1");

        data.recipient = recipient;
        data.amount[0] = amount0;
        data.amount[1] = amount1;
        data.callerFee[0] = callerFeeAmount0;
        data.callerFee[1] = callerFeeAmount1;
        data.frontingFee[0] = frontingFeeAmount0;
        data.frontingFee[1] = frontingFeeAmount1;
        data.executionHandlerFeeAmount0 = executionHandlerFeeAmount0;
        data.executionHash = executionHash;
        data.executionExpiry = executionExpiry;

        success = true;
    }
    
    //Returns hash of this vault data, salted by the transaction id, used as fronting ID
    function hash(BitcoinVaultTransactionData memory self, bytes32 btcTxHash) pure internal returns (bytes32 vaultTransactionHash) {
        assembly ("memory-safe") {
            let structHash := keccak256(self, 320)
            mstore(0x00, structHash)
            mstore(0x20, btcTxHash)
            vaultTransactionHash := keccak256(0x00, 64)
        }
    }

    //Returns full token amounts to be withdrawn from vault, this implies that there is no overflow
    // when adding all the fees together!
    function getFullAmounts(BitcoinVaultTransactionData memory self) pure internal returns (bool success, uint256 amount0, uint256 amount1) {
        amount0 = self.amount[0] + self.callerFee[0] + self.frontingFee[0] + self.executionHandlerFeeAmount0;
        amount1 = self.amount[1] + self.callerFee[1] + self.frontingFee[1];
        if(amount0 > type(uint64).max) return (false, 0, 0);
        if(amount1 > type(uint64).max) return (false, 0, 0);
        success = true;
    }

}
