// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Synthetic, non-redeemable demonstration token. One unit is one simulated IDR.
contract MockIDR is ERC20, AccessControl {
    bytes32 public constant DEMO_MINTER_ROLE = keccak256("DEMO_MINTER_ROLE");
    error InvalidConfiguration();

    constructor(address admin) ERC20("TALUNAI Mock IDR - NO VALUE", "MockIDR") {
        if (admin == address(0) || (block.chainid != 97 && block.chainid != 31337)) revert InvalidConfiguration();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEMO_MINTER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) { return 0; }
    function mint(address to, uint256 amount) external onlyRole(DEMO_MINTER_ROLE) {
        if (to == address(0)) revert InvalidConfiguration();
        _mint(to, amount);
    }
}
