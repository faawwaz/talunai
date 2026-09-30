// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FinancingVault} from "./FinancingVault.sol";
import {RWARegistry} from "./RWARegistry.sol";

/// @notice Synthetic single-asset, closed-cycle invoice funding pool.
/// @dev Shares cannot be transferred. Deposits and redemptions are available only between funding cycles.
contract LiquidityPoolA is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant INVESTOR_ROLE = keccak256("INVESTOR_ROLE");
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");
    string public constant RISK_DISCLOSURE =
        "TALUNAI_POOL_A_RISK_V1: MockIDR has no value. Capital is locked while financed invoices remain unpaid. Buyer nonpayment, disputes and smart-contract failures can cause loss or delay. Projected APY is not guaranteed.";
    bytes32 public constant RISK_DISCLOSURE_HASH = keccak256(bytes(RISK_DISCLOSURE));
    uint256 public constant MAX_DEALS = 32;
    uint256 public constant MAX_DEAL_EXPOSURE_BPS = 1000;
    uint256 public constant MAX_TOTAL_UTILIZATION_BPS = 8000;
    // Virtual assets and 18-decimal shares bound donation and integer-rounding attacks.
    uint256 public constant VIRTUAL_SHARES = 1e18;
    uint256 private constant MIN_IMMEDIATE_REDEEM_BPS = 9999;

    IERC20 public immutable asset;
    FinancingVault public immutable vault;
    RWARegistry public immutable registry;
    bool public depositsPaused;
    bool public allocationsPaused;
    bytes32[] private _dealKeys;
    mapping(bytes32 => bool) public fundedByPool;

    error InvalidConfiguration();
    error InvalidAmount();
    error RiskNotAccepted();
    error CapitalLocked();
    error HarvestRequired();
    error FundingIneligible();
    error ExposureExceeded();
    error UnexpectedTokenBehavior();
    error TransfersDisabled();

    event RiskAcknowledged(address indexed investor, bytes32 indexed disclosureHash);
    event Deposited(address indexed investor, uint256 assets, uint256 shares);
    event Redeemed(address indexed investor, uint256 shares, uint256 assets);
    event ClaimFunded(bytes32 indexed claimKey, uint256 principal);
    event Harvested(bytes32 indexed claimKey, uint256 amount);
    event PoolPauseChanged(bool depositsPaused, bool allocationsPaused);

    constructor(address admin, address vault_) ERC20("TALUNAI Pool A Share - TEST", "tPOOL-A") {
        if (admin == address(0) || vault_.code.length == 0 || (block.chainid != 97 && block.chainid != 31337))
            revert InvalidConfiguration();
        vault = FinancingVault(vault_);
        registry = vault.registry();
        asset = vault.token();
        if (address(registry).code.length == 0 || address(asset).code.length == 0 || registry.token() != address(asset))
            revert InvalidConfiguration();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // Allocation is assigned in a separate, auditable grant to a named operator.
    }

    function decimals() public pure override returns (uint8) { return 18; }
    function dealCount() external view returns (uint256) { return _dealKeys.length; }
    function dealAt(uint256 index) external view returns (bytes32) { return _dealKeys[index]; }

    function poolStats() public view returns (
        uint256 idleAssets,
        uint256 outstandingPrincipal,
        uint256 claimableFromVault,
        uint256 realizedFee,
        uint256 bookAssets,
        uint256 shares,
        uint256 activeDeals
    ) {
        idleAssets = asset.balanceOf(address(this));
        shares = totalSupply();
        for (uint256 i; i < _dealKeys.length; ++i) {
            bytes32 key = _dealKeys[i];
            RWARegistry.Terms memory terms = registry.getTerms(key);
            FinancingVault.Accounting memory accounting = vault.getAccounting(key);
            outstandingPrincipal += terms.principal - accounting.principalAllocated;
            claimableFromVault += accounting.lenderClaimable;
            realizedFee += accounting.feeAllocated;
            if (accounting.remainingLenderEntitlement != 0) ++activeDeals;
        }
        bookAssets = idleAssets + outstandingPrincipal + claimableFromVault;
    }

    function totalAssets() public view returns (uint256) {
        (,,,, uint256 bookAssets,,) = poolStats();
        return bookAssets;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 0 : Math.mulDiv(shares, totalAssets() + 1, supply + VIRTUAL_SHARES);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        (,,,, uint256 bookAssets, uint256 supply,) = poolStats();
        return _safeDepositShares(assets, supply, bookAssets);
    }

    function deposit(uint256 assets, bytes32 acceptedRiskHash)
        external nonReentrant onlyRole(INVESTOR_ROLE) returns (uint256 shares)
    {
        if (depositsPaused) revert CapitalLocked();
        if (acceptedRiskHash != RISK_DISCLOSURE_HASH) revert RiskNotAccepted();
        if (assets == 0) revert InvalidAmount();
        (,, uint256 unharvested,, uint256 bookAssets, uint256 supply, uint256 active) = poolStats();
        if (active != 0) revert CapitalLocked();
        if (unharvested != 0) revert HarvestRequired();
        shares = _safeDepositShares(assets, supply, bookAssets);
        if (shares == 0) revert InvalidAmount();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assets);
        if (asset.balanceOf(address(this)) != beforeBalance + assets) revert UnexpectedTokenBehavior();
        _mint(msg.sender, shares);
        emit RiskAcknowledged(msg.sender, acceptedRiskHash);
        emit Deposited(msg.sender, assets, shares);
    }

    function _safeDepositShares(uint256 assets, uint256 supply, uint256 bookAssets) private pure returns (uint256 shares) {
        shares = Math.mulDiv(assets, supply + VIRTUAL_SHARES, bookAssets + 1);
        if (shares == 0) return 0;
        // Refuse a deposit when integer rounding would immediately erase meaningful value.
        uint256 redeemable = Math.mulDiv(shares, bookAssets + assets + 1, supply + shares + VIRTUAL_SHARES);
        if (redeemable < Math.mulDiv(assets, MIN_IMMEDIATE_REDEEM_BPS, 10000, Math.Rounding.Ceil)) return 0;
    }

    function redeem(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0 || shares > balanceOf(msg.sender)) revert InvalidAmount();
        (,,,,,, uint256 active) = poolStats();
        if (active != 0) revert CapitalLocked();
        _harvestAll();
        assets = previewRedeem(shares);
        if (assets == 0) revert InvalidAmount();
        _burn(msg.sender, shares);
        uint256 beforeBalance = asset.balanceOf(msg.sender);
        asset.safeTransfer(msg.sender, assets);
        if (asset.balanceOf(msg.sender) != beforeBalance + assets) revert UnexpectedTokenBehavior();
        emit Redeemed(msg.sender, shares, assets);
    }

    function fundClaim(bytes32 key) external nonReentrant onlyRole(ALLOCATOR_ROLE) {
        if (allocationsPaused || fundedByPool[key] || _dealKeys.length >= MAX_DEALS || !registry.canFund(key))
            revert FundingIneligible();
        RWARegistry.Terms memory terms = registry.getTerms(key);
        (uint256 idle, uint256 outstanding,,, uint256 bookAssets,,) = poolStats();
        if (terms.principal > idle || terms.principal > Math.mulDiv(bookAssets, MAX_DEAL_EXPOSURE_BPS, 10000)
            || outstanding + terms.principal > Math.mulDiv(bookAssets, MAX_TOTAL_UTILIZATION_BPS, 10000))
            revert ExposureExceeded();
        asset.forceApprove(address(vault), terms.principal);
        vault.fundAndDisburse(key);
        asset.forceApprove(address(vault), 0);
        if (asset.balanceOf(address(this)) != idle - terms.principal) revert UnexpectedTokenBehavior();
        fundedByPool[key] = true;
        _dealKeys.push(key);
        emit ClaimFunded(key, terms.principal);
    }

    function harvest(bytes32 key) external nonReentrant returns (uint256 amount) {
        if (!fundedByPool[key]) revert FundingIneligible();
        amount = _harvest(key);
    }

    function _harvestAll() internal {
        for (uint256 i; i < _dealKeys.length; ++i) {
            if (vault.getAccounting(_dealKeys[i]).lenderClaimable != 0) _harvest(_dealKeys[i]);
        }
    }

    function _harvest(bytes32 key) internal returns (uint256 amount) {
        amount = vault.getAccounting(key).lenderClaimable;
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = asset.balanceOf(address(this));
        vault.withdrawLender(key);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert UnexpectedTokenBehavior();
        emit Harvested(key, amount);
    }

    function setPaused(bool deposits_, bool allocations_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositsPaused = deposits_;
        allocationsPaused = allocations_;
        emit PoolPauseChanged(deposits_, allocations_);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert TransfersDisabled();
        super._update(from, to, value);
    }
}
