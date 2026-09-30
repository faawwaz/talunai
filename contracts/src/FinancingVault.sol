// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RWARegistry} from "./RWARegistry.sol";

/// @notice Atomic single-lender funding; isolated pull-payment receivable accounting.
contract FinancingVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant LENDER_ROLE = keccak256("LENDER_ROLE");
    RWARegistry public immutable registry;
    IERC20 public immutable token;
    bool public fundingPaused;
    uint256 public totalLiabilities;

    struct Deal { address lender; uint256 totalCollected; uint256 lenderWithdrawn; uint256 borrowerWithdrawn; bool funded; }
    enum FinancingStatus { UNFUNDED, ACTIVE, PARTIALLY_RECOVERED, REPAID }
    enum CollectionStatus { UNPAID, PARTIALLY_COLLECTED, FULLY_COLLECTED }
    struct Accounting {
        uint256 principalAllocated;
        uint256 feeAllocated;
        uint256 borrowerAllocated;
        uint256 lenderClaimable;
        uint256 borrowerClaimable;
        uint256 remainingLenderEntitlement;
        uint256 remainingInvoiceCollection;
        FinancingStatus financingStatus;
        CollectionStatus collectionStatus;
    }
    mapping(bytes32 => Deal) private _deals;

    error InvalidConfiguration();
    error Forbidden();
    error FundingIneligible();
    error NotFunded();
    error InvalidPayment();
    error UnsupportedTokenBehavior();
    error NothingToWithdraw();

    event Funded(bytes32 indexed claimKey, address indexed lender, address indexed borrower, uint256 principal);
    event BuyerPaymentCollected(bytes32 indexed claimKey, address indexed buyer, uint256 amount, uint256 totalCollected);
    event LenderWithdrawal(bytes32 indexed claimKey, address indexed lender, uint256 amount);
    event BorrowerWithdrawal(bytes32 indexed claimKey, address indexed borrower, uint256 amount);
    event FundingPauseChanged(bool paused);

    constructor(address admin, address registry_) {
        if (admin == address(0) || registry_.code.length == 0 || (block.chainid != 97 && block.chainid != 31337)) revert InvalidConfiguration();
        registry = RWARegistry(registry_);
        token = IERC20(registry.token());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function fundAndDisburse(bytes32 key) external nonReentrant onlyRole(LENDER_ROLE) {
        if (fundingPaused || _deals[key].funded || !registry.canFund(key)) revert FundingIneligible();
        RWARegistry.Terms memory terms = registry.getTerms(key);
        if (msg.sender == terms.borrower || msg.sender == terms.buyer || terms.token != address(token)) revert Forbidden();
        _deals[key] = Deal(msg.sender, 0, 0, 0, true);
        registry.markFunded(key);
        uint256 vaultBefore = token.balanceOf(address(this));
        uint256 lenderBefore = token.balanceOf(msg.sender);
        uint256 borrowerBefore = token.balanceOf(terms.borrower);
        token.safeTransferFrom(msg.sender, address(this), terms.principal);
        if (token.balanceOf(address(this)) != vaultBefore + terms.principal
            || token.balanceOf(msg.sender) != lenderBefore - terms.principal) revert UnsupportedTokenBehavior();
        token.safeTransfer(terms.borrower, terms.principal);
        if (token.balanceOf(address(this)) != vaultBefore
            || token.balanceOf(terms.borrower) != borrowerBefore + terms.principal) revert UnsupportedTokenBehavior();
        emit Funded(key, msg.sender, terms.borrower, terms.principal);
    }

    function collectBuyerPayment(bytes32 key, uint256 amount) external nonReentrant {
        Deal storage deal = _fundedDeal(key);
        RWARegistry.Terms memory terms = registry.getTerms(key);
        if (msg.sender != terms.buyer) revert Forbidden();
        if (amount == 0 || amount > terms.acceptedOutstanding - deal.totalCollected) revert InvalidPayment();
        deal.totalCollected += amount;
        totalLiabilities += amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 buyerBefore = token.balanceOf(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount
            || token.balanceOf(msg.sender) != buyerBefore - amount) revert UnsupportedTokenBehavior();
        emit BuyerPaymentCollected(key, msg.sender, amount, deal.totalCollected);
    }

    function withdrawLender(bytes32 key) external nonReentrant {
        Deal storage deal = _fundedDeal(key);
        if (msg.sender != deal.lender) revert Forbidden();
        uint256 amount = getAccounting(key).lenderClaimable;
        if (amount == 0) revert NothingToWithdraw();
        deal.lenderWithdrawn += amount;
        totalLiabilities -= amount;
        _transferExact(deal.lender, amount);
        emit LenderWithdrawal(key, deal.lender, amount);
    }

    function withdrawBorrowerResidual(bytes32 key) external nonReentrant {
        Deal storage deal = _fundedDeal(key);
        address borrower = registry.getTerms(key).borrower;
        if (msg.sender != borrower) revert Forbidden();
        uint256 amount = getAccounting(key).borrowerClaimable;
        if (amount == 0) revert NothingToWithdraw();
        deal.borrowerWithdrawn += amount;
        totalLiabilities -= amount;
        _transferExact(borrower, amount);
        emit BorrowerWithdrawal(key, borrower, amount);
    }

    function _transferExact(address recipient, uint256 amount) internal {
        uint256 vaultBefore = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(address(this)) != vaultBefore - amount
            || token.balanceOf(recipient) != recipientBefore + amount) revert UnsupportedTokenBehavior();
    }

    function setFundingPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        fundingPaused = paused;
        emit FundingPauseChanged(paused);
    }
    function getDeal(bytes32 key) external view returns (Deal memory) { return _deals[key]; }

    function getAccounting(bytes32 key) public view returns (Accounting memory a) {
        RWARegistry.Terms memory terms = registry.getTerms(key);
        Deal storage deal = _deals[key];
        uint256 collected = deal.totalCollected;
        a.principalAllocated = Math.min(collected, terms.principal);
        uint256 afterPrincipal = collected - a.principalAllocated;
        a.feeAllocated = Math.min(afterPrincipal, terms.fee);
        a.borrowerAllocated = afterPrincipal - a.feeAllocated;
        uint256 lenderAllocated = a.principalAllocated + a.feeAllocated;
        a.lenderClaimable = lenderAllocated - deal.lenderWithdrawn;
        a.borrowerClaimable = a.borrowerAllocated - deal.borrowerWithdrawn;
        a.remainingLenderEntitlement = terms.principal + terms.fee - lenderAllocated;
        a.remainingInvoiceCollection = terms.acceptedOutstanding - collected;
        a.financingStatus = !deal.funded ? FinancingStatus.UNFUNDED : collected == 0 ? FinancingStatus.ACTIVE
            : a.remainingLenderEntitlement == 0 ? FinancingStatus.REPAID : FinancingStatus.PARTIALLY_RECOVERED;
        a.collectionStatus = collected == 0 ? CollectionStatus.UNPAID
            : a.remainingInvoiceCollection == 0 ? CollectionStatus.FULLY_COLLECTED : CollectionStatus.PARTIALLY_COLLECTED;
    }

    function isFinancingOverdue(bytes32 key) external view returns (bool) {
        return _deals[key].funded && block.timestamp > registry.getTerms(key).invoiceDueAt && getAccounting(key).remainingLenderEntitlement > 0;
    }
    function isInvoiceOverdue(bytes32 key) external view returns (bool) {
        return block.timestamp > registry.getTerms(key).invoiceDueAt && getAccounting(key).remainingInvoiceCollection > 0;
    }
    function _fundedDeal(bytes32 key) internal view returns (Deal storage deal) {
        deal = _deals[key];
        if (!deal.funded) revert NotFunded();
    }
}
