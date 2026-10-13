// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RelayProofRegistry
/// @notice Minimal public registry of RelayProof credential digests.
/// @dev Stores only digests, key references, a 16-bit lookup hint, the block
///      timestamp, and revocation status. No audio, manifests, or personal data
///      are stored on-chain. Anyone can register; only the registering account
///      (the issuer) can revoke its own record. A record cannot be re-registered,
///      so the first registration of a credentialId is authoritative.
///      Prototype only: deployed to Monad testnet, not audited, not production.
contract RelayProofRegistry {
    struct Record {
        address issuer;          // account that registered the record
        bytes32 manifestDigest;  // SHA-256 of the canonical off-chain manifest
        bytes32 issuerKeyHash;   // hash of the issuer's public key reference (keyId)
        uint16 watermarkId;      // 16-bit payload embedded in the audio (lookup hint only)
        uint64 registeredAt;     // block timestamp of registration ("existed at time T")
        uint64 revokedAt;        // block timestamp of revocation, 0 if active
    }

    /// Status codes returned by status(): 0 unknown, 1 active, 2 revoked.
    uint8 public constant STATUS_UNKNOWN = 0;
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_REVOKED = 2;

    mapping(bytes32 => Record) private _records;

    event Registered(
        bytes32 indexed credentialId,
        address indexed issuer,
        uint16 indexed watermarkId,
        bytes32 manifestDigest,
        bytes32 issuerKeyHash,
        uint64 registeredAt
    );
    event Revoked(bytes32 indexed credentialId, address indexed issuer, uint64 revokedAt);

    error ZeroCredentialId();
    error ZeroManifestDigest();
    error AlreadyRegistered(bytes32 credentialId);
    error NotRegistered(bytes32 credentialId);
    error NotIssuer(bytes32 credentialId);
    error AlreadyRevoked(bytes32 credentialId);

    /// @notice Register a credential digest. The first registration of an ID wins.
    function register(
        bytes32 credentialId,
        bytes32 manifestDigest,
        bytes32 issuerKeyHash,
        uint16 watermarkId
    ) external {
        if (credentialId == bytes32(0)) revert ZeroCredentialId();
        if (manifestDigest == bytes32(0)) revert ZeroManifestDigest();
        Record storage record = _records[credentialId];
        if (record.issuer != address(0)) revert AlreadyRegistered(credentialId);

        uint64 timestamp = uint64(block.timestamp);
        record.issuer = msg.sender;
        record.manifestDigest = manifestDigest;
        record.issuerKeyHash = issuerKeyHash;
        record.watermarkId = watermarkId;
        record.registeredAt = timestamp;

        emit Registered(credentialId, msg.sender, watermarkId, manifestDigest, issuerKeyHash, timestamp);
    }

    /// @notice Revoke a record. Only the original issuer may revoke, and only once.
    function revoke(bytes32 credentialId) external {
        Record storage record = _records[credentialId];
        if (record.issuer == address(0)) revert NotRegistered(credentialId);
        if (record.issuer != msg.sender) revert NotIssuer(credentialId);
        if (record.revokedAt != 0) revert AlreadyRevoked(credentialId);

        uint64 timestamp = uint64(block.timestamp);
        record.revokedAt = timestamp;
        emit Revoked(credentialId, msg.sender, timestamp);
    }

    /// @notice Full record for a credential ID (zeroed if unknown).
    function getRecord(bytes32 credentialId) external view returns (Record memory) {
        return _records[credentialId];
    }

    /// @notice Current status of a credential ID: 0 unknown, 1 active, 2 revoked.
    function status(bytes32 credentialId) external view returns (uint8) {
        Record storage record = _records[credentialId];
        if (record.issuer == address(0)) return STATUS_UNKNOWN;
        if (record.revokedAt != 0) return STATUS_REVOKED;
        return STATUS_ACTIVE;
    }
}
