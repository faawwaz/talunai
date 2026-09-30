import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToString, type Hex, type PrivateKeyAccount } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { actor } from "../scripts/actors";
import { termsHash } from "../packages/chain/service";
import type {
  AgentRun,
  Claim,
  CurrentUser,
  PublicConfig,
} from "../packages/client";

type CheckResult = {
  name: string;
  status: "PASSED" | "FAILED";
  durationMs: number;
  error?: string;
};
type WalletControl = {
  rejectSignatures: boolean;
  requests: Record<string, number>;
  consent?: { claim: Claim; config: PublicConfig; role: "BORROWER" | "BUYER" };
};
type ApiResult<T> = { status: number; data: T };
type Fixture = { claim: Claim; documentId: string; run: AgentRun };

/** Only SIWE and exact pre-authorized consents. Keys stay in Node; broadcasts are refused. */
export async function installWallet(
  context: BrowserContext,
  account: Pick<PrivateKeyAccount, "address" | "signMessage" | "signTypedData">,
  chainId: 97 | 31337,
  baseUrl: string,
  control: WalletControl,
) {
  await context.exposeBinding(
    "__talunaiTestWalletRequest",
    async (_source, input: unknown) => {
      const request = input as { method?: string; params?: unknown[] };
      const method = request.method ?? "";
      control.requests[method] = (control.requests[method] ?? 0) + 1;
      if (method === "eth_chainId")
        return { ok: true, value: `0x${chainId.toString(16)}` };
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return { ok: true, value: [account.address] };
      if (method === "eth_signTypedData_v4") {
        if (control.rejectSignatures)
          return {
            ok: false,
            code: 4001,
            message: "User rejected the signature.",
          };
        const consent = control.consent;
        assert.ok(consent, "TEST_TYPED_CONSENT_NOT_AUTHORIZED");
        assert.equal(
          String(request.params?.[0]).toLowerCase(),
          account.address.toLowerCase(),
        );
        const payload = JSON.parse(String(request.params?.[1])) as {
          domain: {
            name: string;
            version: string;
            chainId: string | number;
            verifyingContract: string;
          };
          primaryType: string;
          types: Record<string, { name: string; type: string }[]>;
          message: {
            claimKey: string;
            version: string;
            termsHash: string;
            deadline: string;
            nonce: string;
          };
        };
        const expectedType =
          consent.role === "BORROWER"
            ? "BorrowerConsent"
            : "BuyerAcknowledgement";
        assert.equal(payload.primaryType, expectedType);
        assert.equal(payload.domain.name, "TALUNAI RWARegistry");
        assert.equal(payload.domain.version, "1");
        assert.equal(Number(payload.domain.chainId), chainId);
        assert.equal(
          payload.domain.verifyingContract.toLowerCase(),
          consent.config.contracts.registry.toLowerCase(),
        );
        assert.equal(payload.message.claimKey, consent.claim.claimKey);
        assert.equal(
          String(payload.message.version),
          String(consent.claim.version),
        );
        assert.equal(payload.message.termsHash, termsHash(consent.claim));
        assert.equal(
          String(payload.message.deadline),
          String(consent.claim.terms.consentExpiry),
        );
        assert.ok(
          BigInt(payload.message.deadline) >
            BigInt(Math.floor(Date.now() / 1000)),
        );
        assert.ok(
          BigInt(payload.message.nonce) >= 0n &&
            BigInt(payload.message.nonce) < 2n ** 256n,
        );
        assert.deepEqual(payload.types[expectedType], [
          { name: "claimKey", type: "bytes32" },
          { name: "version", type: "uint256" },
          { name: "termsHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ]);
        assert.ok(
          Object.keys(payload.types).every(
            (type) => type === expectedType || type === "EIP712Domain",
          ),
        );
        assert.equal(
          (consent.role === "BORROWER"
            ? consent.claim.terms.borrower
            : consent.claim.terms.buyer
          ).toLowerCase(),
          account.address.toLowerCase(),
        );
        return {
          ok: true,
          value: await account.signTypedData({
            ...payload,
            domain: {
              ...payload.domain,
              chainId: Number(payload.domain.chainId),
              verifyingContract: payload.domain.verifyingContract as Hex,
            },
          }),
        };
      }
      if (method === "personal_sign") {
        if (control.rejectSignatures)
          return {
            ok: false,
            code: 4001,
            message: "User rejected the signature.",
          };
        const encoded = request.params?.[0];
        const signer = request.params?.[1];
        assert.equal(typeof encoded, "string", "SIWE_MESSAGE_REQUIRED");
        assert.equal(
          String(signer).toLowerCase(),
          account.address.toLowerCase(),
          "SIWE_SIGNER_MISMATCH",
        );
        const message = String(encoded).startsWith("0x")
          ? hexToString(encoded as Hex)
          : String(encoded);
        const parsed = parseSiweMessage(message);
        assert.equal(
          parsed.domain,
          new URL(baseUrl).host,
          "TEST_WALLET_REFUSES_OTHER_DOMAIN",
        );
        assert.equal(
          parsed.chainId,
          chainId,
          "TEST_WALLET_REFUSES_OTHER_CHAIN",
        );
        assert.equal(
          parsed.address?.toLowerCase(),
          account.address.toLowerCase(),
        );
        assert.equal(parsed.version, "1");
        assert.ok(
          parsed.nonce &&
            parsed.expirationTime &&
            parsed.expirationTime.getTime() > Date.now(),
        );
        assert.ok(
          parsed.uri && new URL(parsed.uri).origin === new URL(baseUrl).origin,
        );
        return { ok: true, value: await account.signMessage({ message }) };
      }
      return {
        ok: false,
        code: 4200,
        message:
          "UI smoke wallet refuses broadcasts and unconfigured signing methods.",
      };
    },
  );
  // A raw browser script avoids TypeScript transpiler helper closures crossing realms.
  await context.addInitScript({
    content: `(() => {
    const listeners = new Map();
    window.ethereum = {
      async request(request) {
        const response = await window.__talunaiTestWalletRequest(request);
        if (!response.ok) throw Object.assign(new Error(response.message), { code: response.code });
        return response.value;
      },
      on(event, listener) {
        const callbacks = listeners.get(event) || new Set();
        callbacks.add(listener);
        listeners.set(event, callbacks);
      },
      removeListener(event, listener) { listeners.get(event)?.delete(listener); }
    };
  })();`,
  });
}

export async function request<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("talunai_csrf="))
        ?.split("=")[1];
      const response = await fetch(path, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(method === "GET"
            ? {}
            : { "idempotency-key": crypto.randomUUID() }),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = { nonJsonResponse: true };
      }
      return { status: response.status, data };
    },
    { path, method, body },
  ) as Promise<ApiResult<T>>;
}

function success<T>(result: ApiResult<T>): T {
  assert.ok(
    result.status >= 200 && result.status < 300,
    `API_HTTP_${result.status}: ${JSON.stringify(result.data)}`,
  );
  return result.data;
}

export async function login(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
  const loginButton = page
    .getByRole("button", { name: "Masuk dengan wallet", exact: true })
    .first();
  await expect(loginButton).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/auth/verify") && response.status() === 200,
      { timeout: 30_000 },
    ),
    loginButton.click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Keluar dari sesi", exact: true }),
  ).toBeVisible();
  return success(await request<CurrentUser>(page, "/v1/me"));
}

export async function createFixture(
  page: Page,
  category: "COCOA" | "PACKAGING",
  user: CurrentUser,
  options: { lenderOrganizationId?: string } = {},
): Promise<Fixture> {
  const issuer = user.memberships.find(
    (membership) => membership.role === "BORROWER",
  );
  assert.ok(issuer, "UI_SMOKE_NEEDS_PROVISIONED_SYNTHETIC_BORROWER");
  const organizations = success(
    await request<{ items: { id: string; name: string; kind: string }[] }>(
      page,
      `/v1/organizations?issuerOrganizationId=${encodeURIComponent(issuer.organizationId)}&limit=100`,
    ),
  );
  const buyer = organizations.items.find(
    (organization) => organization.kind === "BUYER",
  );
  assert.ok(buyer, "UI_SMOKE_NEEDS_APPROVED_SYNTHETIC_BUYER");
  const number = `UI/${category}/${randomUUID().slice(0, 8).toUpperCase()}`;
  const now = Math.floor(Date.now() / 1000);
  let due = now + 45 * 86400;
  const amount = category === "COCOA" ? "100000000" : "60000000";
  const principal = category === "COCOA" ? "70000000" : "42000000";
  const goods =
    category === "COCOA"
      ? {
          category,
          description: "Biji kakao kering",
          lineItems: [
            { description: "Biji kakao kering", quantity: "10", unit: "ton" },
          ],
        }
      : {
          category,
          description: "Karton kemasan makanan",
          lineItems: [
            {
              description: "Karton kemasan makanan",
              quantity: "12000",
              unit: "pcs",
            },
          ],
        };
  const input = {
    assetType: "TRADE_RECEIVABLE",
    goods,
    organizationId: issuer.organizationId,
    buyerOrganizationId: buyer.id,
    ...(category === "COCOA" && options.lenderOrganizationId
      ? { lenderOrganizationId: options.lenderOrganizationId }
      : {}),
    invoiceNamespace: "UI-SMOKE-2026",
    invoiceNumber: number,
    acceptedOutstanding: amount,
    requestedPrincipal: principal,
    invoiceDueAt: due,
    fundingWindowSeconds: 82800,
  };
  let claim: Claim;
  if (category === "PACKAGING") {
    await page.goto(`${new URL(page.url()).origin}/borrower/claims/new`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByLabel("Kategori barang", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await expect(
      page.getByText("Pilih buyer yang terdaftar.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Buyer", { exact: true }).selectOption(buyer.id);
    await page
      .getByLabel("Seri / tahun invoice", { exact: true })
      .fill(input.invoiceNamespace);
    await page.getByLabel("Nomor invoice", { exact: true }).fill(number);
    await page
      .getByLabel("Kategori barang", { exact: true })
      .selectOption("PACKAGING");
    await page
      .getByLabel("Deskripsi barang", { exact: true })
      .fill("Karton kemasan — draft perlu dilengkapi");
    await page
      .getByLabel("Item 1", { exact: true })
      .fill(goods.lineItems[0].description);
    await page
      .getByLabel("Jumlah 1", { exact: true })
      .fill(goods.lineItems[0].quantity);
    await page
      .getByLabel("Satuan 1", { exact: true })
      .fill(goods.lineItems[0].unit);
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await page.getByLabel("Outstanding invoice", { exact: true }).fill(amount);
    await page
      .getByLabel("Principal yang diminta", { exact: true })
      .fill(principal);
    await page
      .getByLabel("Jatuh tempo invoice", { exact: true })
      .fill(new Date(due * 1000).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await page.getByRole("checkbox").check();
    await page.screenshot({
      path: resolve(
        process.env.UI_ARTIFACTS_DIR ?? ".local/ui-smoke",
        "packaging-form-review.png",
      ),
      fullPage: true,
      animations: "disabled",
    });
    const [createdResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/claims" &&
          response.request().method() === "POST",
      ),
      page
        .getByRole("button", { name: "Simpan & lengkapi bukti", exact: true })
        .click(),
    ]);
    claim = success({
      status: createdResponse.status(),
      data: (await createdResponse.json()) as Claim,
    });
    await page.waitForURL(`**/borrower/claims/${claim.id}/evidence`);
    assert.equal(claim.terms.acceptedOutstanding, amount);
    assert.equal(claim.terms.principal, principal);
    due = Number(claim.terms.invoiceDueAt);
    const draftVersion = claim.version;
    await page.goto(
      `${new URL(page.url()).origin}/borrower/claims/${claim.id}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await page.getByText("Revisi detail pengajuan", { exact: true }).click();
    await page
      .getByLabel("Deskripsi barang", { exact: true })
      .fill(goods.description);
    await page.getByLabel("Jumlah 1", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "Simpan versi baru", exact: true })
      .click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      /positif/i,
    );
    await expect(
      page.getByLabel("Deskripsi barang", { exact: true }),
    ).toHaveValue(goods.description);
    await page
      .getByLabel("Jumlah 1", { exact: true })
      .fill(goods.lineItems[0].quantity);
    const [revision] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/claims/${claim.id}` &&
          response.request().method() === "PATCH",
      ),
      page
        .getByRole("button", { name: "Simpan versi baru", exact: true })
        .click(),
    ]);
    success({ status: revision.status(), data: await revision.json() });
    await expect(page.getByRole("status")).toContainText(
      "Versi baru tersimpan",
    );
    claim = success(await request<Claim>(page, `/v1/claims/${claim.id}`));
    assert.ok(claim.version > draftVersion);
    assert.deepEqual(claim.goods, goods);
    assert.notEqual(claim.evidence.humanReviewStatus, "ATTESTED");
    await page.screenshot({
      path: resolve(
        process.env.UI_ARTIFACTS_DIR ?? ".local/ui-smoke",
        "packaging-revision.png",
      ),
      fullPage: true,
      animations: "disabled",
    });
  } else {
    claim = success(await request<Claim>(page, "/v1/claims", "POST", input));
  }
  const text = [
    "isSynthetic: true",
    "locale: id-ID",
    "dateFormat: YYYY-MM-DD",
    `issuerName: ${issuer.organizationName}`,
    `buyerName: ${buyer.name}`,
    `invoiceNumber: ${number}`,
    `issueDate: ${new Date(now * 1000).toISOString().slice(0, 10)}`,
    `invoiceDueDate: ${new Date(due * 1000).toISOString().slice(0, 10)}`,
    "currency: IDR",
    `invoiceOriginalAmount: ${amount}`,
    "previouslyPaidAmount: 0",
    `acceptedOutstandingAmount: ${amount}`,
    `goodsDescription: ${goods.description}`,
    `goodsCategory: ${category}`,
    `quantity: ${goods.lineItems[0].quantity}`,
    `quantityUnit: ${goods.lineItems[0].unit}`,
    `purchaseOrderReference: PO-${number}`,
    `proofOfDeliveryReference: POD-${number} barang diterima buyer`,
    `buyerAcknowledgementReference: ACK-${number} buyer mengakui outstanding ${amount} IDR`,
    "disclosure: IDENTITAS DAN DOKUMEN SINTETIS UNTUK UJI. BUKAN PIUTANG ATAU PEMBAYARAN NYATA.",
  ].join("\n");
  const uploadResult = await page.evaluate(
    async ({ id, version, text, category }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("talunai_csrf="))
        ?.split("=")[1];
      const form = new FormData();
      form.set(
        "file",
        new File([text], `invoice-${category.toLowerCase()}-sintetis.txt`, {
          type: "text/plain",
        }),
      );
      form.set("expectedVersion", String(version));
      const response = await fetch(`/v1/claims/${id}/documents`, {
        method: "POST",
        credentials: "include",
        headers: {
          "idempotency-key": crypto.randomUUID(),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: form,
      });
      return {
        status: response.status,
        data: (await response.json()) as {
          documentId: string;
          version: number;
          status: string;
        },
      };
    },
    { id: claim.id, version: claim.version, text, category },
  );
  const uploaded = success(uploadResult);
  claim = success(await request<Claim>(page, `/v1/claims/${claim.id}`));
  const queued = success(
    await request<{ runId: string }>(
      page,
      `/v1/claims/${claim.id}/analyze`,
      "POST",
      { expectedVersion: claim.version },
    ),
  );
  const until = Date.now() + 120_000;
  let run: AgentRun | undefined;
  while (Date.now() < until) {
    run = success(
      await request<AgentRun>(page, `/v1/agent-runs/${queued.runId}`),
    );
    if (["COMPLETED", "FAILED", "STALE"].includes(run.status)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  assert.equal(
    run?.status,
    "COMPLETED",
    `Worker run ${queued.runId} ended ${run?.status}; ${run?.error ?? "persistent worker must be running"}`,
  );
  claim = success(await request<Claim>(page, `/v1/claims/${claim.id}`));
  assert.equal(claim.assetType, "TRADE_RECEIVABLE");
  assert.equal(claim.goods?.category, category);
  assert.equal(claim.terms.borrower.toLowerCase(), user.wallet.toLowerCase());
  return { claim, documentId: uploaded.documentId, run: run! };
}

export async function runUiSmoke() {
  const baseUrl = (
    process.env.UI_BASE_URL ??
    process.env.APP_ORIGIN ??
    "https://localhost:3000"
  ).replace(/\/$/, "");
  const host = new URL(baseUrl).hostname;
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(host),
    "UI_SMOKE_LOCAL_APP_ONLY",
  );
  const chainId = Number(process.env.CHAIN_ID);
  assert.ok(chainId === 97 || chainId === 31337, "UI_SMOKE_TEST_CHAINS_ONLY");
  const account = actor("borrower");
  const artifacts = resolve(process.env.UI_ARTIFACTS_DIR ?? ".local/ui-smoke");
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });
  const wallet: WalletControl = { rejectSignatures: false, requests: {} };
  await installWallet(context, account, chainId, baseUrl, wallet);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const results: CheckResult[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let cocoa: Fixture | undefined;
  let packaging: Fixture | undefined;
  let user: CurrentUser | undefined;
  let config: PublicConfig | undefined;
  async function check(name: string, fn: () => Promise<void>) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: "PASSED", durationMs: Date.now() - start });
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name,
        status: "FAILED",
        durationMs: Date.now() - start,
        error: message,
      });
      console.error(`FAIL ${name}: ${message}`);
      await page
        .screenshot({
          path: resolve(artifacts, `failure-${results.length}.png`),
          fullPage: true,
          animations: "disabled",
        })
        .catch(() => undefined);
    }
  }
  async function capture(filename: string) {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({
      path: resolve(artifacts, filename),
      fullPage: true,
      animations: "disabled",
    });
  }
  async function assertAxe(name: string) {
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    await writeFile(
      resolve(artifacts, `axe-${name}.json`),
      JSON.stringify(
        {
          url: page.url(),
          violations: accessibility.violations,
          incomplete: accessibility.incomplete,
          passes: accessibility.passes.length,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(
      accessibility.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
      [],
      "Accessibility violations",
    );
  }

  try {
    if (process.env.UI_VISUAL_ONLY === "1") {
      await check(
        "authorized overview remains readable and accessible on desktop and mobile",
        async () => {
          user = await login(page, baseUrl);
          config = success(await request<PublicConfig>(page, "/v1/config"));
          await expect(page.locator("main")).toContainText(
            "Piutang usaha Anda",
          );
          await expect(page.locator("main")).toContainText(/IDRT|MockIDR/);
          await capture("overview-desktop.png");
          await assertAxe("overview");
          await page.setViewportSize({ width: 390, height: 844 });
          await expect(page.locator("main")).toContainText(/IDRT|MockIDR/);
          const moneyValues = page
            .locator("main")
            .getByText(/(?:42|70)\.000\.000/)
            .filter({ visible: true });
          await moneyValues.first().scrollIntoViewIfNeeded();
          await expect(moneyValues.first()).toBeInViewport({ ratio: 1 });
          const dimensions = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          assert.ok(dimensions.scroll <= dimensions.viewport);
          await page.locator("main h1").click();
          await capture("overview-mobile.png");
          await assertAxe("overview-mobile");
          const [logoutResponse] = await Promise.all([
            page.waitForResponse((response) =>
              response.url().endsWith("/v1/auth/logout"),
            ),
            page
              .getByRole("button", { name: "Keluar dari sesi", exact: true })
              .click(),
          ]);
          assert.equal(logoutResponse.status(), 200);
          await expect(
            page
              .getByRole("button", { name: "Masuk dengan wallet", exact: true })
              .first(),
          ).toBeVisible();
          assert.equal((await request(page, "/v1/me")).status, 401);
          assert.equal(wallet.requests.eth_sendTransaction ?? 0, 0);
          assert.equal(wallet.requests.eth_signTypedData_v4 ?? 0, 0);
          assert.deepEqual(pageErrors, []);
        },
      );
      assert.equal(
        results.filter((result) => result.status === "FAILED").length,
        0,
      );
      return;
    }
    await check(
      "anonymous shell does not automatically prompt wallet",
      async () => {
        await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
        await expect(
          page
            .getByRole("button", { name: "Masuk dengan wallet", exact: true })
            .first(),
        ).toBeVisible({ timeout: 45_000 });
        config = success(await request<PublicConfig>(page, "/v1/config"));
        assert.equal(config.chainId, chainId);
        assert.equal(config.isSynthetic, true);
        assert.equal(wallet.requests.eth_requestAccounts ?? 0, 0);
        await capture("anonymous-desktop.png");
      },
    );
    await check(
      "rejected SIWE signature stays anonymous and displays recovery",
      async () => {
        wallet.rejectSignatures = true;
        await page
          .getByRole("button", { name: "Masuk dengan wallet", exact: true })
          .first()
          .click();
        await expect(page.getByRole("alert").first()).toContainText(
          /ditolak|dibatalkan/i,
        );
        assert.equal((await request(page, "/v1/me")).status, 401);
        wallet.rejectSignatures = false;
      },
    );
    await check(
      "real SIWE authenticates synthetic borrower with revocable cookie session",
      async () => {
        user = await login(page, baseUrl);
        assert.equal(user.wallet.toLowerCase(), account.address.toLowerCase());
        assert.ok(
          user.memberships.some((membership) => membership.role === "BORROWER"),
        );
        const cookies = await context.cookies();
        assert.ok(
          cookies.some(
            (cookie) => cookie.name === "talunai_session" && cookie.httpOnly,
          ),
          "HttpOnly session cookie required",
        );
        if (baseUrl.startsWith("https:"))
          assert.ok(
            cookies.find((cookie) => cookie.name === "talunai_session")?.secure,
          );
      },
    );
    await check(
      "real cocoa document upload and persistent worker analysis",
      async () => {
        assert.ok(user, "Authenticated borrower required");
        cocoa = await createFixture(page, "COCOA", user);
      },
    );
    await check(
      "real packaging UI creation, goods revision, document upload and persistent analysis",
      async () => {
        assert.ok(user, "Authenticated borrower required");
        packaging = await createFixture(page, "PACKAGING", user);
      },
    );
    await check(
      "overview uses authorized data and passes automated accessibility",
      async () => {
        await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("main h1")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Keluar dari sesi" }),
        ).toBeVisible();
        await expect(page.locator("main")).toContainText(/IDRT|MockIDR/i);
        await capture("overview-desktop.png");
        await assertAxe("overview");
      },
    );
    await check(
      "claims list contains both real synthetic goods categories",
      async () => {
        assert.ok(cocoa && packaging, "Both fixture runs must complete");
        await page.goto(`${baseUrl}/borrower/claims`, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page
            .getByRole("link", {
              name: cocoa.claim.invoiceNumber,
              exact: false,
            })
            .first(),
        ).toBeVisible();
        await expect(
          page
            .getByRole("link", {
              name: packaging.claim.invoiceNumber,
              exact: false,
            })
            .first(),
        ).toBeVisible();
        await capture("claims-desktop.png");
      },
    );
    await check(
      "claim detail and evidence preserve exact amounts, goods and analysis",
      async () => {
        assert.ok(cocoa, "Cocoa fixture must complete");
        await page.goto(`${baseUrl}/borrower/claims/${cocoa.claim.id}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.locator("main h1")).toContainText(
          cocoa.claim.invoiceNumber,
        );
        await expect(page.locator("main")).toContainText("100.000.000");
        await capture("claim-detail-desktop.png");
        await assertAxe("claim-detail");
        await page.goto(
          `${baseUrl}/borrower/claims/${cocoa.claim.id}/evidence`,
          {
            waitUntil: "domcontentloaded",
          },
        );
        await expect(page.locator("main")).toContainText(
          "invoice-cocoa-sintetis.txt",
        );
        await capture("claim-evidence-desktop.png");
      },
    );
    await check(
      "all sidebar destinations render and mobile sheet restores focus on Escape",
      async () => {
        for (const route of ["tasks", "payments", "activity", "settings"]) {
          await page.goto(`${baseUrl}/borrower/${route}`, {
            waitUntil: "domcontentloaded",
          });
          await expect(page.locator("main h1")).toBeVisible();
          await expect(page.locator("main")).not.toContainText(
            "This page could not be found",
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Keluar dari sesi", exact: true }),
        ).toBeVisible();
        const trigger = page.getByRole("button", {
          name: "Buka navigasi",
          exact: true,
        });
        await trigger.click();
        await expect(
          page.getByRole("dialog", { name: "Navigasi TALUNAI" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("dialog", { name: "Navigasi TALUNAI" }),
        ).not.toBeVisible();
        await expect(trigger).toBeFocused();
        const dimensions = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }));
        assert.ok(
          dimensions.scroll <= dimensions.viewport,
          `Viewport overflow ${dimensions.scroll}/${dimensions.viewport}`,
        );
        await capture("overview-mobile.png");
        await assertAxe("overview-mobile");
        assert.ok(cocoa, "Cocoa fixture required");
        for (const route of [
          "",
          "/evidence",
          "/terms",
          "/payments",
          "/activity",
        ]) {
          await page.goto(
            `${baseUrl}/borrower/claims/${cocoa.claim.id}${route}`,
            {
              waitUntil: "domcontentloaded",
            },
          );
          await expect(page.locator("main h1")).toContainText(
            cocoa.claim.invoiceNumber,
          );
          const dimensions = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          assert.ok(
            dimensions.scroll <= dimensions.viewport,
            `${route || "summary"} viewport overflow ${dimensions.scroll}/${dimensions.viewport}`,
          );
        }
        await capture("claim-activity-mobile.png");
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
    );
    await check(
      "failed list request has retry affordance without inventing records",
      async () => {
        await page.route("**/v1/claims?*", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "CHAIN_UNAVAILABLE" },
              correlationId: "ui-smoke-503",
            }),
          }),
        );
        await page.goto(`${baseUrl}/borrower/claims`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByRole("alert").first()).toBeVisible();
        await expect(
          page.getByRole("button", { name: /coba lagi/i }),
        ).toBeVisible();
        await capture("claims-recoverable-error.png");
        await page.unroute("**/v1/claims?*");
      },
    );
    await check(
      "unprovisioned wallet cannot fetch another organization's private document",
      async () => {
        assert.ok(cocoa, "Private document must exist");
        const outsider = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: 1440, height: 1000 },
        });
        try {
          const outsiderControl = { rejectSignatures: false, requests: {} };
          await installWallet(
            outsider,
            privateKeyToAccount(generatePrivateKey()),
            chainId,
            baseUrl,
            outsiderControl,
          );
          const outsiderPage = await outsider.newPage();
          const pendingUser = await login(outsiderPage, baseUrl);
          assert.equal(pendingUser.memberships.length, 0);
          const forbidden = await request(
            outsiderPage,
            `/v1/documents/${cocoa.documentId}`,
          );
          assert.equal(
            forbidden.status,
            404,
            "Objects outside this actor scope are concealed as not found",
          );
          assert.ok(
            !JSON.stringify(forbidden.data).includes(cocoa.claim.invoiceNumber),
            "Forbidden response must not leak private invoice",
          );
          const forbiddenCreation = await request(
            outsiderPage,
            "/v1/claims",
            "POST",
            {
              assetType: "TRADE_RECEIVABLE",
              goods: cocoa.claim.goods,
              organizationId: cocoa.claim.organizationId,
              buyerOrganizationId: cocoa.claim.buyerOrganizationId,
              invoiceNamespace: "UI-FORBIDDEN",
              invoiceNumber: `FORBIDDEN/${randomUUID().slice(0, 8)}`,
              acceptedOutstanding: "100000000",
              requestedPrincipal: "70000000",
              invoiceDueAt: Math.floor(Date.now() / 1000) + 45 * 86400,
            },
          );
          assert.equal(
            forbiddenCreation.status,
            403,
            "A pending profile cannot act as another organization",
          );
        } finally {
          await outsider.close();
        }
      },
    );
    await check(
      "verifier reviews actual evidence and binds approvals to the new terms version",
      async () => {
        assert.ok(
          cocoa && config && user,
          "Cocoa fixture and session required",
        );
        const previousVersion = cocoa.claim.version;
        await page.goto(`${baseUrl}/borrower/claims/${cocoa.claim.id}/terms`, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page.getByRole("button", {
            name: "Tinjau & tanda tangani",
            exact: true,
          }),
        ).not.toBeVisible();
        await expect(page.locator("main")).toContainText(
          "Lengkapi review manusia dan selesaikan temuan sebelum tanda tangan ketentuan.",
        );
        const reviewer = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: 1440, height: 1000 },
          reducedMotion: "reduce",
        });
        try {
          const reviewerWallet: WalletControl = {
            rejectSignatures: false,
            requests: {},
          };
          await installWallet(
            reviewer,
            actor("verifier"),
            chainId,
            baseUrl,
            reviewerWallet,
          );
          const reviewerPage = await reviewer.newPage();
          reviewerPage.on("pageerror", (error) =>
            pageErrors.push(error.message),
          );
          const reviewerUser = await login(reviewerPage, baseUrl);
          assert.ok(
            reviewerUser.memberships.some(
              (membership) => membership.role === "VERIFIER",
            ),
          );
          await reviewerPage.goto(
            `${baseUrl}/verifier/claims/${cocoa.claim.id}/terms`,
            { waitUntil: "domcontentloaded" },
          );
          await reviewerPage
            .getByRole("checkbox", {
              name: "invoice-cocoa-sintetis.txt",
              exact: true,
            })
            .check();
          await reviewerPage
            .getByLabel("Keputusan", { exact: true })
            .selectOption("APPROVE");
          await reviewerPage
            .getByLabel("Alasan keputusan", { exact: true })
            .fill(
              "Verifier demo meninjau invoice sintetis, bukti penyerahan, pengakuan buyer, nominal dan pihak yang terdaftar.",
            );
          const [reviewResponse] = await Promise.all([
            reviewerPage.waitForResponse(
              (response) =>
                response
                  .url()
                  .endsWith(`/v1/claims/${cocoa!.claim.id}/review`) &&
                response.request().method() === "POST",
            ),
            reviewerPage
              .getByRole("button", { name: "Simpan keputusan", exact: true })
              .click(),
          ]);
          assert.equal(
            reviewResponse.status(),
            200,
            `Review response: ${await reviewResponse.text()}`,
          );
          await expect(
            reviewerPage
              .getByRole("status")
              .filter({ hasText: "Keputusan review tersimpan" }),
          ).toBeVisible();
          cocoa.claim = success(
            await request<Claim>(page, `/v1/claims/${cocoa.claim.id}`),
          );
          assert.ok(
            cocoa.claim.version > previousVersion,
            "Human review must create a new immutable terms version",
          );
          assert.equal(cocoa.claim.evidence.humanReviewStatus, "ATTESTED");
          assert.equal(reviewerWallet.requests.eth_sendTransaction ?? 0, 0);
          await reviewerPage.screenshot({
            path: resolve(artifacts, "verifier-review-desktop.png"),
            fullPage: true,
            animations: "disabled",
          });
        } finally {
          await reviewer.close();
        }
      },
    );
    await check(
      "rejected borrower EIP712 consent is retryable and both exact-term signatures persist without broadcast",
      async () => {
        assert.ok(
          cocoa && config && user,
          "Reviewed claim and session required",
        );
        assert.equal(cocoa.claim.evidence.humanReviewStatus, "ATTESTED");
        wallet.consent = { claim: cocoa.claim, config, role: "BORROWER" };
        await page.goto(`${baseUrl}/borrower/claims/${cocoa.claim.id}/terms`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("button", { name: "Tinjau & tanda tangani", exact: true })
          .click();
        const borrowerDialog = page.getByRole("dialog", {
          name: "Konfirmasi persetujuan borrower",
          exact: true,
        });
        await expect(borrowerDialog).toBeVisible();
        await expect(borrowerDialog).toContainText("70.000.000");
        await expect(borrowerDialog).toContainText(user.wallet.toLowerCase());
        wallet.rejectSignatures = true;
        await borrowerDialog
          .getByRole("button", { name: "Lanjutkan ke wallet", exact: true })
          .click();
        await expect(borrowerDialog.getByRole("alert")).toContainText(
          /ditolak|dibatalkan/i,
        );
        const rejectedEvidence = success(
          await request<{ consents: { role: string; revoked: boolean }[] }>(
            page,
            `/v1/claims/${cocoa.claim.id}/evidence`,
          ),
        );
        assert.equal(
          rejectedEvidence.consents.filter(
            (consent) => consent.role === "BORROWER" && !consent.revoked,
          ).length,
          0,
        );
        wallet.rejectSignatures = false;
        const [borrowerConsentResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response
                .url()
                .endsWith(`/v1/claims/${cocoa!.claim.id}/consents`) &&
              response.request().method() === "POST",
          ),
          borrowerDialog
            .getByRole("button", { name: "Lanjutkan ke wallet", exact: true })
            .click(),
        ]);
        assert.equal(
          borrowerConsentResponse.status(),
          200,
          `Borrower consent response: ${await borrowerConsentResponse.text()}`,
        );
        await expect(
          page.getByRole("status").filter({ hasText: "Persetujuan tersimpan" }),
        ).toBeVisible();
        const buyer = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: 1440, height: 1000 },
          reducedMotion: "reduce",
        });
        try {
          const buyerWallet: WalletControl = {
            rejectSignatures: false,
            requests: {},
            consent: { claim: cocoa.claim, config, role: "BUYER" },
          };
          await installWallet(
            buyer,
            actor("buyer"),
            chainId,
            baseUrl,
            buyerWallet,
          );
          const buyerPage = await buyer.newPage();
          buyerPage.on("pageerror", (error) => pageErrors.push(error.message));
          await login(buyerPage, baseUrl);
          await buyerPage.goto(
            `${baseUrl}/buyer/claims/${cocoa.claim.id}/terms`,
            { waitUntil: "domcontentloaded" },
          );
          await buyerPage
            .getByRole("button", {
              name: "Tinjau & tanda tangani",
              exact: true,
            })
            .click();
          const buyerDialog = buyerPage.getByRole("dialog", {
            name: "Konfirmasi pengakuan buyer",
            exact: true,
          });
          await expect(buyerDialog).toBeVisible();
          const [buyerConsentResponse] = await Promise.all([
            buyerPage.waitForResponse(
              (response) =>
                response
                  .url()
                  .endsWith(`/v1/claims/${cocoa!.claim.id}/consents`) &&
                response.request().method() === "POST",
            ),
            buyerDialog
              .getByRole("button", { name: "Lanjutkan ke wallet", exact: true })
              .click(),
          ]);
          assert.equal(
            buyerConsentResponse.status(),
            200,
            `Buyer consent response: ${await buyerConsentResponse.text()}`,
          );
          await expect(
            buyerPage
              .getByRole("status")
              .filter({ hasText: "Persetujuan tersimpan" }),
          ).toBeVisible();
          assert.equal(buyerWallet.requests.eth_signTypedData_v4, 1);
          assert.equal(buyerWallet.requests.eth_sendTransaction ?? 0, 0);
        } finally {
          await buyer.close();
        }
        cocoa.claim = success(
          await request<Claim>(page, `/v1/claims/${cocoa.claim.id}`),
        );
        assert.equal(cocoa.claim.workflow, "READY_FOR_REGISTRATION");
        const evidence = success(
          await request<{
            consents: { role: string; version: number; revoked: boolean }[];
          }>(page, `/v1/claims/${cocoa.claim.id}/evidence`),
        );
        assert.deepEqual(
          evidence.consents
            .filter(
              (consent) =>
                !consent.revoked && consent.version === cocoa!.claim.version,
            )
            .map((consent) => consent.role)
            .sort(),
          ["BORROWER", "BUYER"],
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("main")).toContainText("Siap dicatat");
        await capture("consents-complete-desktop.png");
      },
    );
    await check(
      "logout revokes session and smoke wallet never broadcasts money actions",
      async () => {
        await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
        const [logoutResponse] = await Promise.all([
          page.waitForResponse((response) =>
            response.url().endsWith("/v1/auth/logout"),
          ),
          page
            .getByRole("button", { name: "Keluar dari sesi", exact: true })
            .click(),
        ]);
        assert.equal(
          logoutResponse.status(),
          200,
          "Server logout must revoke the session",
        );
        await expect(
          page
            .getByRole("button", { name: "Masuk dengan wallet", exact: true })
            .first(),
        ).toBeVisible();
        assert.equal((await request(page, "/v1/me")).status, 401);
        assert.equal(wallet.requests.eth_sendTransaction ?? 0, 0);
        assert.ok((wallet.requests.eth_signTypedData_v4 ?? 0) <= 2);
        assert.deepEqual(pageErrors, [], "Uncaught browser exceptions");
      },
    );
  } finally {
    await browser.close();
    const report = {
      timestamp: new Date().toISOString(),
      baseUrl,
      chainId,
      isSynthetic: true,
      providerMode: config?.llmMode ?? "UNAVAILABLE",
      walletMode:
        "NODE_SIWE_AND_EXACT_CONSENTS_NO_BROADCAST_NO_KEYS_IN_BROWSER",
      browser: "Chromium",
      browserErrors: pageErrors,
      screenshotsAreVisualBaselines: false,
      fixtures: [cocoa, packaging].filter(Boolean).map((fixture) => ({
        claimId: fixture!.claim.id,
        goodsCategory: fixture!.claim.goods?.category,
        runId: fixture!.run.id,
        runStatus: fixture!.run.status,
        providerMode: fixture!.run.mode,
      })),
      mockedResponses:
        process.env.UI_VISUAL_ONLY === "1"
          ? []
          : [
              "One explicit 503 GET /v1/claims error-path check; other API traffic uses actual backend",
            ],
      passed: results.filter((result) => result.status === "PASSED").length,
      failed: results.filter((result) => result.status === "FAILED").length,
      results,
    };
    await writeFile(
      resolve(artifacts, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `UI smoke: ${report.passed} passed, ${report.failed} failed. Report: ${resolve(artifacts, "report.json")}`,
    );
  }
  assert.equal(
    results.filter((result) => result.status === "FAILED").length,
    0,
    "UI smoke contains failed checks; see report.json",
  );
}
