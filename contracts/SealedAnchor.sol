// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SealedAnchor
/// @notice Stores the final hash of each Sealed negotiation log, once. Nothing else.
/// Not deployed yet. Target: Kite AI testnet (chain 2368), later Kite mainnet (chain 2366).
contract SealedAnchor {
    struct Anchor { bytes32 finalHash; bytes32 refereeHash; uint64 blockTime; address writer; }

    mapping(bytes32 => Anchor) public anchors;

    event Anchored(bytes32 indexed dealId, bytes32 finalHash, bytes32 refereeHash, address indexed writer);

    error AlreadyAnchored(bytes32 dealId);

    function anchor(bytes32 dealId, bytes32 finalHash, bytes32 refereeHash) external {
        if (anchors[dealId].blockTime != 0) revert AlreadyAnchored(dealId);
        anchors[dealId] = Anchor(finalHash, refereeHash, uint64(block.timestamp), msg.sender);
        emit Anchored(dealId, finalHash, refereeHash, msg.sender);
    }
}
