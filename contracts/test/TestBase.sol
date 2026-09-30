// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockIDR} from "../src/MockIDR.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {FinancingVault} from "../src/FinancingVault.sol";
import {AgentExecutor} from "../src/AgentExecutor.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function warp(uint256) external;
    function chainId(uint256) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant BORROWER_KEY = 11;
    uint256 internal constant BUYER_KEY = 22;
    address internal borrower;
    address internal buyer;
    address internal lender;
    address internal lender2;
    address internal verifier;
    address internal agent;
    MockIDR internal token;
    RWARegistry internal registry;
    FinancingVault internal vault;
    AgentExecutor internal executor;
    bytes32 internal constant KEY = keccak256("synthetic-cocoa-001");

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(1800000000);
        borrower = vm.addr(BORROWER_KEY);
        buyer = vm.addr(BUYER_KEY);
        lender = vm.addr(33);
        lender2 = vm.addr(34);
        verifier = vm.addr(44);
        agent = vm.addr(55);
        token = new MockIDR(address(this));
        _deployForToken(token);
    }
    function _deployForToken(MockIDR token_) internal {
        registry = new RWARegistry(address(this), verifier, address(token_), 8000, 150, 100000000);
        vault = new FinancingVault(address(this), address(registry));
        executor = new AgentExecutor(address(this), agent, address(registry), address(vault));
        registry.configureEndpoints(address(vault), address(executor));
        vault.grantRole(vault.LENDER_ROLE(), lender);
        vault.grantRole(vault.LENDER_ROLE(), lender2);
        token_.mint(lender, 400000000);
        token_.mint(lender2, 400000000);
        token_.mint(buyer, 400000000);
        vm.prank(lender); token_.approve(address(vault), type(uint256).max);
        vm.prank(lender2); token_.approve(address(vault), type(uint256).max);
        vm.prank(buyer); token_.approve(address(vault), type(uint256).max);
    }
    function _terms(bytes32 key) internal view returns (RWARegistry.Terms memory) {
        return RWARegistry.Terms(key, 1, borrower, buyer, address(token), 100000000, 70000000, 1050000,
            block.timestamp + 12 hours, block.timestamp + 45 days, block.timestamp + 24 hours,
            block.timestamp + 24 hours, keccak256("salted-evidence"), keccak256("review"), keccak256("policy-v1"));
    }
    function _consent(RWARegistry.Terms memory terms, uint256 nonce, bool isBuyer) internal returns (RWARegistry.Consent memory) {
        bytes32 digest = registry.consentDigest(terms, nonce, terms.consentExpiry, isBuyer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(isBuyer ? BUYER_KEY : BORROWER_KEY, digest);
        return RWARegistry.Consent(nonce, terms.consentExpiry, abi.encodePacked(r, s, v));
    }
    function _register(bytes32 key, uint256 nonce) internal {
        RWARegistry.Terms memory terms = _terms(key);
        RWARegistry.Consent memory a = _consent(terms, nonce, false);
        RWARegistry.Consent memory b = _consent(terms, nonce, true);
        vm.prank(verifier);
        registry.registerApprovedClaim(terms, a, b);
    }
    function _fund() internal { _register(KEY, 0); vm.prank(lender); vault.fundAndDisburse(KEY); }
    function _collect(uint256 amount) internal { vm.prank(buyer); vault.collectBuyerPayment(KEY, amount); }
    function _eq(uint256 a, uint256 b) internal pure { require(a == b, "uint assertion failed"); }
    function _eq(address a, address b) internal pure { require(a == b, "address assertion failed"); }
    function _ok(bool result) internal pure { require(result, "bool assertion failed"); }
}
