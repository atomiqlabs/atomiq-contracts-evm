pragma solidity ^0.8.28;

library Difficulty {
    //Lowest possible mining difficulty - highest possible target
    uint256 internal constant UNROUNDED_MAX_TARGET = 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    //Bitcoin epoch timespan
    uint256 internal constant TARGET_TIMESPAN = 14 * 24 * 60 * 60; //2 weeks
    uint256 internal constant TARGET_TIMESPAN_DIV_4 = TARGET_TIMESPAN / 4;
    uint256 internal constant TARGET_TIMESPAN_MUL_4 = TARGET_TIMESPAN * 4;

    function computeNewTarget(uint256 prevTimestamp, uint256 startTimestamp, uint256 prevTarget) pure internal returns (uint256 newTarget) {
        uint256 timespan = prevTimestamp - startTimestamp;
        
        //Difficulty increase/decrease multiples are clamped between 0.25 (-75%) and 4 (+300%)
        if(timespan < TARGET_TIMESPAN_DIV_4) timespan = TARGET_TIMESPAN_DIV_4;
        if(timespan > TARGET_TIMESPAN_MUL_4) timespan = TARGET_TIMESPAN_MUL_4;

        newTarget = prevTarget * timespan / TARGET_TIMESPAN;
        if(newTarget > UNROUNDED_MAX_TARGET) newTarget = UNROUNDED_MAX_TARGET;
    }

    //Compute chainwork according to bitcoin core implementation
    // https://github.com/bitcoin/bitcoin/blob/master/src/chain.cpp#L131
    function getChainWork(uint256 target) pure internal returns (uint256 chainwork) {
        assembly {
            chainwork := add(div(not(target), add(target, 1)), 1)
        }
    }
}
