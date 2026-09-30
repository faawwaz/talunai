// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {TestBase} from "./TestBase.sol";
import {MockIDR} from "../src/MockIDR.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {FinancingVault} from "../src/FinancingVault.sol";
import {AgentExecutor} from "../src/AgentExecutor.sol";

contract TalunaiTest is TestBase {
    function testHappyPathAndDistinctStatuses() public {
        _fund();
        _eq(token.balanceOf(borrower), 70000000);
        _eq(token.balanceOf(address(vault)), 0);
        _collect(50000000);
        FinancingVault.Accounting memory a = vault.getAccounting(KEY);
        _eq(a.principalAllocated, 50000000); _eq(a.feeAllocated, 0); _eq(a.borrowerAllocated, 0);
        _eq(a.remainingLenderEntitlement, 21050000); _eq(a.remainingInvoiceCollection, 50000000);
        vm.prank(lender); vault.withdrawLender(KEY);
        _collect(21050000);
        a = vault.getAccounting(KEY);
        _eq(uint256(a.financingStatus), 3); _eq(uint256(a.collectionStatus), 1);
        _eq(a.remainingInvoiceCollection, 28950000); _eq(a.lenderClaimable, 21050000);
        _collect(28950000);
        a = vault.getAccounting(KEY);
        _eq(uint256(a.collectionStatus), 2); _eq(a.borrowerClaimable, 28950000);
        vm.prank(lender); vault.withdrawLender(KEY);
        vm.prank(borrower); vault.withdrawBorrowerResidual(KEY);
        _eq(token.balanceOf(borrower), 98950000); _eq(token.balanceOf(lender), 401050000);
        _eq(token.balanceOf(address(vault)), 0); _eq(vault.totalLiabilities(), 0);
    }
    function testFeeAllocatedOnlyAfterPrincipal() public {
        _fund(); _collect(70000001);
        FinancingVault.Accounting memory a = vault.getAccounting(KEY);
        _eq(a.principalAllocated, 70000000); _eq(a.feeAllocated, 1); _eq(a.borrowerAllocated, 0);
    }
    function testDuplicateClaimAndFundedOnceAfterRepayment() public {
        _fund(); _collect(100000000);
        vm.prank(lender2); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(KEY);
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms, 9, false); RWARegistry.Consent memory b = _consent(terms, 9, true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.ClaimAlreadyExists.selector); registry.registerApprovedClaim(terms,a,b);
        _eq(token.balanceOf(borrower), 70000000);
    }
    function testTwoLendersOnlyOneDisbursement() public {
        _register(KEY,0); vm.prank(lender); vault.fundAndDisburse(KEY);
        vm.prank(lender2); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(KEY);
        _eq(token.balanceOf(borrower),70000000); _eq(vault.getDeal(KEY).lender,lender);
        _eq(token.balanceOf(lender2),400000000);
    }
    function testRegistrationRequiresVerifierAndNoSelfReview() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        vm.prank(borrower); vm.expectRevert(); registry.registerApprovedClaim(terms,a,b);
        registry.grantRole(registry.VERIFIER_ROLE(),borrower);
        vm.prank(borrower); vm.expectRevert(RWARegistry.Forbidden.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testWrongSignerAndSwappedConsentTypesFail() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,b,a);
        bytes32 wrongDigest = registry.consentDigest(terms,0,terms.consentExpiry,true);
        (uint8 v,bytes32 r,bytes32 s) = vm.sign(BORROWER_KEY,wrongDigest);
        a.signature = abi.encodePacked(r,s,v);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testAmountRecipientAndVersionTamperingFails() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        terms.principal = 60000000; terms.fee = 900000;
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
        terms = _terms(KEY); terms.borrower = lender;
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
        terms = _terms(KEY); terms.version = 2;
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testChainAndRegistryDomainReplayFail() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        vm.chainId(97);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
        vm.chainId(31337);
        RWARegistry second = new RWARegistry(address(this),verifier,address(token),8000,150,100000000);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); second.registerApprovedClaim(terms,a,b);
    }
    function testNonceConsumedAcrossClaimsAndRevoked() public {
        _register(KEY,0);
        RWARegistry.Terms memory terms = _terms(keccak256("second"));
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.NonceUnavailable.selector); registry.registerApprovedClaim(terms,a,b);
        vm.prank(borrower); registry.invalidateConsentNonce(10);
        a = _consent(terms,10,false); b = _consent(terms,10,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.NonceUnavailable.selector); registry.registerApprovedClaim(terms,a,b);
        _ok(!registry.nonceUnavailable(buyer,10));
    }
    function testInvalidSecondSignatureRollsBackFirstNonce() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        b.signature = a.signature;
        vm.prank(verifier); vm.expectRevert(); registry.registerApprovedClaim(terms,a,b);
        _ok(!registry.nonceUnavailable(borrower,0));
    }
    function testExpiredConsentAndMismatchedDeadlineFail() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        a.deadline--;
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidConsent.selector); registry.registerApprovedClaim(terms,a,b);
        a.deadline++; vm.warp(terms.consentExpiry + 1);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidTerms.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testImmutableCapsFeesAndFundingWindowEnforced() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        _expectInvalidTerms(terms,1); _expectInvalidTerms(terms,2); _expectInvalidTerms(terms,3);
        _expectInvalidTerms(terms,4); _expectInvalidTerms(terms,5); _expectInvalidTerms(terms,6);
        _expectInvalidTerms(terms,7); _expectInvalidTerms(terms,8); _expectInvalidTerms(terms,9);
    }
    function _expectInvalidTerms(RWARegistry.Terms memory original,uint256 mutation) internal {
        RWARegistry.Terms memory terms = abi.decode(abi.encode(original),(RWARegistry.Terms));
        if (mutation==1) terms.principal=0;
        if (mutation==2) {terms.principal=80000001; terms.fee=1200001;}
        if (mutation==3) {terms.principal=100000001; terms.acceptedOutstanding=200000000; terms.fee=1500001;}
        if (mutation==4) terms.fee=1;
        if (mutation==5) terms.fundingDeadline=block.timestamp+25 hours;
        if (mutation==6) terms.invoiceDueAt=terms.fundingDeadline;
        if (mutation==7) terms.reviewExpiry=terms.fundingDeadline-1;
        if (mutation==8) terms.acceptedOutstanding=0;
        if (mutation==9) terms.consentExpiry=terms.fundingDeadline-1;
        RWARegistry.Consent memory a = _consent(terms,mutation,false); RWARegistry.Consent memory b = _consent(terms,mutation,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidTerms.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testWrongTokenAndContractWalletRejected() public {
        RWARegistry.Terms memory terms = _terms(KEY);
        MockIDR impostor = new MockIDR(address(this)); terms.token=address(impostor);
        RWARegistry.Consent memory a = _consent(terms,0,false); RWARegistry.Consent memory b = _consent(terms,0,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidTerms.selector); registry.registerApprovedClaim(terms,a,b);
        terms=_terms(KEY); terms.borrower=address(token);
        a=_consent(terms,0,false); b=_consent(terms,0,true);
        vm.prank(verifier); vm.expectRevert(RWARegistry.UnsupportedAccount.selector); registry.registerApprovedClaim(terms,a,b);
    }
    function testAllowanceOrBalanceFailureRollsBackFunding() public {
        _register(KEY,0);
        vm.prank(lender); token.approve(address(vault),0);
        vm.prank(lender); vm.expectRevert(); vault.fundAndDisburse(KEY);
        _ok(registry.canFund(KEY)); _ok(!vault.getDeal(KEY).funded); _eq(token.balanceOf(borrower),0);
        vm.prank(lender2); token.transfer(address(123),400000000);
        vm.prank(lender2); vm.expectRevert(); vault.fundAndDisburse(KEY);
        _ok(registry.canFund(KEY)); _ok(!vault.getDeal(KEY).funded);
    }
    function testLenderAllowlistAndAddressConflict() public {
        _register(KEY,0);
        vm.prank(borrower); vm.expectRevert(); vault.fundAndDisburse(KEY);
        vault.grantRole(vault.LENDER_ROLE(),borrower);
        vm.prank(borrower); vm.expectRevert(FinancingVault.Forbidden.selector); vault.fundAndDisburse(KEY);
        vault.grantRole(vault.LENDER_ROLE(),buyer);
        vm.prank(buyer); vm.expectRevert(FinancingVault.Forbidden.selector); vault.fundAndDisburse(KEY);
    }
    function testHoldHumanClearAndReplayGuard() public {
        _register(KEY,0);
        vm.prank(agent); executor.proposeFundingHold(KEY,keccak256("action"),keccak256("dispute"));
        vm.prank(lender); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(KEY);
        vm.prank(agent); vm.expectRevert(); registry.clearFundingHold(KEY,keccak256("new-review"),block.timestamp+24 hours);
        vm.prank(agent); vm.expectRevert(AgentExecutor.InvalidAction.selector); executor.proposeFundingHold(KEY,keccak256("action"),keccak256("dispute"));
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidReview.selector); registry.clearFundingHold(KEY,keccak256("review"),block.timestamp+24 hours);
        vm.prank(verifier); registry.clearFundingHold(KEY,keccak256("new-review"),block.timestamp+24 hours);
        vm.prank(lender); vault.fundAndDisburse(KEY);
        _eq(token.balanceOf(borrower),70000000);
    }
    function testPartyGrantedVerifierCannotClearOwnFundingHold() public {
        _register(KEY,0);
        vm.prank(agent); executor.proposeFundingHold(KEY,keccak256("party-hold"),keccak256("dispute"));
        registry.grantRole(registry.VERIFIER_ROLE(),borrower);
        registry.grantRole(registry.VERIFIER_ROLE(),buyer);
        uint256 expiry=registry.getTerms(KEY).reviewExpiry;
        vm.prank(borrower); vm.expectRevert(RWARegistry.Forbidden.selector);
        registry.clearFundingHold(KEY,keccak256("borrower-review"),expiry);
        vm.prank(buyer); vm.expectRevert(RWARegistry.Forbidden.selector);
        registry.clearFundingHold(KEY,keccak256("buyer-review"),expiry);
        _ok(!registry.canFund(KEY));
        vm.prank(verifier); registry.clearFundingHold(KEY,keccak256("independent-review"),expiry);
        _ok(registry.canFund(KEY));
    }
    function testUnknownAgentActionsAndMissingCommitmentsRejected() public {
        vm.prank(agent); vm.expectRevert(AgentExecutor.InvalidAction.selector); executor.proposeFundingHold(KEY,keccak256("a"),keccak256("b"));
        _register(KEY,0);
        vm.prank(agent); vm.expectRevert(AgentExecutor.InvalidAction.selector); executor.proposeFundingHold(KEY,keccak256("a"),bytes32(0));
        vm.prank(lender); vm.expectRevert(); executor.proposeFundingHold(KEY,keccak256("a"),keccak256("b"));
    }
    function testExpiryAndCancelledClaimPermanent() public {
        _register(KEY,0);
        vm.prank(buyer); registry.cancelBeforeFunding(KEY);
        vm.prank(lender); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(KEY);
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidReview.selector); registry.clearFundingHold(KEY,keccak256("new"),block.timestamp+24 hours);
        bytes32 second=keccak256("second"); _register(second,1); vm.warp(block.timestamp+13 hours);
        vm.prank(lender); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(second);
        vm.prank(verifier); registry.setFundingHold(second,keccak256("late"));
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidReview.selector); registry.clearFundingHold(second,keccak256("new"),block.timestamp+1 hours);
    }
    function testFundedCannotBeCancelledAndRiskDoesNotReverseDisbursement() public {
        _fund(); vm.prank(borrower); vm.expectRevert(RWARegistry.FundingIneligible.selector); registry.cancelBeforeFunding(KEY);
        vm.prank(agent); executor.recordRiskObservation(KEY,keccak256("risk"),keccak256("evidence"));
        vm.prank(agent); vm.expectRevert(RWARegistry.InvalidReview.selector);
        executor.proposeFundingHold(KEY,keccak256("hold"),keccak256("evidence"));
        vm.prank(verifier); vm.expectRevert(RWARegistry.InvalidReview.selector);
        registry.setFundingHold(KEY,keccak256("evidence"));
        (,,,bool fundingHold)=registry.getClaim(KEY);
        _ok(!fundingHold);
        _eq(token.balanceOf(borrower),70000000); _collect(100000000);
        vm.prank(lender); vault.withdrawLender(KEY);
    }
    function testAgentCannotRegisterFundMintGrantClearOrWithdraw() public {
        _fund(); _collect(100000000);
        bytes32 role=vault.LENDER_ROLE();
        vm.prank(agent); vm.expectRevert(); vault.grantRole(role,agent);
        vm.prank(agent); vm.expectRevert(); token.mint(agent,1);
        vm.prank(agent); vm.expectRevert(); vault.withdrawLender(KEY);
        vm.prank(agent); vm.expectRevert(); vault.withdrawBorrowerResidual(KEY);
        vm.prank(agent); vm.expectRevert(); vault.fundAndDisburse(KEY);
        vm.prank(agent); vm.expectRevert(); registry.markFunded(KEY);
        RWARegistry.Terms memory terms=_terms(keccak256("second"));
        RWARegistry.Consent memory a=_consent(terms,1,false); RWARegistry.Consent memory b=_consent(terms,1,true);
        vm.prank(agent); vm.expectRevert(); registry.registerApprovedClaim(terms,a,b);
    }
    function testUnfundedWrongPayerZeroAndOverpaymentRejected() public {
        _register(KEY,0);
        vm.prank(buyer); vm.expectRevert(FinancingVault.NotFunded.selector); vault.collectBuyerPayment(KEY,1);
        vm.prank(lender); vault.fundAndDisburse(KEY);
        vm.prank(borrower); vm.expectRevert(FinancingVault.Forbidden.selector); vault.collectBuyerPayment(KEY,1);
        vm.prank(lender2); vm.expectRevert(FinancingVault.Forbidden.selector); vault.collectBuyerPayment(KEY,1);
        vm.prank(buyer); vm.expectRevert(FinancingVault.InvalidPayment.selector); vault.collectBuyerPayment(KEY,0);
        vm.prank(buyer); vm.expectRevert(FinancingVault.InvalidPayment.selector); vault.collectBuyerPayment(KEY,100000001);
        _eq(token.balanceOf(buyer),400000000); _eq(vault.totalLiabilities(),0);
    }
    function testDuplicateWithdrawalsAndWrongBeneficiaryRejected() public {
        _fund(); _collect(100000000);
        vm.prank(lender2); vm.expectRevert(FinancingVault.Forbidden.selector); vault.withdrawLender(KEY);
        vm.prank(buyer); vm.expectRevert(FinancingVault.Forbidden.selector); vault.withdrawBorrowerResidual(KEY);
        vm.prank(lender); vault.withdrawLender(KEY);
        vm.prank(lender); vm.expectRevert(FinancingVault.NothingToWithdraw.selector); vault.withdrawLender(KEY);
        vm.prank(borrower); vault.withdrawBorrowerResidual(KEY);
        vm.prank(borrower); vm.expectRevert(FinancingVault.NothingToWithdraw.selector); vault.withdrawBorrowerResidual(KEY);
        _eq(vault.totalLiabilities(),0);
    }
    function testDealIsolationAndDonationsNotCollection() public {
        _fund(); bytes32 second=keccak256("second"); _register(second,1);
        vm.prank(lender2); vault.fundAndDisburse(second);
        _collect(50000000);
        vm.prank(lender2); vm.expectRevert(FinancingVault.NothingToWithdraw.selector); vault.withdrawLender(second);
        token.mint(address(vault),123);
        _eq(vault.getDeal(second).totalCollected,0); _eq(vault.totalLiabilities(),50000000);
        vm.prank(lender); vault.withdrawLender(KEY);
        _eq(token.balanceOf(address(vault)),123); _eq(vault.totalLiabilities(),0);
    }
    function testPauseOnlyNewFundingAndLatePaymentIsReal() public {
        _fund(); bytes32 second=keccak256("second"); _register(second,1);
        vault.setFundingPaused(true);
        vm.prank(lender2); vm.expectRevert(FinancingVault.FundingIneligible.selector); vault.fundAndDisburse(second);
        vm.warp(block.timestamp+46 days);
        _ok(vault.isFinancingOverdue(KEY)); _ok(vault.isInvoiceOverdue(KEY));
        _eq(vault.getAccounting(KEY).remainingLenderEntitlement,71050000);
        _collect(71050000); _ok(!vault.isFinancingOverdue(KEY)); _ok(vault.isInvoiceOverdue(KEY));
        vm.prank(lender); vault.withdrawLender(KEY);
        _collect(28950000); _ok(!vault.isInvoiceOverdue(KEY));
        vm.prank(borrower); vault.withdrawBorrowerResidual(KEY);
    }
    function testEndpointAndChainBootstrapRestrictions() public {
        vm.expectRevert(RWARegistry.InvalidConfiguration.selector); registry.configureEndpoints(address(vault),address(executor));
        vm.expectRevert(MockIDR.InvalidConfiguration.selector); new MockIDR(address(0));
        vm.expectRevert(RWARegistry.InvalidConfiguration.selector); new RWARegistry(address(this),address(0),address(token),8000,150,100000000);
        vm.expectRevert(RWARegistry.InvalidConfiguration.selector); new RWARegistry(address(this),verifier,address(token),9000,150,100000000);
        vm.chainId(56); vm.expectRevert(MockIDR.InvalidConfiguration.selector); new MockIDR(address(this));
    }
    function testFuzzWaterfallConservation(uint256 rawPayment,uint256 rawSplit) public {
        _fund(); uint256 payment=1+(rawPayment%100000000); uint256 first=rawSplit%(payment+1);
        if(first>0) _collect(first);
        if(first>0){vm.prank(lender); vault.withdrawLender(KEY);}
        if(payment>first) _collect(payment-first);
        FinancingVault.Accounting memory a=vault.getAccounting(KEY); FinancingVault.Deal memory d=vault.getDeal(KEY);
        _eq(a.principalAllocated+a.feeAllocated+a.borrowerAllocated,payment);
        _eq(a.lenderClaimable+a.borrowerClaimable+d.lenderWithdrawn+d.borrowerWithdrawn,payment);
        _eq(a.remainingInvoiceCollection,100000000-payment);
        _eq(token.balanceOf(address(vault)),vault.totalLiabilities());
        _ok(a.principalAllocated<=70000000); _ok(a.feeAllocated<=1050000);
    }
    function testFuzzFeeRoundingAndCap(uint256 rawPrincipal) public {
        uint256 principal=1+(rawPrincipal%80000000);
        RWARegistry.Terms memory terms=_terms(KEY); terms.principal=principal; terms.fee=(principal*150+9999)/10000;
        RWARegistry.Consent memory a=_consent(terms,0,false); RWARegistry.Consent memory b=_consent(terms,0,true);
        vm.prank(verifier); registry.registerApprovedClaim(terms,a,b);
        vm.prank(lender); vault.fundAndDisburse(KEY);
        _eq(token.balanceOf(borrower),principal);
        _collect(100000000); _eq(vault.getAccounting(KEY).borrowerAllocated,100000000-principal-terms.fee);
    }
}
