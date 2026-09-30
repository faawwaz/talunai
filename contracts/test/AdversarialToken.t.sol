// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {TestBase} from "./TestBase.sol";
import {MockIDR} from "../src/MockIDR.sol";
import {FinancingVault} from "../src/FinancingVault.sol";

contract AdversarialToken is MockIDR {
    bool public chargeFee;
    bool public failOutgoing;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    constructor(address admin) MockIDR(admin) {}
    function setFee(bool value) external { chargeFee=value; }
    function setFailOutgoing(bool value) external { failOutgoing=value; }
    function setCallback(address target,bytes calldata data) external { callbackTarget=target; callbackData=data; }
    function transfer(address to,uint256 value) public override returns(bool) {
        if(failOutgoing) return false;
        if(callbackTarget!=address(0)) {
            address target=callbackTarget; callbackTarget=address(0); callbackAttempted=true;
            (bool success,bytes memory result)=target.call(callbackData);
            callbackSucceeded=success;
            if(result.length>=4) { bytes4 selector; assembly { selector := mload(add(result,32)) } callbackError=selector; }
        }
        return super.transfer(to,value);
    }
    function _update(address from,address to,uint256 amount) internal override {
        if(chargeFee && from!=address(0) && to!=address(0) && amount>0) {
            super._update(from,to,amount-1); super._update(from,address(0),1);
        } else super._update(from,to,amount);
    }
}

contract AdversarialTokenTest is TestBase {
    AdversarialToken internal evil;
    function setUp() public override {
        super.setUp();
        evil=new AdversarialToken(address(this)); token=evil; _deployForToken(evil);
    }
    function testFeeOnTransferFundingRejectedAtomically() public {
        _register(KEY,0); evil.setFee(true);
        vm.prank(lender); vm.expectRevert(FinancingVault.UnsupportedTokenBehavior.selector); vault.fundAndDisburse(KEY);
        _ok(registry.canFund(KEY)); _ok(!vault.getDeal(KEY).funded);
        _eq(token.balanceOf(borrower),0); _eq(token.balanceOf(lender),400000000);
    }
    function testFeeOnTransferCollectionAndWithdrawalRejectedAtomically() public {
        _fund(); evil.setFee(true);
        vm.prank(buyer); vm.expectRevert(FinancingVault.UnsupportedTokenBehavior.selector); vault.collectBuyerPayment(KEY,50000000);
        _eq(vault.getDeal(KEY).totalCollected,0); _eq(vault.totalLiabilities(),0);
        evil.setFee(false); _collect(50000000); evil.setFee(true);
        vm.prank(lender); vm.expectRevert(FinancingVault.UnsupportedTokenBehavior.selector); vault.withdrawLender(KEY);
        _eq(vault.getAccounting(KEY).lenderClaimable,50000000); _eq(vault.totalLiabilities(),50000000);
    }
    function testRejectedPayoutRevertsLenderTransferAndRegistryMarker() public {
        _register(KEY,0); evil.setFailOutgoing(true);
        vm.prank(lender); vm.expectRevert(); vault.fundAndDisburse(KEY);
        _ok(registry.canFund(KEY)); _ok(!vault.getDeal(KEY).funded);
        _eq(token.balanceOf(lender),400000000); _eq(token.balanceOf(address(vault)),0);
    }
    function testReentrantWithdrawalBlockedByGuardWithoutDoubleCredit() public {
        _fund(); _collect(50000000);
        evil.setCallback(address(vault),abi.encodeCall(vault.withdrawLender,(KEY)));
        vm.prank(lender); vault.withdrawLender(KEY);
        _ok(evil.callbackAttempted()); _ok(!evil.callbackSucceeded());
        require(evil.callbackError()==bytes4(keccak256("ReentrancyGuardReentrantCall()")),"wrong rejection");
        _eq(vault.getDeal(KEY).lenderWithdrawn,50000000); _eq(vault.totalLiabilities(),0);
        _eq(token.balanceOf(lender),380000000);
    }
}
