import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  type Hex,
} from "viem";
import { anvil } from "viem/chains";
import { actor } from "./actors";
import {
  createFixture,
  installWallet,
  login,
  request,
} from "../tests/ui.browser";
import type { Claim, PublicConfig } from "../packages/client";

// Called exclusively by the disposable scripts/test-api.ts --ui-financial harness.
const baseUrl = process.env.APP_ORIGIN!;
const rpcUrl = process.env.RPC_HTTP_URL!;
assert.equal(process.env.APP_ENV, "local");
assert.equal(process.env.CHAIN_ID, "31337");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
assert.equal(new URL(rpcUrl).hostname, "127.0.0.1");
const rpc = createPublicClient({ chain: anvil, transport: http(rpcUrl) });
assert.equal(await rpc.getChainId(), 31337);
const config = (await fetch(`${baseUrl}/v1/config`).then((r) =>
  r.json(),
)) as PublicConfig;
assert.equal(config.chainId, 31337);
const targets = Object.values(config.contracts).map((value) =>
  value.toLowerCase(),
);
const artifacts = resolve("docs/design/results/financial");
process.env.UI_ARTIFACTS_DIR = artifacts;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results: { name: string; status: string }[] = [];
const broadcasts: { role: string; hash: Hex; target: string }[] = [];
let activePage: Page | undefined;
async function checkpoint(name: string, action: () => Promise<void>) {
  await action();
  results.push({ name, status: "PASSED" });
  console.log(`PASS ${name}`);
}
async function makeRole(role: "borrower" | "buyer" | "lender" | "verifier") {
  const account = actor(role);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    locale: "id-ID",
  });
  const control: Parameters<typeof installWallet>[4] = {
    rejectSignatures: false,
    requests: {},
  };
  await installWallet(context, account, 31337, baseUrl, control);
  await context.exposeBinding(
    "__talunaiLocalSend",
    async (_source, input: unknown) => {
      const tx = input as {
        from: string;
        to: Hex;
        data: Hex;
        value?: Hex;
        chainId?: Hex;
      };
      assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
      assert.ok(targets.includes(tx.to.toLowerCase()));
      assert.equal(BigInt(tx.value ?? "0x0"), 0n);
      if (tx.chainId) assert.equal(BigInt(tx.chainId), 31337n);
      assert.equal(await rpc.getChainId(), 31337);
      const wallet = createWalletClient({
        account,
        chain: anvil,
        transport: http(rpcUrl),
      });
      const hash = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0n,
      });
      const receipt = await rpc.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      // Only this private Anvil instance: confirmations advance without waiting on public blocks.
      await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_mine",
          params: ["0x2"],
        }),
      });
      broadcasts.push({ role, hash, target: tx.to });
      return hash;
    },
  );
  await context.addInitScript({
    content: `(() => { const original = window.ethereum.request.bind(window.ethereum); window.ethereum.request = request => request.method === 'eth_sendTransaction' ? window.__talunaiLocalSend(request.params[0]) : original(request); })();`,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const user = await login(page, baseUrl);
  return { page, control, user, role };
}
async function submit(page: Page, button: string, dialogTitle: string) {
  activePage = page;
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: dialogTitle, exact: true });
  await expect(dialog).toBeVisible();
  if (dialogTitle === "Danai & cairkan principal") {
    const continueButton = dialog.getByRole("button", {
      name: "Lanjutkan ke wallet",
      exact: true,
    });
    await expect(continueButton).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: /Saya memahami principal dicairkan/ })
      .check();
    await expect(continueButton).toBeEnabled();
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/v1/transactions/observe") &&
        r.request().method() === "POST",
    ),
    dialog
      .getByRole("button", { name: "Lanjutkan ke wallet", exact: true })
      .click(),
  ]);
  assert.ok(response.ok(), await response.text());
  await expect(dialog).not.toBeVisible();
}
try {
  const borrower = await makeRole("borrower"),
    buyer = await makeRole("buyer"),
    lender = await makeRole("lender"),
    verifier = await makeRole("verifier");
  const fixture = await createFixture(borrower.page, "COCOA", borrower.user, {
    lenderOrganizationId: "org-lender",
  });
  let claim = fixture.claim;
  const open = async (p: typeof borrower, tab: string) => {
    activePage = p.page;
    await p.page.goto(`${baseUrl}/${p.role}/claims/${claim.id}/${tab}`);
  };
  const financing = async () =>
    (
      await request<Record<string, string>>(
        borrower.page,
        `/v1/claims/${claim.id}/financing`,
      )
    ).data;
  const waitFinance = async (key: string, value: string) => {
    await expect
      .poll(async () => (await financing())[key], {
        timeout: 45000,
        intervals: [500, 1000],
      })
      .toBe(value);
  };
  const balance = (address: Hex) =>
    rpc.readContract({
      address: config.contracts.token as Hex,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
  const beforeBorrower = await balance(actor("borrower").address);
  const beforeLender = await balance(actor("lender").address);
  await checkpoint(
    "actual worker evidence -> human verifier review",
    async () => {
      await open(verifier, "terms");
      await verifier.page
        .getByRole("checkbox", {
          name: "invoice-cocoa-sintetis.txt",
          exact: true,
        })
        .check();
      await verifier.page
        .getByLabel("Keputusan", { exact: true })
        .selectOption("APPROVE");
      await verifier.page
        .getByLabel("Alasan keputusan", { exact: true })
        .fill(
          "Verifier menguji bukti sintetis, authority, penyerahan, pengakuan dan ketentuan exact pada Anvil terisolasi.",
        );
      const [response] = await Promise.all([
        verifier.page.waitForResponse(
          (r) =>
            r.url().endsWith(`/claims/${claim.id}/review`) &&
            r.request().method() === "POST",
        ),
        verifier.page
          .getByRole("button", { name: "Simpan keputusan", exact: true })
          .click(),
      ]);
      assert.equal(response.status(), 200, await response.text());
      claim = (await request<Claim>(borrower.page, `/v1/claims/${claim.id}`))
        .data;
    },
  );
  await checkpoint(
    "both exact-term EIP712 approvals through wallet UI",
    async () => {
      for (const participant of [borrower, buyer]) {
        participant.control.consent = {
          claim,
          config,
          role: participant.role === "borrower" ? "BORROWER" : "BUYER",
        };
        await open(participant, "terms");
        await participant.page
          .getByRole("button", { name: "Tinjau & tanda tangani", exact: true })
          .click();
        const dialog = participant.page.getByRole("dialog");
        const [response] = await Promise.all([
          participant.page.waitForResponse(
            (r) =>
              r.url().endsWith(`/claims/${claim.id}/consents`) &&
              r.request().method() === "POST",
          ),
          dialog
            .getByRole("button", { name: "Lanjutkan ke wallet", exact: true })
            .click(),
        ]);
        assert.equal(response.status(), 200, await response.text());
        await expect(dialog).not.toBeVisible();
      }
    },
  );
  await checkpoint(
    "verifier UI registers and confirmed projection advances",
    async () => {
      await open(verifier, "terms");
      await submit(verifier.page, "Tinjau registrasi", "Registrasi piutang");
      await expect
        .poll(
          async () =>
            (await request<Claim>(borrower.page, `/v1/claims/${claim.id}`)).data
              .workflow,
          { timeout: 45000 },
        )
        .toBe("REGISTERED");
    },
  );
  await checkpoint(
    "lender exact allowance -> atomic principal funding from UI",
    async () => {
      await open(lender, "payments");
      await submit(
        lender.page,
        "1. Tinjau izin token",
        "Izinkan penggunaan MockIDR",
      );
      await submit(
        lender.page,
        "2. Tinjau pendanaan",
        "Danai & cairkan principal",
      );
      await waitFinance("financingStatus", "ACTIVE");
      assert.equal(
        (await balance(actor("borrower").address)) - beforeBorrower,
        70000000n,
      );
    },
  );
  for (const [amount, total] of [
    ["50000000", "50000000"],
    ["21050000", "71050000"],
    ["28950000", "100000000"],
  ]) {
    await checkpoint(
      `buyer UI collection ${amount}; canonical total ${total}`,
      async () => {
        await open(buyer, "payments");
        await buyer.page
          .getByLabel("Nominal pembayaran buyer", { exact: true })
          .fill(amount);
        await submit(
          buyer.page,
          "1. Tinjau izin token",
          "Izinkan penggunaan MockIDR",
        );
        await submit(buyer.page, "2. Tinjau pembayaran", "Bayar invoice");
        await waitFinance("totalCollected", total);
        const state = await financing();
        if (total === "50000000") {
          assert.equal(state.lenderAllocated, "50000000");
          assert.equal(state.borrowerResidualClaimable, "0");
        }
        if (total === "71050000") {
          assert.equal(state.financingStatus, "REPAID");
          assert.equal(state.collectionStatus, "PARTIALLY_COLLECTED");
          assert.equal(state.remainingInvoiceCollection, "28950000");
        }
        if (total === "100000000") {
          assert.equal(state.collectionStatus, "FULLY_COLLECTED");
          assert.equal(state.borrowerResidualClaimable, "28950000");
        }
      },
    );
  }
  await checkpoint(
    "lender and borrower pull withdrawals via UI; exact final balances",
    async () => {
      await open(lender, "payments");
      await submit(
        lender.page,
        "Tinjau penarikan lender",
        "Tarik saldo lender",
      );
      await waitFinance("lenderWithdrawn", "71050000");
      await open(borrower, "payments");
      await submit(
        borrower.page,
        "Tinjau penarikan residual",
        "Tarik sisa collection",
      );
      await waitFinance("borrowerResidualClaimable", "0");
      assert.equal(
        (await balance(actor("borrower").address)) - beforeBorrower,
        98950000n,
      );
      assert.equal(
        (await balance(actor("lender").address)) - beforeLender,
        1050000n,
      );
      assert.equal(await balance(config.contracts.vault as Hex), 0n);
      await borrower.page.reload();
      await expect(
        borrower.page.getByText("Sisa tagihan invoice"),
      ).toBeVisible();
      await expect(
        borrower.page.getByRole("button", {
          name: "Tinjau penarikan residual",
          exact: true,
        }),
      ).toHaveCount(0);
      await borrower.page.screenshot({
        path: resolve(artifacts, "borrower-settled.png"),
        fullPage: true,
      });
    },
  );
  await writeFile(
    resolve(artifacts, "report.json"),
    JSON.stringify(
      {
        chainId: 31337,
        isolated: true,
        claimId: claim.id,
        results,
        broadcasts,
        actual: await financing(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  await activePage
    ?.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    resolve(artifacts, "failure-report.json"),
    JSON.stringify({ results, error: String(error), broadcasts }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
