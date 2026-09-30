// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IRegistryEndpoint { function registry() external view returns (address); }
interface IExecutorEndpoint is IRegistryEndpoint { function vault() external view returns (address); }

/// @notice Immutable synthetic receivable terms. This is not transferable legal title.
contract RWARegistry is AccessControl, EIP712 {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant BORROWER_CONSENT_TYPEHASH = keccak256("BorrowerConsent(bytes32 claimKey,uint256 version,bytes32 termsHash,uint256 nonce,uint256 deadline)");
    bytes32 public constant BUYER_ACKNOWLEDGEMENT_TYPEHASH = keccak256("BuyerAcknowledgement(bytes32 claimKey,uint256 version,bytes32 termsHash,uint256 nonce,uint256 deadline)");

    struct Terms {
        bytes32 claimKey;
        uint256 version;
        address borrower;
        address buyer;
        address token;
        uint256 acceptedOutstanding;
        uint256 principal;
        uint256 fee;
        uint256 fundingDeadline;
        uint256 invoiceDueAt;
        uint256 reviewExpiry;
        uint256 consentExpiry;
        bytes32 evidenceCommitment;
        bytes32 decisionHash;
        bytes32 policyHash;
    }
    struct Consent { uint256 nonce; uint256 deadline; bytes signature; }
    enum RegistryState { UNKNOWN, AVAILABLE, FUNDED, CANCELLED }
    struct Claim { Terms terms; bytes32 termsHash; RegistryState state; bool fundingHold; }

    address public immutable token;
    uint256 public immutable maxAdvanceBps;
    uint256 public immutable flatFinancingFeeBps;
    uint256 public immutable perDealPrincipalCap;
    address public vault;
    address public agentExecutor;
    mapping(bytes32 => Claim) private _claims;
    mapping(address => mapping(uint256 => bool)) public nonceUnavailable;
    mapping(bytes32 => bytes32) public lastHoldReviewHash;

    error InvalidConfiguration();
    error InvalidTerms();
    error UnsupportedAccount();
    error ClaimAlreadyExists();
    error UnknownClaim();
    error InvalidConsent();
    error NonceUnavailable();
    error Forbidden();
    error FundingIneligible();
    error InvalidReview();

    event EndpointsConfigured(address indexed vault, address indexed agentExecutor);
    event ClaimRegistered(bytes32 indexed claimKey, bytes32 indexed termsHash, address indexed borrower, address buyer, uint256 version);
    event ClaimFunded(bytes32 indexed claimKey);
    event ClaimCancelled(bytes32 indexed claimKey, address indexed actor);
    event ConsentNonceInvalidated(address indexed signer, uint256 nonce);
    event FundingHoldSet(bytes32 indexed claimKey, address indexed actor, bytes32 evidenceCommitment);
    event FundingHoldCleared(bytes32 indexed claimKey, address indexed verifier, bytes32 reviewHash, uint256 reviewExpiry);

    constructor(address admin, address verifier, address token_, uint256 advanceBps_, uint256 feeBps_, uint256 cap_)
        EIP712("TALUNAI RWARegistry", "1")
    {
        if (admin == address(0) || verifier == address(0) || token_.code.length == 0
            || (block.chainid != 97 && block.chainid != 31337)
            || advanceBps_ != 8000 || feeBps_ != 150 || cap_ != 100000000
            || IERC20Metadata(token_).decimals() != 0) revert InvalidConfiguration();
        token = token_;
        maxAdvanceBps = advanceBps_;
        flatFinancingFeeBps = feeBps_;
        perDealPrincipalCap = cap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);
    }

    /// @dev One-time endpoint wiring avoids mutable execution targets without a proxy.
    function configureEndpoints(address vault_, address executor_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault != address(0) || vault_.code.length == 0 || executor_.code.length == 0
            || IRegistryEndpoint(vault_).registry() != address(this)
            || IExecutorEndpoint(executor_).registry() != address(this)
            || IExecutorEndpoint(executor_).vault() != vault_) revert InvalidConfiguration();
        vault = vault_;
        agentExecutor = executor_;
        emit EndpointsConfigured(vault_, executor_);
    }

    function hashTerms(Terms memory terms) public pure returns (bytes32) { return keccak256(abi.encode(terms)); }

    function consentDigest(Terms calldata terms, uint256 nonce, uint256 deadline, bool isBuyer) external view returns (bytes32) {
        return _consentDigest(terms, hashTerms(terms), nonce, deadline, isBuyer);
    }

    function _consentDigest(Terms calldata terms, bytes32 termsHash, uint256 nonce, uint256 deadline, bool isBuyer) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            isBuyer ? BUYER_ACKNOWLEDGEMENT_TYPEHASH : BORROWER_CONSENT_TYPEHASH,
            terms.claimKey, terms.version, termsHash, nonce, deadline
        )));
    }

    function registerApprovedClaim(Terms calldata terms, Consent calldata borrowerConsent, Consent calldata buyerConsent)
        external onlyRole(VERIFIER_ROLE)
    {
        if (_claims[terms.claimKey].state != RegistryState.UNKNOWN) revert ClaimAlreadyExists();
        if (msg.sender == terms.borrower || msg.sender == terms.buyer) revert Forbidden();
        _validateTerms(terms);
        bytes32 termsHash = hashTerms(terms);
        _consumeConsent(terms, termsHash, terms.borrower, borrowerConsent, false);
        _consumeConsent(terms, termsHash, terms.buyer, buyerConsent, true);
        _claims[terms.claimKey] = Claim(terms, termsHash, RegistryState.AVAILABLE, false);
        emit ClaimRegistered(terms.claimKey, termsHash, terms.borrower, terms.buyer, terms.version);
    }

    function _validateTerms(Terms calldata terms) internal view {
        if (terms.claimKey == bytes32(0) || terms.version == 0 || terms.borrower == address(0) || terms.buyer == address(0)
            || terms.borrower == terms.buyer || terms.token != token || terms.acceptedOutstanding == 0 || terms.principal == 0
            || terms.principal > perDealPrincipalCap
            || terms.principal > Math.mulDiv(terms.acceptedOutstanding, maxAdvanceBps, 10000)
            || terms.fee != Math.mulDiv(terms.principal, flatFinancingFeeBps, 10000, Math.Rounding.Ceil)
            || terms.principal + terms.fee > terms.acceptedOutstanding
            || terms.fundingDeadline <= block.timestamp || terms.fundingDeadline > block.timestamp + 1 days
            || terms.invoiceDueAt <= terms.fundingDeadline
            || terms.reviewExpiry < terms.fundingDeadline || terms.consentExpiry < terms.fundingDeadline
            || terms.evidenceCommitment == bytes32(0) || terms.decisionHash == bytes32(0) || terms.policyHash == bytes32(0)) revert InvalidTerms();
        if (terms.borrower.code.length != 0 || terms.buyer.code.length != 0) revert UnsupportedAccount();
    }

    function _consumeConsent(Terms calldata terms, bytes32 termsHash, address signer, Consent calldata consent, bool isBuyer) internal {
        if (consent.deadline != terms.consentExpiry || block.timestamp > consent.deadline) revert InvalidConsent();
        if (nonceUnavailable[signer][consent.nonce]) revert NonceUnavailable();
        if (ECDSA.recover(_consentDigest(terms, termsHash, consent.nonce, consent.deadline, isBuyer), consent.signature) != signer) revert InvalidConsent();
        nonceUnavailable[signer][consent.nonce] = true;
    }

    function invalidateConsentNonce(uint256 nonce) external {
        if (nonceUnavailable[msg.sender][nonce]) revert NonceUnavailable();
        nonceUnavailable[msg.sender][nonce] = true;
        emit ConsentNonceInvalidated(msg.sender, nonce);
    }

    function getTerms(bytes32 key) external view returns (Terms memory) { return _knownClaim(key).terms; }
    function getClaim(bytes32 key) external view returns (Terms memory terms, bytes32 termsHash, RegistryState state, bool fundingHold) {
        Claim storage claim = _knownClaim(key);
        return (claim.terms, claim.termsHash, claim.state, claim.fundingHold);
    }
    function isKnownClaim(bytes32 key) external view returns (bool) { return _claims[key].state != RegistryState.UNKNOWN; }

    function canFund(bytes32 key) public view returns (bool) {
        Claim storage claim = _claims[key];
        return claim.state == RegistryState.AVAILABLE && !claim.fundingHold
            && block.timestamp <= claim.terms.fundingDeadline
            && block.timestamp <= claim.terms.reviewExpiry
            && block.timestamp <= claim.terms.consentExpiry;
    }

    function markFunded(bytes32 key) external {
        if (msg.sender != vault) revert Forbidden();
        if (!canFund(key)) revert FundingIneligible();
        _claims[key].state = RegistryState.FUNDED;
        emit ClaimFunded(key);
    }

    function cancelBeforeFunding(bytes32 key) external {
        Claim storage claim = _knownClaim(key);
        if (msg.sender != claim.terms.borrower && msg.sender != claim.terms.buyer && !hasRole(VERIFIER_ROLE, msg.sender)) revert Forbidden();
        if (claim.state != RegistryState.AVAILABLE) revert FundingIneligible();
        claim.state = RegistryState.CANCELLED;
        emit ClaimCancelled(key, msg.sender);
    }

    function setFundingHold(bytes32 key, bytes32 evidenceCommitment) external {
        if (msg.sender != agentExecutor && !hasRole(VERIFIER_ROLE, msg.sender)) revert Forbidden();
        Claim storage claim = _knownClaim(key);
        if (evidenceCommitment == bytes32(0) || claim.state != RegistryState.AVAILABLE) revert InvalidReview();
        claim.fundingHold = true;
        emit FundingHoldSet(key, msg.sender, evidenceCommitment);
    }

    function clearFundingHold(bytes32 key, bytes32 freshReviewHash, uint256 freshReviewExpiry) external onlyRole(VERIFIER_ROLE) {
        Claim storage claim = _knownClaim(key);
        if (msg.sender == claim.terms.borrower || msg.sender == claim.terms.buyer) revert Forbidden();
        if (claim.state != RegistryState.AVAILABLE || !claim.fundingHold
            || block.timestamp > claim.terms.fundingDeadline || block.timestamp > claim.terms.reviewExpiry
            || block.timestamp > claim.terms.consentExpiry || freshReviewHash == bytes32(0)
            || freshReviewHash == claim.terms.decisionHash || freshReviewHash == lastHoldReviewHash[key]
            || freshReviewExpiry <= block.timestamp || freshReviewExpiry > claim.terms.reviewExpiry
            || freshReviewExpiry < claim.terms.fundingDeadline) revert InvalidReview();
        lastHoldReviewHash[key] = freshReviewHash;
        claim.fundingHold = false;
        emit FundingHoldCleared(key, msg.sender, freshReviewHash, freshReviewExpiry);
    }

    function _knownClaim(bytes32 key) internal view returns (Claim storage claim) {
        claim = _claims[key];
        if (claim.state == RegistryState.UNKNOWN) revert UnknownClaim();
    }
}
