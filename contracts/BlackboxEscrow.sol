// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Atomic escrow for Blackbox agent-negotiated EVM trades.
/// @dev Deploy on the target chain with the backend's dedicated referee signer.
///      Buyer funds the payment cap and seller deposits the asset before negotiation starts.
///      settle() verifies a referee-signed agreement and exchanges both sides in one transaction.
contract BlackboxEscrow {
    enum AssetKind { ERC20, ERC721, ERC1155 }
    enum Status { Open, Settled, Cancelled }

    struct Trade {
        address buyer;
        address seller;
        address paymentToken;
        uint256 maxPayment;
        address assetToken;
        AssetKind assetKind;
        uint256 tokenId;
        uint256 quantity;
        uint64 expiresAt;
        uint64 nonce;
        Status status;
        bool assetFunded;
    }

    address public immutable refereeSigner;
    mapping(bytes32 => Trade) public trades;
    uint64 public nextNonce = 1;
    uint256 private entered = 1;

    event TradeOpened(bytes32 indexed tradeId, address indexed buyer, address indexed seller, address paymentToken, uint256 maxPayment);
    event AssetEscrowed(bytes32 indexed tradeId, address indexed seller, address assetToken, uint8 assetKind, uint256 tokenId, uint256 quantity);
    event TradeSettled(bytes32 indexed tradeId, uint256 agreedTotal, address indexed buyer, address indexed seller);
    event TradeCancelled(bytes32 indexed tradeId, address indexed cancelledBy);

    error InvalidTrade();
    error Unauthorized();
    error InvalidState();
    error Expired();
    error InvalidSignature();
    error TransferFailed();
    error ReentrantCall();

    constructor(address _refereeSigner) {
        require(_refereeSigner != address(0), "zero referee");
        refereeSigner = _refereeSigner;
    }

    modifier nonReentrant() {
        if (entered != 1) revert ReentrantCall();
        entered = 2;
        _;
        entered = 1;
    }

    function openTrade(
        bytes32 tradeId,
        address seller,
        address paymentToken,
        uint256 maxPayment,
        address assetToken,
        AssetKind assetKind,
        uint256 tokenId,
        uint256 quantity,
        uint64 expiresAt
    ) external nonReentrant {
        if (
            tradeId == bytes32(0) || trades[tradeId].buyer != address(0) ||
            seller == address(0) || seller == msg.sender ||
            paymentToken == address(0) || assetToken == address(0) ||
            maxPayment == 0 || quantity == 0 || expiresAt <= block.timestamp
        ) revert InvalidTrade();

        uint64 nonce = nextNonce++;
        trades[tradeId] = Trade({
            buyer: msg.sender,
            seller: seller,
            paymentToken: paymentToken,
            maxPayment: maxPayment,
            assetToken: assetToken,
            assetKind: assetKind,
            tokenId: tokenId,
            quantity: quantity,
            expiresAt: expiresAt,
            nonce: nonce,
            status: Status.Open,
            assetFunded: false
        });

        _safeTransferFrom(paymentToken, msg.sender, address(this), maxPayment);
        emit TradeOpened(tradeId, msg.sender, seller, paymentToken, maxPayment);
    }

    function fundAsset(bytes32 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.buyer == address(0)) revert InvalidTrade();
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.status != Status.Open || t.assetFunded) revert InvalidState();
        if (block.timestamp >= t.expiresAt) revert Expired();

        t.assetFunded = true;
        if (t.assetKind == AssetKind.ERC20) {
            _safeTransferFrom(t.assetToken, t.seller, address(this), t.quantity);
        } else if (t.assetKind == AssetKind.ERC721) {
            IERC721Minimal(t.assetToken).safeTransferFrom(t.seller, address(this), t.tokenId);
        } else {
            IERC1155Minimal(t.assetToken).safeTransferFrom(t.seller, address(this), t.tokenId, t.quantity, "");
        }
        emit AssetEscrowed(tradeId, t.seller, t.assetToken, uint8(t.assetKind), t.tokenId, t.quantity);
    }

    /// @notice Anyone can submit the referee's signed agreement. Settlement is atomic.
    function settle(bytes32 tradeId, uint256 agreedTotal, uint64 deadline, bytes calldata signature) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.buyer == address(0)) revert InvalidTrade();
        if (t.status != Status.Open || !t.assetFunded) revert InvalidState();
        if (block.timestamp >= t.expiresAt || block.timestamp > deadline) revert Expired();
        if (agreedTotal == 0 || agreedTotal > t.maxPayment) revert InvalidTrade();

        bytes32 payload = keccak256(abi.encode(
            block.chainid,
            address(this),
            tradeId,
            t.buyer,
            t.seller,
            t.paymentToken,
            t.maxPayment,
            t.assetToken,
            t.assetKind,
            t.tokenId,
            t.quantity,
            agreedTotal,
            t.nonce,
            deadline
        ));
        if (_recover(_toEthSignedMessageHash(payload), signature) != refereeSigner) revert InvalidSignature();

        // Effects before interactions. If any transfer fails, the entire transaction reverts.
        t.status = Status.Settled;
        _safeTransfer(t.paymentToken, t.seller, agreedTotal);
        if (t.maxPayment > agreedTotal) _safeTransfer(t.paymentToken, t.buyer, t.maxPayment - agreedTotal);
        _releaseAsset(t, t.buyer);
        emit TradeSettled(tradeId, agreedTotal, t.buyer, t.seller);
    }

    /// @notice Either party may cancel before settlement. Expired trades may be cancelled by anyone.
    function cancel(bytes32 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.buyer == address(0)) revert InvalidTrade();
        if (t.status != Status.Open) revert InvalidState();
        if (msg.sender != t.buyer && msg.sender != t.seller && block.timestamp < t.expiresAt) revert Unauthorized();

        t.status = Status.Cancelled;
        _safeTransfer(t.paymentToken, t.buyer, t.maxPayment);
        if (t.assetFunded) _releaseAsset(t, t.seller);
        emit TradeCancelled(tradeId, msg.sender);
    }

    function _releaseAsset(Trade storage t, address to) private {
        if (t.assetKind == AssetKind.ERC20) {
            _safeTransfer(t.assetToken, to, t.quantity);
        } else if (t.assetKind == AssetKind.ERC721) {
            IERC721Minimal(t.assetToken).safeTransferFrom(address(this), to, t.tokenId);
        } else {
            IERC1155Minimal(t.assetToken).safeTransferFrom(address(this), to, t.tokenId, t.quantity, "");
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _toEthSignedMessageHash(bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 hash, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) revert InvalidSignature();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }
}

interface IERC721Minimal {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}
interface IERC1155Minimal {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}
