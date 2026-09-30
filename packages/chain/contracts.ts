// Generated from Foundry artifacts; regenerate with node contracts/script/export-abis.mjs.
export const mockIdrAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEMO_MINTER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [
      {
        name: "interfaceId",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      {
        name: "from",
        type: "address",
        internalType: "address",
      },
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccessControlBadConfirmation",
    inputs: [],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "neededRole",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
      {
        name: "allowance",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "needed",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      {
        name: "sender",
        type: "address",
        internalType: "address",
      },
      {
        name: "balance",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "needed",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InvalidApprover",
    inputs: [
      {
        name: "approver",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InvalidReceiver",
    inputs: [
      {
        name: "receiver",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InvalidSender",
    inputs: [
      {
        name: "sender",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "ERC20InvalidSpender",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
] as const;

export const registryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "verifier",
        type: "address",
        internalType: "address",
      },
      {
        name: "token_",
        type: "address",
        internalType: "address",
      },
      {
        name: "advanceBps_",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "feeBps_",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "cap_",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "BORROWER_CONSENT_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "BUYER_ACKNOWLEDGEMENT_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VERIFIER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "agentExecutor",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canFund",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "cancelBeforeFunding",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "clearFundingHold",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "freshReviewHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "freshReviewExpiry",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "configureEndpoints",
    inputs: [
      {
        name: "vault_",
        type: "address",
        internalType: "address",
      },
      {
        name: "executor_",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "consentDigest",
    inputs: [
      {
        name: "terms",
        type: "tuple",
        internalType: "struct RWARegistry.Terms",
        components: [
          {
            name: "claimKey",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "version",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrower",
            type: "address",
            internalType: "address",
          },
          {
            name: "buyer",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "acceptedOutstanding",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "principal",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fee",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fundingDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invoiceDueAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reviewExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "consentExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "nonce",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "isBuyer",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1",
      },
      {
        name: "name",
        type: "string",
        internalType: "string",
      },
      {
        name: "version",
        type: "string",
        internalType: "string",
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "flatFinancingFeeBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getClaim",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "terms",
        type: "tuple",
        internalType: "struct RWARegistry.Terms",
        components: [
          {
            name: "claimKey",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "version",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrower",
            type: "address",
            internalType: "address",
          },
          {
            name: "buyer",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "acceptedOutstanding",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "principal",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fee",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fundingDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invoiceDueAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reviewExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "consentExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "termsHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "state",
        type: "uint8",
        internalType: "enum RWARegistry.RegistryState",
      },
      {
        name: "fundingHold",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTerms",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct RWARegistry.Terms",
        components: [
          {
            name: "claimKey",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "version",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrower",
            type: "address",
            internalType: "address",
          },
          {
            name: "buyer",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "acceptedOutstanding",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "principal",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fee",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fundingDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invoiceDueAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reviewExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "consentExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hashTerms",
    inputs: [
      {
        name: "terms",
        type: "tuple",
        internalType: "struct RWARegistry.Terms",
        components: [
          {
            name: "claimKey",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "version",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrower",
            type: "address",
            internalType: "address",
          },
          {
            name: "buyer",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "acceptedOutstanding",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "principal",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fee",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fundingDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invoiceDueAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reviewExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "consentExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "invalidateConsentNonce",
    inputs: [
      {
        name: "nonce",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isKnownClaim",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastHoldReviewHash",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "markFunded",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "maxAdvanceBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonceUnavailable",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "perDealPrincipalCap",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerApprovedClaim",
    inputs: [
      {
        name: "terms",
        type: "tuple",
        internalType: "struct RWARegistry.Terms",
        components: [
          {
            name: "claimKey",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "version",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrower",
            type: "address",
            internalType: "address",
          },
          {
            name: "buyer",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "acceptedOutstanding",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "principal",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fee",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "fundingDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invoiceDueAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "reviewExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "consentExpiry",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "evidenceCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "borrowerConsent",
        type: "tuple",
        internalType: "struct RWARegistry.Consent",
        components: [
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "buyerConsent",
        type: "tuple",
        internalType: "struct RWARegistry.Consent",
        components: [
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setFundingHold",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [
      {
        name: "interfaceId",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vault",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ClaimCancelled",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "actor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimFunded",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimRegistered",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "termsHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "borrower",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "buyer",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "version",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ConsentNonceInvalidated",
    inputs: [
      {
        name: "signer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "EndpointsConfigured",
    inputs: [
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "agentExecutor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FundingHoldCleared",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "verifier",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "reviewHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "reviewExpiry",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FundingHoldSet",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "actor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccessControlBadConfirmation",
    inputs: [],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "neededRole",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "ClaimAlreadyExists",
    inputs: [],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignature",
    inputs: [],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureLength",
    inputs: [
      {
        name: "length",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureS",
    inputs: [
      {
        name: "s",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "Forbidden",
    inputs: [],
  },
  {
    type: "error",
    name: "FundingIneligible",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConsent",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidReview",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidTerms",
    inputs: [],
  },
  {
    type: "error",
    name: "MathOverflowedMulDiv",
    inputs: [],
  },
  {
    type: "error",
    name: "NonceUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string",
      },
    ],
  },
  {
    type: "error",
    name: "UnknownClaim",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedAccount",
    inputs: [],
  },
] as const;

export const vaultAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry_",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "LENDER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collectBuyerPayment",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundAndDisburse",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundingPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAccounting",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "a",
        type: "tuple",
        internalType: "struct FinancingVault.Accounting",
        components: [
          {
            name: "principalAllocated",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeAllocated",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrowerAllocated",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "lenderClaimable",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrowerClaimable",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "remainingLenderEntitlement",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "remainingInvoiceCollection",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "financingStatus",
            type: "uint8",
            internalType: "enum FinancingVault.FinancingStatus",
          },
          {
            name: "collectionStatus",
            type: "uint8",
            internalType: "enum FinancingVault.CollectionStatus",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDeal",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct FinancingVault.Deal",
        components: [
          {
            name: "lender",
            type: "address",
            internalType: "address",
          },
          {
            name: "totalCollected",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "lenderWithdrawn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "borrowerWithdrawn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "funded",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isFinancingOverdue",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isInvoiceOverdue",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract RWARegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setFundingPaused",
    inputs: [
      {
        name: "paused",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [
      {
        name: "interfaceId",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalLiabilities",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdrawBorrowerResidual",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawLender",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BorrowerWithdrawal",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "borrower",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BuyerPaymentCollected",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "buyer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "totalCollected",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Funded",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "lender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "borrower",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "principal",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FundingPauseChanged",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LenderWithdrawal",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "lender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccessControlBadConfirmation",
    inputs: [],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "neededRole",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [
      {
        name: "target",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "AddressInsufficientBalance",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "FailedInnerCall",
    inputs: [],
  },
  {
    type: "error",
    name: "Forbidden",
    inputs: [],
  },
  {
    type: "error",
    name: "FundingIneligible",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPayment",
    inputs: [],
  },
  {
    type: "error",
    name: "NotFunded",
    inputs: [],
  },
  {
    type: "error",
    name: "NothingToWithdraw",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
] as const;

export const executorAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "agent",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry_",
        type: "address",
        internalType: "address",
      },
      {
        name: "vault_",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "AGENT_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposeFundingHold",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "actionId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordRiskObservation",
    inputs: [
      {
        name: "key",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "actionId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract RWARegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [
      {
        name: "interfaceId",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedActionIds",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vault",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract FinancingVault",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AgentFundingHold",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "actionId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RiskObservation",
    inputs: [
      {
        name: "claimKey",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "actionId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "evidenceCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccessControlBadConfirmation",
    inputs: [],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "neededRole",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidAction",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
] as const;
