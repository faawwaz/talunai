// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {LiquidityPoolA} from "../src/LiquidityPoolA.sol";

contract LiquidityPoolATest is TestBase {
    LiquidityPoolA internal pool;
    address internal allocator;

    function setUp() public override {
        super.setUp();
        allocator = vm.addr(66);
        pool = new LiquidityPoolA(address(this), address(vault));
        vault.grantRole(vault.LENDER_ROLE(), address(pool));
        pool.grantRole(pool.ALLOCATOR_ROLE(), allocator);
        pool.grantRole(pool.INVESTOR_ROLE(), lender);
        token.mint(lender, 600000000);
        vm.prank(lender);
        token.approve(address(pool), 1000000000);
    }

    function _deposit() internal returns (uint256) {
        bytes32 risk = pool.RISK_DISCLOSURE_HASH();
        vm.prank(lender);
        return pool.deposit(1000000000, risk);
    }

    function _fundPool(bytes32 key) internal {
        vm.prank(allocator);
        pool.fundClaim(key);
    }

    function testAdminCannotAllocateWithoutExplicitOperatorRole() public {
        _ok(!pool.hasRole(pool.ALLOCATOR_ROLE(), address(this)));
        _ok(pool.hasRole(pool.ALLOCATOR_ROLE(), allocator));
        _deposit();
        _register(KEY, 0);
        vm.expectRevert();
        pool.fundClaim(KEY);
        _ok(registry.canFund(KEY));
        _fundPool(KEY);
        _eq(token.balanceOf(borrower), 70000000);
    }

    function testDepositFundsClaimCollectsAndRedeemsActualAssets() public {
        uint256 shares = _deposit();
        _eq(shares, 1000000000 * pool.VIRTUAL_SHARES());
        _eq(pool.balanceOf(lender), shares);
        _eq(pool.decimals(), 18);
        _eq(pool.totalAssets(), 1000000000);

        _register(KEY, 0);
        _fundPool(KEY);
        _eq(token.balanceOf(borrower), 70000000);
        _eq(token.balanceOf(address(pool)), 930000000);
        _eq(pool.totalAssets(), 1000000000);
        vm.expectRevert(LiquidityPoolA.CapitalLocked.selector);
        vm.prank(lender);
        pool.redeem(shares);

        _collect(100000000);
        _eq(pool.totalAssets(), 1001050000);
        pool.harvest(KEY);
        _eq(token.balanceOf(address(pool)), 1001050000);
        vm.prank(lender);
        uint256 returnedAssets = pool.redeem(shares);
        _eq(returnedAssets, 1001049999);
        _eq(token.balanceOf(lender), 1001049999);
        _eq(pool.totalSupply(), 0);
        _eq(token.balanceOf(address(pool)), 1); // Virtual offset leaves bounded dust.
    }

    function testRiskRoleAndExposureLimits() public {
        vm.expectRevert(LiquidityPoolA.RiskNotAccepted.selector);
        vm.prank(lender);
        pool.deposit(1000000000, bytes32(0));
        bytes32 risk = pool.RISK_DISCLOSURE_HASH();
        vm.expectRevert();
        vm.prank(lender2);
        pool.deposit(1, risk);

        _deposit();
        _register(KEY, 0);
        _fundPool(KEY);
        vm.expectRevert(LiquidityPoolA.FundingIneligible.selector);
        _fundPool(KEY);
        vm.expectRevert(LiquidityPoolA.TransfersDisabled.selector);
        vm.prank(lender);
        pool.transfer(lender2, 1);
    }

    function testFundingHoldPreventsPoolAllocation() public {
        _deposit();
        _register(KEY, 0);
        vm.prank(verifier);
        registry.setFundingHold(KEY, keccak256("risk-evidence"));
        vm.expectRevert(LiquidityPoolA.FundingIneligible.selector);
        _fundPool(KEY);
        _eq(token.balanceOf(address(pool)), 1000000000);
    }

    function testTwoInvestorsShareCollectedFeeProRata() public {
        uint256 firstShares = _deposit();
        pool.grantRole(pool.INVESTOR_ROLE(), lender2);
        vm.prank(lender2);
        token.approve(address(pool), 400000000);
        bytes32 riskHash = pool.RISK_DISCLOSURE_HASH();
        vm.prank(lender2);
        uint256 secondShares = pool.deposit(400000000, riskHash);
        _eq(secondShares, 400000000 * pool.VIRTUAL_SHARES());

        _register(KEY, 0);
        _fundPool(KEY);
        _collect(35000000);
        _eq(pool.totalAssets(), 1400000000);
        _eq(pool.previewRedeem(secondShares), 400000000);
        vm.expectRevert(LiquidityPoolA.CapitalLocked.selector);
        vm.prank(lender2);
        pool.redeem(secondShares);

        // Principal is recovered first. The 1,050,000 fee enters share value only after buyer payment.
        _collect(36050000);
        _eq(pool.totalAssets(), 1401050000);
        _eq(pool.previewRedeem(secondShares), 400299999);
        vm.prank(lender2);
        _eq(pool.redeem(secondShares), 400299999);
        vm.prank(lender);
        _eq(pool.redeem(firstShares), 1000750000);
        _eq(token.balanceOf(address(pool)), 1);
    }

    function testDonationCannotExtractNextInvestorDeposit() public {
        bytes32 riskHash = pool.RISK_DISCLOSURE_HASH();
        vm.prank(lender);
        uint256 firstShares = pool.deposit(1, riskHash);
        vm.prank(lender);
        token.transfer(address(pool), 199);
        pool.grantRole(pool.INVESTOR_ROLE(), lender2);
        vm.prank(lender2);
        token.approve(address(pool), 10000);
        _eq(pool.previewDeposit(399), 0); // The original donation attack quote is rejected.
        vm.prank(lender2);
        vm.expectRevert(LiquidityPoolA.InvalidAmount.selector);
        pool.deposit(399, riskHash);
        vm.prank(lender2);
        uint256 secondShares = pool.deposit(10000, riskHash);
        _ok(secondShares > firstShares);
        vm.prank(lender);
        _eq(pool.redeem(firstShares), 100);
        vm.prank(lender2);
        _eq(pool.redeem(secondShares), 10000);
        _eq(token.balanceOf(lender2), 400000000);
        _eq(token.balanceOf(lender), 999999900);
    }

    function testDonationToEmptyPoolDoesNotBlockFutureDeposits() public {
        vm.prank(lender);
        token.transfer(address(pool), 1);
        bytes32 riskHash = pool.RISK_DISCLOSURE_HASH();
        vm.prank(lender);
        uint256 shares = pool.deposit(1, riskHash);
        _ok(shares != 0);
        vm.prank(lender);
        _eq(pool.redeem(shares), 1);
        _eq(token.balanceOf(address(pool)), 1);
    }

    function testRoundingCannotTrapTinyNewInvestorDeposit() public {
        bytes32 riskHash = pool.RISK_DISCLOSURE_HASH();
        vm.prank(lender);
        pool.deposit(1, riskHash);
        vm.prank(lender);
        token.transfer(address(pool), 996);
        pool.grantRole(pool.INVESTOR_ROLE(), lender2);
        vm.prank(lender2);
        token.approve(address(pool), 1);
        _eq(pool.previewDeposit(1), 0);
        vm.prank(lender2);
        vm.expectRevert(LiquidityPoolA.InvalidAmount.selector);
        pool.deposit(1, riskHash);
        _eq(token.balanceOf(lender2), 400000000);
    }

    function testOverdueUnpaidDealDoesNotPretendSharesAreRedeemable() public {
        uint256 shares = _deposit();
        _register(KEY, 0);
        _fundPool(KEY);
        vm.warp(registry.getTerms(KEY).invoiceDueAt + 1);

        _ok(vault.isFinancingOverdue(KEY));
        _eq(token.balanceOf(address(pool)), 930000000);
        _eq(pool.totalAssets(), 1000000000); // Nominal book value, not recoverable cash.
        vm.expectRevert(LiquidityPoolA.CapitalLocked.selector);
        vm.prank(lender);
        pool.redeem(shares);
    }
}
