import { erc20Abi, createTestClient, http } from "viem";
import { writeFileSync } from "node:fs";
import { closeDb } from "../packages/db";
import { createHash } from "node:crypto";
import { parseDocument } from "../packages/agents/documents";
import { extractDeterministic } from "../packages/agents/extraction";
import {
  stopLocalWorker,
  resumeLocalWorker,
  runIndexerChild,
} from "./worker-control";
import { chainConfig, publicClient } from "../packages/chain/config";
import { indexOnce } from "../packages/chain/indexer";
import { vaultAbi, registryAbi } from "../packages/chain/contracts";
import {
  check,
  createAnalyzed,
  funding,
  poll,
  registered,
  sessions,
} from "./demo-lib";
const mode = process.argv[2] ?? "happy",
  config = chainConfig(),
  client = publicClient();
if (config.chainId !== 31337 || process.env.APP_ENV !== "local")
  throw new Error("DEMO_REQUIRES_LOCAL_ANVIL");
if ((await client.getChainId()) !== 31337)
  throw new Error("RPC_CHAIN_MISMATCH");
const testClient = createTestClient({
  chain: config.chain,
  transport: http(config.rpc),
  mode: "anvil",
});
const s = await sessions();
try {
  if (mode === "injection") {
    for (const kind of ["injection", "missing", "conflict"]) {
      const d = await createAnalyzed(s, kind);
      check(`${kind} readiness`, d.claim.workflow, "NEEDS_REVIEW");
      check(
        `${kind} immutable recipient`,
        d.claim.terms.borrower,
        s.borrower.account.address.toLowerCase(),
      );
      console.log(
        JSON.stringify({
          branch: kind,
          claimId: d.claim.id,
          analysis: d.analysis.result,
        }),
      );
      await s.verifier.request(
        `/v1/claims/${d.claim.id}/actions/prepare`,
        "POST",
        { expectedVersion: d.claim.version, action: "REGISTER" },
        undefined,
        409,
      );
    }
  } else {
    const d = await registered(s, mode),
      claim = d.claim;
    if (mode === "duplicate") {
      await funding(s, claim);
      const changedBytes = Buffer.from(
        `${d.text}\nexportMetadata: another synthetic export with different bytes\n`,
      );
      const parsed = await parseDocument(
        changedBytes,
        "different-export.txt",
        "text/plain",
      );
      const extracted = extractDeterministic([
        {
          id: d.document.documentId,
          text: parsed.text,
          pages: parsed.pages,
          status: parsed.status,
        },
      ]);
      check(
        "different file same invoice",
        extracted.invoiceNumber.value,
        d.input.invoiceNumber,
      );
      check(
        "byte hashes differ",
        createHash("sha256").update(d.text).digest("hex") !==
          createHash("sha256").update(changedBytes).digest("hex"),
        true,
      );
      const alteredInvoice = {
        ...d.input,
        invoiceNumber: ` ${d.input.invoiceNumber.toLowerCase()} `,
      };
      await s.borrower.request(
        "/v1/claims",
        "POST",
        alteredInvoice,
        undefined,
        409,
      );
      console.log(
        JSON.stringify({
          claimId: claim.id,
          changedFileHashWouldNotChangeCanonicalIdentity: true,
          duplicate: "REJECTED_409",
          actual: "one registered and funded claim",
        }),
      );
    } else if (mode === "hold") {
      const dispute = await s.buyer.request<{ actionId: string }>(
        `/v1/claims/${claim.id}/disputes`,
        "POST",
        {
          expectedVersion: claim.version,
          evidenceId: d.document.documentId,
          reason: "Buyer raises attributable synthetic invoice dispute.",
        },
      );
      await poll(
        () =>
          client.readContract({
            address: config.registry,
            abi: registryAbi,
            functionName: "getClaim",
            args: [claim.claimKey],
          }),
        (v) => v[3],
        "agent onchain hold",
      );
      check(
        "canFund while held",
        await client.readContract({
          address: config.registry,
          abi: registryAbi,
          functionName: "canFund",
          args: [claim.claimKey],
        }),
        false,
      );
      let rejected = false;
      try {
        await client.simulateContract({
          address: config.vault,
          abi: vaultAbi,
          functionName: "fundAndDisburse",
          args: [claim.claimKey],
          account: s.lender.account,
        });
      } catch {
        rejected = true;
      }
      check("direct lender funding reverts", rejected, true);
      await s.verifier.request(`/v1/claims/${claim.id}/review`, "POST", {
        expectedVersion: claim.version,
        decision: "APPROVE",
        reason: "Buyer dispute resolved by synthetic independent human review.",
        evidenceIds: [d.document.documentId],
        resolvesDispute: true,
      });
      await s.verifier.transaction(claim, "CLEAR_HOLD");
      await poll(
        () =>
          client.readContract({
            address: config.registry,
            abi: registryAbi,
            functionName: "getClaim",
            args: [claim.claimKey],
          }),
        (v) => !v[3],
        "human clears hold",
      );
      console.log(
        JSON.stringify({
          dispute: dispute.actionId,
          hold: "ONCHAIN_CONFIRMED",
          humanClear: "CONFIRMED",
          principalDisbursed: "0",
        }),
      );
    } else {
      const before = await client.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [s.borrower.account.address],
      });
      await funding(s, claim);
      const after = await client.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [s.borrower.account.address],
      });
      check(
        "atomic borrower disbursement",
        (after - before).toString(),
        "70000000",
      );
      await s.buyer.transaction(claim, "APPROVE_TOKEN", {
        amount: "100000000",
      });
      if (mode === "late") {
        const snapshot = await testClient.snapshot();
        try {
          await testClient.setNextBlockTimestamp({
            timestamp: BigInt(claim.terms.invoiceDueAt) + 3600n,
          });
          await testClient.mine({ blocks: 1 });
          await indexOnce();
          let f = await s.lender.request<Record<string, unknown>>(
            `/v1/claims/${claim.id}/financing`,
          );
          check("overdue true", f.financingOverdue, true);
          check("real outstanding retained", f.lenderOutstanding, "71050000");
          await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
            amount: "50000000",
          });
          await indexOnce();
          f = await s.lender.request(`/v1/claims/${claim.id}/financing`);
          check(
            "late collection reduces outstanding",
            f.lenderOutstanding,
            "21050000",
          );
        } finally {
          await testClient.revert({ id: snapshot });
          await indexOnce();
          console.log(
            "Anvil time-travel branch reverted to snapshot; projection replayed from canonical events.",
          );
        }
      } else if (mode === "restart" || mode === "reorg") {
        const snapshot = await testClient.snapshot();
        if (mode === "restart") await stopLocalWorker();
        await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
          amount: "50000000",
        });
        if (mode === "restart") {
          try {
            check(
              "indexer process fails before commit",
              await runIndexerChild(true),
              1,
            );
            check("new indexer process recovers", await runIndexerChild(), 0);
            check("second process replay succeeds", await runIndexerChild(), 0);
            const f = await s.lender.request<Record<string, unknown>>(
              `/v1/claims/${claim.id}/financing`,
            );
            check(
              "replay does not double credit",
              f.totalCollected,
              "50000000",
            );
            const deal = await client.readContract({
              address: config.vault,
              abi: vaultAbi,
              functionName: "getDeal",
              args: [claim.claimKey],
            });
            check(
              "one disbursement and one payment",
              deal.totalCollected.toString(),
              "50000000",
            );
          } finally {
            resumeLocalWorker();
          }
        } else {
          await indexOnce();
          await testClient.revert({ id: snapshot });
          await testClient.mine({ blocks: 1 });
          await indexOnce();
          const f = await s.lender.request<Record<string, unknown>>(
            `/v1/claims/${claim.id}/financing`,
          );
          check("reorg removed collection", f.totalCollected, "0");
        }
      } else {
        await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
          amount: "50000000",
        });
        let f = await poll(
          () =>
            s.lender.request<Record<string, unknown>>(
              `/v1/claims/${claim.id}/financing`,
            ),
          (f) => f.totalCollected === "50000000",
          "partial collection",
        );
        check("partial lender allocation", f.lenderClaimable, "50000000");
        check("partial unpaid entitlement", f.lenderOutstanding, "21050000");
        check("partial borrower residual", f.borrowerResidualClaimable, "0");
        await s.lender.transaction(claim, "WITHDRAW_LENDER");
        await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
          amount: "21050000",
        });
        f = await poll(
          () =>
            s.lender.request<Record<string, unknown>>(
              `/v1/claims/${claim.id}/financing`,
            ),
          (f) => f.totalCollected === "71050000",
          "financing repayment",
        );
        check("financing paid", f.financingStatus, "REPAID");
        check(
          "invoice not yet full",
          f.collectionStatus,
          "PARTIALLY_COLLECTED",
        );
        check("invoice remainder", f.remainingInvoiceCollection, "28950000");
        await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
          amount: "28950000",
        });
        await s.lender.transaction(claim, "WITHDRAW_LENDER");
        await s.borrower.transaction(claim, "WITHDRAW_BORROWER");
        f = await poll(
          () =>
            s.lender.request<Record<string, unknown>>(
              `/v1/claims/${claim.id}/financing`,
            ),
          (f) => f.borrowerWithdrawn === "28950000",
          "full settlement",
        );
        check("full invoice", f.collectionStatus, "FULLY_COLLECTED");
        check("lender total withdrawn", f.lenderWithdrawn, "71050000");
        check("borrower residual withdrawn", f.borrowerWithdrawn, "28950000");
        check("withdrawal liability lender", f.lenderClaimable, "0");
        const final = await client.readContract({
          address: config.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [s.borrower.account.address],
        });
        check(
          "borrower total receipts",
          (final - before).toString(),
          "98950000",
        );
        writeFileSync(
          ".local/demo-happy.json",
          JSON.stringify(
            {
              claimId: claim.id,
              claimKey: claim.claimKey,
              documentId: d.document.documentId,
              version: claim.version,
              financing: f,
            },
            null,
            2,
          ) + "\n",
        );
      }
    }
  }
  console.log(
    JSON.stringify({
      demo: mode,
      result: "PASS",
      chainId: 31337,
      isSynthetic: true,
    }),
  );
} finally {
  await closeDb();
}
