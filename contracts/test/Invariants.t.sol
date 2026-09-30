// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {TestBase,Vm} from "./TestBase.sol";
import {MockIDR} from "../src/MockIDR.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {FinancingVault} from "../src/FinancingVault.sol";
import {AgentExecutor} from "../src/AgentExecutor.sol";

/// @dev Deliberately schedules successful and invalid operations, including repeat funding.
contract FinancialHandler {
    Vm internal constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockIDR public token; RWARegistry public registry; FinancingVault public vault; AgentExecutor public executor;
    address public borrower; address public buyer; address public lender; address public verifier; address public agent;
    bytes32[2] public keys;
    uint256[2] public successfulFundings;
    uint256 public actionNonce;
    uint256 public donations;
    constructor(MockIDR token_,RWARegistry registry_,FinancingVault vault_,AgentExecutor executor_,address borrower_,address buyer_,address lender_,address verifier_,address agent_,bytes32 key1,bytes32 key2) {
        token=token_; registry=registry_; vault=vault_; executor=executor_; borrower=borrower_; buyer=buyer_; lender=lender_; verifier=verifier_; agent=agent_; keys=[key1,key2];
    }
    function fund(uint256 index) external {
        index%=2; vm.prank(lender);
        try vault.fundAndDisburse(keys[index]) {successfulFundings[index]++;} catch {}
    }
    function collect(uint256 index,uint256 rawAmount) external {
        vm.prank(buyer); try vault.collectBuyerPayment(keys[index%2],1+(rawAmount%100000001)) {} catch {}
    }
    function withdraw(uint256 index,bool isBorrower) external {
        vm.prank(isBorrower?borrower:lender);
        if(isBorrower) {try vault.withdrawBorrowerResidual(keys[index%2]) {} catch {}}
        else {try vault.withdrawLender(keys[index%2]) {} catch {}}
    }
    function hold(uint256 index) external {
        actionNonce++; vm.prank(agent);
        try executor.proposeFundingHold(keys[index%2],keccak256(abi.encode(actionNonce)),keccak256("authorized-dispute")) {} catch {}
    }
    function clear(uint256 index) external {
        actionNonce++; uint256 expiry=registry.getTerms(keys[index%2]).reviewExpiry; vm.prank(verifier);
        try registry.clearFundingHold(keys[index%2],keccak256(abi.encode("human-review",actionNonce)),expiry) {} catch {}
    }
    function cancel(uint256 index) external {
        vm.prank(buyer); try registry.cancelBeforeFunding(keys[index%2]) {} catch {}
    }
    function elapse(uint256 rawDelta) external { vm.warp(block.timestamp+(rawDelta%1 days)); }
    function donate(uint256 rawAmount) external {
        uint256 amount=rawAmount%1000;
        if(amount==0 || token.balanceOf(buyer)<amount) return;
        vm.prank(buyer); token.transfer(address(vault),amount); donations+=amount;
    }
}

contract TalunaiInvariantTest is TestBase {
    FinancialHandler internal handler;
    bytes32 internal constant SECOND=keccak256("synthetic-cocoa-002");
    function setUp() public override {
        super.setUp(); _register(KEY,0); _register(SECOND,1);
        handler=new FinancialHandler(token,registry,vault,executor,borrower,buyer,lender,verifier,agent,KEY,SECOND);
    }
    // Foundry discovers this interface directly, avoiding an unpinned forge-std dependency.
    function targetContracts() external view returns(address[] memory targets) {
        targets=new address[](1); targets[0]=address(handler);
    }
    function invariantAllocationsEqualActualCollections() public view {
        _checkDeal(KEY); _checkDeal(SECOND);
    }
    function _checkDeal(bytes32 key) internal view {
        FinancingVault.Accounting memory a=vault.getAccounting(key); FinancingVault.Deal memory d=vault.getDeal(key);
        require(a.principalAllocated+a.feeAllocated+a.borrowerAllocated==d.totalCollected,"waterfall conservation");
        require(d.lenderWithdrawn<=a.principalAllocated+a.feeAllocated,"lender overdraw");
        require(d.borrowerWithdrawn<=a.borrowerAllocated,"borrower overdraw");
        require(d.totalCollected<=100000000,"invoice overcollection");
        require(a.lenderClaimable+a.borrowerClaimable+d.lenderWithdrawn+d.borrowerWithdrawn==d.totalCollected,"claim conservation");
    }
    function invariantVaultCoversIsolatedLiabilitiesAndDonationsNeverCreateCredit() public view {
        FinancingVault.Accounting memory a=vault.getAccounting(KEY); FinancingVault.Accounting memory b=vault.getAccounting(SECOND);
        uint256 liabilities=a.lenderClaimable+a.borrowerClaimable+b.lenderClaimable+b.borrowerClaimable;
        require(liabilities==vault.totalLiabilities(),"global liabilities mismatch");
        require(token.balanceOf(address(vault))==liabilities+handler.donations(),"assets mismatch");
    }
    function invariantFundingExactlyOnceToImmutableBorrower() public view {
        require(handler.successfulFundings(0)<=1 && handler.successfulFundings(1)<=1,"multiple funding");
        FinancingVault.Deal memory a=vault.getDeal(KEY); FinancingVault.Deal memory b=vault.getDeal(SECOND);
        uint256 funded=(a.funded?1:0)+(b.funded?1:0);
        require(token.balanceOf(borrower)==funded*70000000+a.borrowerWithdrawn+b.borrowerWithdrawn,"payout conservation");
        require(token.balanceOf(lender)==400000000-funded*70000000+a.lenderWithdrawn+b.lenderWithdrawn,"lender conservation");
        require(!a.funded || a.lender==lender,"wrong lender A");
        require(!b.funded || b.lender==lender,"wrong lender B");
    }
}
