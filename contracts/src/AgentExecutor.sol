// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RWARegistry} from "./RWARegistry.sol";
import {FinancingVault} from "./FinancingVault.sol";

/// @notice Narrow guardian; cannot hold assets, register, fund, clear holds or withdraw.
contract AgentExecutor is AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    RWARegistry public immutable registry;
    FinancingVault public immutable vault;
    mapping(bytes32 => bool) public usedActionIds;
    error InvalidConfiguration();
    error InvalidAction();
    event AgentFundingHold(bytes32 indexed claimKey, bytes32 indexed actionId, bytes32 evidenceCommitment);
    event RiskObservation(bytes32 indexed claimKey, bytes32 indexed actionId, bytes32 evidenceCommitment);

    constructor(address admin, address agent, address registry_, address vault_) {
        if (admin == address(0) || agent == address(0) || registry_.code.length == 0 || vault_.code.length == 0
            || (block.chainid != 97 && block.chainid != 31337)
            || address(FinancingVault(vault_).registry()) != registry_) revert InvalidConfiguration();
        registry = RWARegistry(registry_);
        vault = FinancingVault(vault_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, agent);
    }

    function proposeFundingHold(bytes32 key, bytes32 actionId, bytes32 evidenceCommitment) external onlyRole(AGENT_ROLE) {
        _consumeAction(key, actionId, evidenceCommitment);
        registry.setFundingHold(key, evidenceCommitment);
        emit AgentFundingHold(key, actionId, evidenceCommitment);
    }
    function recordRiskObservation(bytes32 key, bytes32 actionId, bytes32 evidenceCommitment) external onlyRole(AGENT_ROLE) {
        _consumeAction(key, actionId, evidenceCommitment);
        emit RiskObservation(key, actionId, evidenceCommitment);
    }
    function _consumeAction(bytes32 key, bytes32 actionId, bytes32 evidenceCommitment) internal {
        if (actionId == bytes32(0) || evidenceCommitment == bytes32(0) || usedActionIds[actionId] || !registry.isKnownClaim(key)) revert InvalidAction();
        usedActionIds[actionId] = true;
    }
}
