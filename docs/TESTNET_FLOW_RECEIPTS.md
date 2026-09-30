# BSC Testnet synthetic invoice receipt

Verified 29 September 2026 on chain 97. Every amount below is **MockIDR with no monetary value**. The document agent ran in deterministic `mock` mode; no OpenRouter key was configured for this run.

Claim key: `0x998367ef366cc5d1603901fe3753e24c9589d185cd16a2f6a815f5e894c2154a`
Internal claim ID: `06721f35-2849-4b85-9f13-7687625a4d35`

The borrower submitted an invoice and evidence through the API. The worker completed analysis, an independent verifier approved the evidence, and the borrower and buyer signed EIP-712 consents before registration. The signatures and review are recorded offchain; the registration receipt proves that the registry accepted both signatures and the terms.

| Step | Actor | Confirmed transaction | Block |
| --- | --- | --- | ---: |
| Buyer gas top-up | Admin → buyer | [0x89eeeb8d…844b2](https://testnet.bscscan.com/tx/0x89eeeb8d2268cd29709e47aa8ead321866daf82bfd859646ef8225cfabd844b2) | 133829496 |
| Borrower gas top-up | Admin → borrower | [0x6b4df1d6…fe0a2c](https://testnet.bscscan.com/tx/0x6b4df1d6a059b271c8f48b0d6fc5177c3ca0f9a16e7e3db0c42d5ee79afe0a2c) | 133829508 |
| Investor gas top-up | Admin → lender | [0x50c67651…de5ff](https://testnet.bscscan.com/tx/0x50c67651cd25a0abcfb128853c6cb530694bbb1ab49813d170fd69f0ed8de5ff) | 133829521 |
| Register approved invoice | Verifier | [0xfabf51f0…23dad](https://testnet.bscscan.com/tx/0xfabf51f052e848237e832f3f25f1bb90927013e87976fed4e3ef5d83fe523dad) | 133829727 |
| Allocate 70,000,000 from Pool A | Admin allocator | [0x10eb8de1…b9fae](https://testnet.bscscan.com/tx/0x10eb8de13f2b2fc758dbcd82c0bda09e91d5f6e0c74f1b883b539599c98b9fae) | 133829784 |
| Approve buyer payment | Buyer | [0x9cfebed4…b06c8](https://testnet.bscscan.com/tx/0x9cfebed42b1c80b11e4bd6d92c73e1c5374a31f242fa6f1e1cac109745eb06c8) | 133829877 |
| Pay 100,000,000 invoice | Buyer | [0x1fc3026d…d287e](https://testnet.bscscan.com/tx/0x1fc3026d8d67db98288ad0d6ce02a26fd5d91a53954ca9409d428921783d287e) | 133829917 |
| Harvest 71,050,000 lender entitlement | Admin; harvest is permissionless | [0x1e3963c1…f09da](https://testnet.bscscan.com/tx/0x1e3963c18b7bf95867e21ad1ffe13869da35e5e6b6315dc1bf113f84c42f09da) | 133829952 |
| Withdraw 28,950,000 borrower residual | Borrower | [0x4dbbda42…977ba](https://testnet.bscscan.com/tx/0x4dbbda42b3947c12cfaf787a8a43a59b6f8829fc944c40d916c434c89c0977ba) | 133829989 |
| Redeem 1,000,000,000 shares for 1,001,050,000 | Investor | [0x04caa885…6ba86](https://testnet.bscscan.com/tx/0x04caa885263c69dacac61f7e70df3600c5d91b0abccaff52a841427281b6ba86) | 133830000 |
| Approve repeat deposit | Investor | [0x04e91e5f…97e73](https://testnet.bscscan.com/tx/0x04e91e5f1a2c10e888252a833c1e341ca4cd8c39f729524746b203fcaa497e73) | 133830009 |
| Re-deposit 1,001,050,000 with risk acknowledgement | Investor | [0x3823003f…ba1ce](https://testnet.bscscan.com/tx/0x3823003fbc2061d26ea7839bca3a456a5fc43eb7f97998096b44994e997ba1ce) | 133830027 |

The receipts were confirmed by at least three blocks and checked against their canonical block hashes. The finance indexer reached block `133830069` with `degraded=false`; the onchain accounting and database projection agree:

| Measure | Verified MockIDR |
| --- | ---: |
| Original pool deposit | 1,000,000,000 |
| Principal disbursed | 70,000,000 |
| Buyer invoice paid | 100,000,000 |
| Principal returned to lender | 70,000,000 |
| Realized financing fee | 1,050,000 |
| Borrower residual withdrawn | 28,950,000 |
| Final pool idle/book assets and investor shares | 1,001,050,000 |
| Remaining principal, unharvested claim, active deals | 0 |

The vault reports `REPAID` and `FULLY_COLLECTED`. This single rapid synthetic cycle proves fee allocation and redeemability after repayment; it does **not** establish a meaningful realized APY or predict future yield. The complete machine-readable hashes and block numbers are in [`deployments/bsc-testnet-flow-smoke.json`](../deployments/bsc-testnet-flow-smoke.json).
