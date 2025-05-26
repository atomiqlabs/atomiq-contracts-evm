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
    function getBlockheight() external view returns (uint256);
    function verifyBlockheader(bytes memory storedHeader) external view returns (uint256);
    function verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) external view returns (uint256);
    function getCommitHash(uint256 height) external view returns (bytes32);
    function getTipCommitHash() external view returns (bytes32);
}

contract BtcRelay is IBtcRelay, IBtcRelayView {

    using StoredBlockHeader for bytes;
    using StoredBlockHeaderImpl for bytes;

    uint256 chainWorkAndBlockheight; //Chainwork is stored in upper most 224-bits and blockheight is saved in the least significant 32-bits
    mapping(uint256 => bytes32) mainChain;
    mapping(address => mapping(uint256 => Fork)) forks;

    //Initialize the btc relay with the provided stored_header
    constructor(bytes memory storedHeader) {
        storedHeader.verifyOutOfBounds();
        bytes32 commitHash = storedHeader.hash();

        //Save the initial stored header
        uint256 blockHeight = storedHeader.blockHeight();
        mainChain[storedHeader.blockHeight()] = commitHash;
        chainWorkAndBlockheight = (storedHeader.chainWork() << 32) | blockHeight;

        //Emit event
        emit Events.StoreHeader(commitHash, storedHeader.header_blockhash());
    }

    //Internal functions
    function _verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) internal view returns (uint256 confirmations) {
        uint256 mainBlockheight = chainWorkAndBlockheight & 0xffffffff;
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

        bytes memory storedHeader = StoredBlockHeader.fromCalldata(data, 0);
        
        //Verify stored header is latest committed
        uint256 blockHeight = chainWorkAndBlockheight & 0xffffffff;
        require(blockHeight == storedHeader.blockHeight(), "submitMain: block height");
        require(mainChain[blockHeight] == storedHeader.hash(), "submitMain: block commitment");

        //Proccess new block headers
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            bytes32 blockHash = storedHeader.updateChain(data, i, block.timestamp);
            blockHeight = storedHeader.blockHeight();

            //Write header commitment
            bytes32 commitHash = storedHeader.hash();
            mainChain[blockHeight] = commitHash;

            //Emit event
            emit Events.StoreHeader(commitHash, blockHash);
        }

        //Update globals
        chainWorkAndBlockheight = (storedHeader.chainWork() << 32) | blockHeight;
    }

    
    function submitShortForkBlockheaders(bytes calldata data) external {
        require(data.length >= 208, "submitMain: no headers");

        bytes memory storedHeader;
        assembly {
            storedHeader := mload(0x40)
            mstore(0x40, add(storedHeader, 192))
            mstore(storedHeader, 160)
            calldatacopy(add(storedHeader, 32), data.offset, 160)
        }

        //Verify stored header is committed
        uint256 _chainWorkAndBlockheight = chainWorkAndBlockheight;
        uint256 tipBlockHeight = _chainWorkAndBlockheight & 0xffffffff;
        uint256 blockHeight = storedHeader.blockHeight();
        require(blockHeight <= tipBlockHeight, "shortFork: future block");
        require(mainChain[blockHeight] == storedHeader.hash(), "shortFork: block commitment");

        uint256 startHeight = blockHeight;

        //Proccess new block headers
        bytes32 commitHash;
        bytes32 blockHash;
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            blockHash = storedHeader.updateChain(data, i, block.timestamp);
            blockHeight = storedHeader.blockHeight();

            //Write header commitment
            commitHash = storedHeader.hash();
            mainChain[blockHeight] = commitHash;

            //Emit event - here we can already emit main chain submission events
            emit Events.StoreHeader(commitHash, blockHash);
        }

        //Check if this fork's chainwork is higher than main chainwork
        uint256 chainWork = _chainWorkAndBlockheight >> 32;
        uint256 newChainWork = storedHeader.chainWork();
        require(newChainWork > chainWork, 'shortFork: not enough work');

        //Emit chain re-org event
        emit Events.ChainReorg(commitHash, blockHash, 0, msg.sender, startHeight);

        //Update globals
        chainWorkAndBlockheight = (newChainWork << 32) | blockHeight;
    }

    function submitForkBlockheaders(uint256 forkId, bytes calldata data) external {
        require(data.length >= 208, "fork: no headers");
        require(forkId != 0, "fork: forkId 0 reserved");

        bytes memory storedHeader;
        assembly {
            storedHeader := mload(0x40)
            mstore(0x40, add(storedHeader, 192))
            mstore(storedHeader, 160)
            calldatacopy(add(storedHeader, 32), data.offset, 160)
        }

        uint256 _chainWorkAndBlockheight = chainWorkAndBlockheight;
        bytes32 commitHash = storedHeader.hash();
        uint256 forkStartBlockheight = forks[msg.sender][forkId].startHeight;
        if(forkStartBlockheight==0) {
            //Verify stored header is committed in the main chain
            uint256 tipBlockHeight = _chainWorkAndBlockheight & 0xffffffff;
            uint256 storedHeaderBlockHeight = storedHeader.blockHeight();
            require(storedHeaderBlockHeight <= tipBlockHeight, "fork: future block");
            require(mainChain[storedHeaderBlockHeight] == commitHash, "fork: block commitment");
            forkStartBlockheight = storedHeaderBlockHeight + 1;
            //Save the block start height and also the commitment of the fork root block (latest
            // block that is still committed in the main chain)
            forks[msg.sender][forkId].startHeight = uint32(forkStartBlockheight);
            forks[msg.sender][forkId].chain[storedHeaderBlockHeight] = commitHash;
        } else {
            //Verify stored header is the tip of the fork chain
            uint256 forkTipHeight = forks[msg.sender][forkId].tipHeight;
            require(forks[msg.sender][forkId].chain[forkTipHeight] == commitHash, "fork: block commitment");
        }

        //Proccess new block headers
        bytes32 blockHash;
        uint256 forkTipBlockHeight;
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            blockHash = storedHeader.updateChain(data, i, block.timestamp);
            forkTipBlockHeight = storedHeader.blockHeight();

            //Write header commitment
            commitHash = storedHeader.hash();
            forks[msg.sender][forkId].chain[forkTipBlockHeight] = commitHash;

            //Emit event - here we can already emit main chain submission events
            emit Events.StoreForkHeader(commitHash, blockHash, forkId);
        }

        //Update tip height of the fork
        forks[msg.sender][forkId].tipHeight = uint32(forkTipBlockHeight);
        
        //Check if this fork's chainwork is higher than main chainwork
        uint256 chainWork = _chainWorkAndBlockheight >> 32;
        uint256 newChainWork = storedHeader.chainWork();
        if(chainWork < newChainWork) {
            //This fork has just overtaken the main chain in chainwork
            //Make this fork main chain
            uint256 blockHeight = forkStartBlockheight-1;
            
            //Make sure that the fork's root block is still committed
            require(mainChain[blockHeight] == forks[msg.sender][forkId].chain[blockHeight], "fork: reorg block commitment");

            blockHeight++;

            for(; blockHeight <= forkTipBlockHeight; blockHeight++) {
                mainChain[blockHeight] = forks[msg.sender][forkId].chain[blockHeight];
                delete forks[msg.sender][forkId].chain[blockHeight];
            }
            
            //Emit chain re-org event
            emit Events.ChainReorg(commitHash, blockHash, forkId, msg.sender, forkStartBlockheight);

            //Update globals
            chainWorkAndBlockheight = (newChainWork << 32) | forkTipBlockHeight;
        }
    }

    //Read-only functions
    function getChainwork() external view returns (uint256) {
        return chainWorkAndBlockheight >> 32;
    }

    function getBlockheight() external view returns (uint256) {
        return chainWorkAndBlockheight & 0xffffffff;
    }
    
    function verifyBlockheader(bytes memory storedHeader) external view returns (uint256) {
        return _verifyBlockheaderHash(storedHeader.blockHeight(), storedHeader.hash());
    }

    function verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) external view returns (uint256) {
        return _verifyBlockheaderHash(height, commitmentHash);
    }

    function getCommitHash(uint256 height) external view returns (bytes32) {
        return mainChain[height];
    }

    function getTipCommitHash() external view returns (bytes32) {
        return mainChain[chainWorkAndBlockheight & 0xffffffff];
    }

}
