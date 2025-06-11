// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./state/Fork.sol";
import "./structs/StoredBlockHeader.sol";
import "./Events.sol";

interface IBtcRelay {
    function submitMainBlockheaders(bytes calldata data) external;
    function submitShortForkBlockheaders(bytes calldata data) external;
    function submitForkBlockheaders(uint256 forkId, bytes calldata data) external;
}

interface IBtcRelayView {
    function getChainwork() external view returns (uint256);
    function getBlockheight() external view returns (uint32);
    function verifyBlockheader(StoredBlockHeader memory storedHeader) external view returns (uint256 confirmations);
    function verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) external view returns (uint256 confirmations);
    function getCommitHash(uint256 height) external view returns (bytes32);
    function getTipCommitHash() external view returns (bytes32);
}

contract BtcRelay is IBtcRelay, IBtcRelayView {

    using StoredBlockHeaderImpl for StoredBlockHeader;
    using ForkImpl for Fork;

    uint256 _chainWorkAndBlockheight; //Chainwork is stored in upper most 224-bits and blockheight is saved in the least significant 32-bits

    function _setChainWorkAndBlockHeight(uint256 chainWork, uint32 blockHeight) internal {
        _chainWorkAndBlockheight = (chainWork << 32) | blockHeight;
    } 

    function _getChainWorkAndBlockheight() internal view returns (uint256 chainWork, uint32 blockHeight) {
        assembly {
            let chainWorkAndBlockheight := sload(_chainWorkAndBlockheight.slot)
            blockHeight := and(chainWorkAndBlockheight, 0xffffffff)
            chainWork := shr(32, chainWorkAndBlockheight)
        }
    }

    function _getChainWork() internal view returns (uint256 chainWork) {
        assembly { chainWork := shr(32, sload(_chainWorkAndBlockheight.slot)) }
    }

    function _getBlockHeight() internal view returns (uint32 blockHeight) {
        assembly { blockHeight := and(sload(_chainWorkAndBlockheight.slot), 0xffffffff) }
    }

    mapping(uint256 => bytes32) mainChain;
    mapping(address => mapping(uint256 => Fork)) forks;

    bool immutable _clampBlockTarget;

    //Initialize the btc relay with the provided stored_header
    constructor(StoredBlockHeader memory storedHeader, bool clampBlockTarget) {
        _clampBlockTarget = clampBlockTarget;

        bytes32 commitHash = storedHeader.hash();

        //Save the initial stored header
        uint32 blockHeight = storedHeader.blockHeight();
        mainChain[blockHeight] = commitHash;
        _setChainWorkAndBlockHeight(storedHeader.chainWork(), blockHeight);

        //Emit event
        emit Events.StoreHeader(commitHash, storedHeader.header_blockhash());
    }

    //Internal functions
    function _verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) internal view returns (uint256 confirmations) {
        uint256 mainBlockheight = _getBlockHeight();
        //Check that the block height isn't past the tip, this can happen if there is a reorg, where a shorter
        // chain becomes the cannonical one, this can happen due to the heaviest work rule (and not lonest chain rule)
        require(height <= mainBlockheight, 'verify: future block');

        require(
            mainChain[height] == commitmentHash,
            'verify: block commitment'
        );

        confirmations = mainBlockheight - height + 1;
    }

    //Mutating functions
    function submitMainBlockheaders(bytes calldata data) external {
        require(data.length >= 208, "submitMain: no headers");

        StoredBlockHeader memory storedHeader = StoredBlockHeaderImpl.fromCalldata(data, 0);
        
        //Verify stored header is latest committed
        uint32 blockHeight = _getBlockHeight();
        require(blockHeight == storedHeader.blockHeight(), "submitMain: block height");
        require(mainChain[blockHeight] == storedHeader.hash(), "submitMain: block commitment");

        //Proccess new block headers
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            bytes32 blockHash = storedHeader.updateChain(data, i, block.timestamp, _clampBlockTarget);
            blockHeight = storedHeader.blockHeight();

            //Write header commitment
            bytes32 commitHash = storedHeader.hash();
            mainChain[blockHeight] = commitHash;

            //Emit event
            emit Events.StoreHeader(commitHash, blockHash);
        }

        //Update globals
        _setChainWorkAndBlockHeight(storedHeader.chainWork(), blockHeight);
    }

    
    function submitShortForkBlockheaders(bytes calldata data) external {
        require(data.length >= 208, "submitMain: no headers");

        StoredBlockHeader memory storedHeader = StoredBlockHeaderImpl.fromCalldata(data, 0);

        //Verify stored header is committed
        (uint256 chainWork, uint32 tipBlockHeight) = _getChainWorkAndBlockheight();
        uint32 blockHeight = storedHeader.blockHeight();
        require(blockHeight <= tipBlockHeight, "shortFork: future block");
        require(mainChain[blockHeight] == storedHeader.hash(), "shortFork: block commitment");

        uint256 startHeight = uint256(blockHeight) + 1;

        //Proccess new block headers
        bytes32 commitHash;
        bytes32 blockHash;
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            blockHash = storedHeader.updateChain(data, i, block.timestamp, _clampBlockTarget);
            blockHeight = storedHeader.blockHeight();

            //Write header commitment
            commitHash = storedHeader.hash();
            mainChain[blockHeight] = commitHash;

            //Emit event - here we can already emit main chain submission events
            emit Events.StoreHeader(commitHash, blockHash);
        }

        //Check if this fork's chainwork is higher than main chainwork
        uint256 newChainWork = storedHeader.chainWork();
        require(newChainWork > chainWork, 'shortFork: not enough work');

        //Emit chain re-org event
        emit Events.ChainReorg(commitHash, blockHash, 0, msg.sender, startHeight);

        //Update globals
        _setChainWorkAndBlockHeight(newChainWork, blockHeight);
    }

    function submitForkBlockheaders(uint256 forkId, bytes calldata data) external {
        require(data.length >= 208, "fork: no headers");
        require(forkId != 0, "fork: forkId 0 reserved");
        Fork storage fork = forks[msg.sender][forkId];

        StoredBlockHeader memory storedHeader = StoredBlockHeaderImpl.fromCalldata(data, 0);

        (uint256 chainWork, uint32 tipBlockHeight) = _getChainWorkAndBlockheight();
        bytes32 commitHash = storedHeader.hash();
        uint256 forkStartBlockheight = fork.startHeight;
        if(forkStartBlockheight==0) {
            //Verify stored header is committed in the main chain
            uint256 storedHeaderBlockHeight = storedHeader.blockHeight();
            require(storedHeaderBlockHeight <= tipBlockHeight, "fork: future block");
            require(mainChain[storedHeaderBlockHeight] == commitHash, "fork: block commitment");
            forkStartBlockheight = storedHeaderBlockHeight + 1;
            //Save the block start height and also the commitment of the fork root block (latest
            // block that is still committed in the main chain)
            fork.startHeight = uint32(forkStartBlockheight);
            fork.chain[storedHeaderBlockHeight] = commitHash;
        } else {
            //Verify stored header is the tip of the fork chain
            uint256 forkTipHeight = fork.tipHeight;
            require(fork.chain[forkTipHeight] == commitHash, "fork: fork block commitment");
        }

        //Proccess new block headers
        bytes32 blockHash;
        uint32 forkTipBlockHeight;
        mapping(uint256 => bytes32) storage forkChain = fork.chain;
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            blockHash = storedHeader.updateChain(data, i, block.timestamp, _clampBlockTarget);
            forkTipBlockHeight = storedHeader.blockHeight();

            //Write header commitment
            commitHash = storedHeader.hash();
            forkChain[forkTipBlockHeight] = commitHash;

            //Emit event - here we can already emit main chain submission events
            emit Events.StoreForkHeader(commitHash, blockHash, forkId);
        }

        //Update tip height of the fork
        fork.tipHeight = forkTipBlockHeight;
        
        //Check if this fork's chainwork is higher than main chainwork
        uint256 newChainWork = storedHeader.chainWork();
        if(chainWork < newChainWork) {
            //This fork has just overtaken the main chain in chainwork
            //Make this fork main chain
            uint256 blockHeight = forkStartBlockheight-1;
            
            //Make sure that the fork's root block is still committed
            require(mainChain[blockHeight] == forkChain[blockHeight], "fork: reorg block commitment");
            delete forkChain[blockHeight];

            blockHeight++;

            for(; blockHeight <= forkTipBlockHeight; blockHeight++) {
                mainChain[blockHeight] = forkChain[blockHeight];
                delete forkChain[blockHeight];
            }
            fork.remove();
            
            //Emit chain re-org event
            emit Events.ChainReorg(commitHash, blockHash, forkId, msg.sender, forkStartBlockheight);

            //Update globals
            _setChainWorkAndBlockHeight(newChainWork, forkTipBlockHeight);
        }
    }

    //Read-only functions
    function getChainwork() external view returns (uint256 chainWork) {
        return _getChainWork();
    }

    function getBlockheight() external view returns (uint32 blockheight) {
        return _getBlockHeight();
    }
    
    function verifyBlockheader(StoredBlockHeader memory storedHeader) external view returns (uint256 confirmations) {
        return _verifyBlockheaderHash(storedHeader.blockHeight(), storedHeader.hash());
    }

    function verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) external view returns (uint256 confirmations) {
        return _verifyBlockheaderHash(height, commitmentHash);
    }

    function getCommitHash(uint256 height) external view returns (bytes32) {
        return mainChain[height];
    }

    function getTipCommitHash() external view returns (bytes32) {
        return mainChain[_getBlockHeight()];
    }

}
