pragma solidity ^0.8.28;

import "./state/Fork.sol";
import "./structs/StoredBlockHeader.sol";
import "./Events.sol";

interface IBtcRelay {
    function submitMainBlockheaders(bytes calldata data) external;
    function submitShortForkBlockheaders(bytes calldata data) external;
    function submitForkBlockheaders(uint256 forkId, bytes calldata data) external;
}

interface IBtcRelayReadOnly {
    function getChainwork() external view returns (uint256);
    function getBlockheight() external view returns (uint256);
    function verifyBlockheader(bytes memory storedHeader) external view returns (uint256);
    function verifyBlockheaderHash(uint256 height, bytes32 commitmentHash) external view returns (uint256);
    function getCommitHash(uint256 height) external view returns (bytes32);
    function getTipCommitHash() external view returns (bytes32);
}

contract BtcRelay {

    using StoredBlockHeader for bytes;

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
        emit Events.StoreHeader(commitHash, storedHeader.headerDblSha256Hash());
    }

    //Mutating functions
    function submitMainBlockheaders(bytes calldata data) external {
        bytes memory storedHeader;
        assembly {
            storedHeader := mload(0x40)
            mstore(0x40, add(storedHeader, 192))
            mstore(storedHeader, 160)
            calldatacopy(add(storedHeader, 32), data.offset, 160)
        }

        storedHeader.verifyOutOfBounds();
        require(data.length >= 208, "submitMain: no headers");

        uint256 timestamp = block.timestamp;
        
        //Verify stored header is latest committed
        uint256 blockHeight = chainWorkAndBlockheight & 0xffffffff;
        require(blockHeight == storedHeader.blockHeight(), "submitMain: block height");
        require(mainChain[blockHeight] == storedHeader.hash(), "submitMain: block commitment");

        //Proccess new block headers
        for(uint256 i = 160; i < data.length; i += 48) {
            //Process the blockheader
            bytes32 blockHash = storedHeader.updateChain(data, i, timestamp);
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

}
