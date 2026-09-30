import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { actor } from "./actors";
import { installWallet, login, request } from "../tests/ui.browser";
import type {
  CurrentUser,
  OpsRun,
  OpsRunDetail,
  OpsStatus,
  Page as ApiPage,
  Claim,
} from "../packages/client";

// These checks authenticate synthetic participants and read the running app.
// The wallet bridge refuses every transaction broadcast and stores no keys.
const baseUrl = (
  process.env.UI_BASE_URL ??
  process.env.APP_ORIGIN ??
  "https://localhost:3000"
).replace(/\/$/, "");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname),
  "LOCAL_APP_ONLY",
);
const chainId = Number(process.env.CHAIN_ID);
assert.ok(chainId === 97 || chainId === 31337, "TEST_CHAIN_ONLY");
const artifacts = resolve(process.env.UI_ARTIFACTS_DIR ?? ".local/role-ui");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const controls: Array<{
  rejectSignatures: boolean;
  requests: Record<string, number>;
}> = [];
const pageErrors: string[] = [];
const checks: Array<{
  name: string;
  status: "PASSED" | "FAILED";
  durationMs: number;
  error?: string;
}> = [];
const routes: Array<{
  role: string;
  path: string;
  status: number;
  heading: string;
}> = [];
const deniedRoutes: Array<{
  path: string;
  status: number;
  explicitNotFound: boolean;
}> = [];
const axeResults: Array<{
  name: string;
  passed: number;
  violations: number;
  incomplete: number;
}> = [];
const roles = ["borrower", "buyer", "lender", "verifier", "admin"] as const;
type Role = (typeof roles)[number];
const pages = new Map<Role, Page>();
const roleUsers = new Map<Role, CurrentUser>();
const headings: Record<Role, string> = {
  borrower: "Usaha berjalan. Piutang terpantau.",
  buyer: "Tagihan yang jelas. Pembayaran terarah.",
  lender: "Tinjau bukti sebelum mendanai.",
  verifier: "Bukti dulu. Keputusan yang dapat ditelusuri.",
  admin: "Jaga kewenangan. Pantau prosesnya.",
};

async function walletPage(account: Parameters<typeof installWallet>[1]) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });
  const control = { rejectSignatures: false, requests: {} };
  controls.push(control);
  await installWallet(
    context,
    account,
    chainId as 97 | 31337,
    baseUrl,
    control,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return page;
}
async function check(name: string, fn: () => Promise<void>, page?: Page) {
  const started = Date.now();
  try {
    await fn();
    checks.push({ name, status: "PASSED", durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name,
      status: "FAILED",
      durationMs: Date.now() - started,
      error: message,
    });
    console.error(`FAIL ${name}: ${message}`);
    if (page)
      await page
        .screenshot({
          path: resolve(artifacts, `failure-${checks.length}.png`),
          fullPage: true,
          animations: "disabled",
        })
        .catch(() => undefined);
  }
}
async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="status"]')].some((node) =>
        /^(Memuat|Membuka|Memeriksa akses)/.test(
          (node.textContent ?? "").trim(),
        ),
      ),
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
async function visit(page: Page, role: string, path: string) {
  const response = await page.goto(`${baseUrl}${path}`, {
    waitUntil: "domcontentloaded",
  });
  assert.ok(
    response && response.status() === 200,
    `ROUTE_FAILED:${path}:${response?.status()}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await settled(page);
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  assert.doesNotMatch(
    heading,
    /tidak ditemukan|Application error|belum memiliki akses/i,
  );
  assert.equal(new URL(page.url()).pathname, new URL(path, baseUrl).pathname);
  routes.push({ role, path, status: response.status(), heading });
}
async function assertPageDenied(page: Page, path: string) {
  const response = await page.goto(`${baseUrl}${path}`);
  assert.ok(response, `MISSING_RESPONSE:${path}`);
  const body = await response.text();
  const explicitNotFound = body.includes("NEXT_HTTP_ERROR_FALLBACK;404");
  // Next App Router can flush its loading boundary with 200 before a later
  // server guard calls notFound(). Verify the actual fallback, not status alone.
  assert.ok(
    response.status() === 404 ||
      (response.status() === 200 && explicitNotFound),
    `EXPECTED_SERVER_NOT_FOUND:${path}:${response.status()}`,
  );
  const privateCopy: Record<string, string> = {
    "/admin/organizations": "Identitas kanonik dan hubungan wallet",
    "/admin/audit": "Jejak audit",
    "/admin/access": "Tinjau permohonan, periksa wallet",
    "/agent/runs": "Jejak ekstraksi, evaluasi kebijakan",
    "/agent": "Pantau pemeriksaan, kesehatan worker",
    "/verifier": "Bukti dulu. Keputusan yang dapat ditelusuri.",
    "/borrower": "Usaha berjalan. Piutang terpantau.",
  };
  if (privateCopy[path])
    assert.ok(
      !body.includes(privateCopy[path]),
      `PROTECTED_PAGE_BODY_LEAK:${path}`,
    );
  assert.ok(
    !/\\?"claimKey\\?"\s*:/.test(body),
    `SERIALIZED_CLAIM_LEAK:${path}`,
  );
  deniedRoutes.push({ path, status: response.status(), explicitNotFound });
}
async function capture(page: Page, name: string) {
  await settled(page);
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= window.innerWidth,
    undefined,
    { timeout: 5000 },
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    `HORIZONTAL_OVERFLOW:${name}`,
  );
  await page.screenshot({
    path: resolve(artifacts, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function axe(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const record = {
    name,
    passed: result.passes.length,
    violations: result.violations.length,
    incomplete: result.incomplete.length,
  };
  axeResults.push(record);
  await writeFile(
    resolve(artifacts, `${name}-axe.json`),
    JSON.stringify(
      {
        ...record,
        violationDetails: result.violations,
        incompleteDetails: result.incomplete,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
    [],
  );
}

try {
  const anonymous = await walletPage(privateKeyToAccount(generatePrivateKey()));
  await check(
    "Anonymous direct protected URLs redirect to scoped login",
    async () => {
      for (const path of [
        "/borrower",
        "/buyer",
        "/lender",
        "/verifier",
        "/admin",
        "/agent",
      ]) {
        await anonymous.goto(`${baseUrl}${path}`);
        await expect(anonymous).toHaveURL(
          new RegExp(`/login\\?workspace=${path.slice(1)}(?:&|$)`),
        );
        assert.equal((await request(anonymous, "/v1/ops/status")).status, 401);
      }
    },
    anonymous,
  );

  for (const role of roles) {
    const page = await walletPage(actor(role));
    pages.set(role, page);
    await check(
      `${role}: actual SIWE opens the correct workspace`,
      async () => {
        const me = await login(page, baseUrl);
        roleUsers.set(role, me);
        assert.ok(
          me.memberships.some((item) => item.role === role.toUpperCase()),
        );
        await expect(page).toHaveURL(new RegExp(`/${role}$`));
        await expect(
          page.getByRole("heading", { name: headings[role], exact: true }),
        ).toBeVisible();
        await capture(page, `${role}-desktop`);
      },
      page,
    );
    if (!roleUsers.has(role)) continue;
    await check(
      `${role}: every own sidebar route renders and stays scoped`,
      async () => {
        const paths = [
          ...new Set(
            await page
              .locator("nav a[href]")
              .evaluateAll(
                (nodes, area) =>
                  nodes
                    .map((node) => node.getAttribute("href") ?? "")
                    .filter(
                      (path) =>
                        path === `/${area}` || path.startsWith(`/${area}/`),
                    ),
                role,
              ),
          ),
        ];
        assert.ok(paths.length >= (role === "admin" ? 6 : 6));
        for (const path of paths) await visit(page, role, path);
        await page.goto(`${baseUrl}/${role}`);
      },
      page,
    );
    await check(
      `${role}: mobile role home and drawer keep navigation usable`,
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await visit(page, role, `/${role}`);
        await capture(page, `${role}-mobile`);
        await axe(page, `${role}-mobile`);
        const menu = page
          .getByRole("button", {
            name: /Buka navigasi|Buka menu|Menu navigasi/,
          })
          .first();
        await expect(menu).toBeVisible();
        await menu.click();
        await expect(
          page.getByRole("navigation", { name: "Navigasi utama" }).last(),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
      page,
    );
  }

  const borrower = pages.get("borrower")!;
  const admin = pages.get("admin")!;
  const verifier = pages.get("verifier")!;
  await check(
    "Admin market navigation stays in Admin and opens operator analytics",
    async () => {
      await admin.goto(`${baseUrl}/admin`);
      await admin
        .getByRole("navigation", { name: "Navigasi utama" })
        .first()
        .getByRole("link", { name: "Pasar & analitik" })
        .click();
      await expect(admin).toHaveURL(/\/admin\/explore#market-operator$/);
      await expect(
        admin.getByRole("button", { name: "Operator", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    },
    admin,
  );
  await check(
    "Participant wallets cannot enter admin, verifier or operator pages/APIs",
    async () => {
      for (const role of ["borrower", "buyer", "lender"] as const) {
        const page = pages.get(role)!;
        for (const path of [
          "/admin/organizations",
          "/admin/audit",
          "/agent/runs",
          "/verifier",
        ]) {
          await assertPageDenied(page, path);
        }
        await page.goto(`${baseUrl}/${role}`);
        for (const path of [
          "/v1/ops/status",
          "/v1/ops/agent-runs",
          "/v1/ops/transactions",
          "/v1/ops/organizations",
          "/v1/ops/audit",
        ]) {
          assert.equal(
            (await request(page, path)).status,
            403,
            `${role}:${path}`,
          );
        }
      }
    },
    borrower,
  );
  await check(
    "Verifier can monitor agent operations without admin organization or audit access",
    async () => {
      for (const path of [
        "/v1/ops/status",
        "/v1/ops/agent-runs",
        "/v1/ops/transactions",
      ])
        assert.equal((await request(verifier, path)).status, 200, path);
      for (const path of ["/v1/ops/organizations", "/v1/ops/audit"])
        assert.equal((await request(verifier, path)).status, 403, path);
      await assertPageDenied(verifier, "/admin/access");
      await visit(verifier, "verifier", "/agent");
      const ownLink = verifier.locator('a[href="/verifier"]');
      await expect(ownLink.first()).toBeVisible();
    },
    verifier,
  );
  await check(
    "Legacy workspace links preserve route suffix and unsafe login next stays local",
    async () => {
      await borrower.goto(`${baseUrl}/app/claims`);
      await expect(borrower).toHaveURL(/\/borrower\/claims$/);
      await borrower.goto(
        `${baseUrl}/login?workspace=borrower&next=${encodeURIComponent("https://example.invalid/escape")}`,
      );
      await expect(borrower).toHaveURL(/\/borrower$/);
      assert.equal(new URL(borrower.url()).origin, new URL(baseUrl).origin);
    },
    borrower,
  );

  let detail: OpsRun | undefined;
  await check(
    "Operator overview reports persisted health and real recent runs",
    async () => {
      await visit(admin, "admin", "/agent");
      const state = await request<OpsStatus>(admin, "/v1/ops/status");
      assert.equal(state.status, 200);
      assert.equal(state.data.chainId, chainId);
      assert.equal(state.data.queues.source, "POSTGRES_OUTBOX");
      const runs = await request<ApiPage<OpsRun>>(
        admin,
        "/v1/ops/agent-runs?limit=5&offset=0",
      );
      assert.equal(runs.status, 200);
      detail = runs.data.items[0];
      if (detail)
        await expect(
          admin.getByText(detail.invoiceNumber, { exact: true }).first(),
        ).toBeVisible();
      await capture(admin, "agent-overview-desktop");
      await axe(admin, "agent-overview-desktop");
      await admin.setViewportSize({ width: 390, height: 844 });
      await capture(admin, "agent-overview-mobile");
      await axe(admin, "agent-overview-mobile");
      await admin.setViewportSize({ width: 1440, height: 1000 });
    },
    admin,
  );
  await check(
    "Operator run filters and persisted detail render without invented job state",
    async () => {
      await visit(admin, "admin", "/agent/runs");
      await admin.locator("#ops-run-status").selectOption("FAILED");
      await settled(admin);
      const failed = await request<ApiPage<OpsRun>>(
        admin,
        "/v1/ops/agent-runs?status=FAILED&limit=20&offset=0",
      );
      assert.equal(failed.status, 200);
      assert.ok(failed.data.items.every((run) => run.status === "FAILED"));
      await admin.locator("#ops-run-status").selectOption("");
      await settled(admin);
      await capture(admin, "agent-runs-desktop");
      if (!detail)
        throw new Error("NO_PERSISTED_RUN_AVAILABLE_FOR_DETAIL_CHECK");
      await visit(admin, "admin", `/agent/runs/${detail.id}`);
      const stored = await request<OpsRunDetail>(
        admin,
        `/v1/ops/agent-runs/${detail.id}`,
      );
      assert.equal(stored.status, 200);
      await expect(
        admin.getByRole("heading", { name: detail.invoiceNumber, exact: true }),
      ).toBeVisible();
      await expect(
        admin
          .locator(`a[href="/admin/claims/${detail.claimId}/evidence"]`)
          .first(),
      ).toBeVisible();
      if (!stored.data.retryable)
        await expect(
          admin.getByRole("button", {
            name: "Jadwalkan ulang pemeriksaan",
            exact: true,
          }),
        ).toHaveCount(0);
      await capture(admin, "agent-run-detail-desktop");
      await axe(admin, "agent-run-detail-desktop");
      await admin.setViewportSize({ width: 390, height: 844 });
      await capture(admin, "agent-run-detail-mobile");
      await admin.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(
        (await request(borrower, `/v1/ops/agent-runs/${detail.id}`)).status,
        403,
      );
    },
    admin,
  );
  await check(
    "Operator transaction filters and admin organization authorities use real endpoints",
    async () => {
      await visit(admin, "admin", "/agent/transactions");
      await admin.locator("#ops-tx-status").selectOption("CONFIRMED");
      await settled(admin);
      await capture(admin, "agent-transactions-desktop");
      await visit(admin, "admin", "/admin/organizations");
      await admin.locator("#ops-org-status").selectOption("APPROVED");
      await settled(admin);
      await expect(
        admin
          .getByText(roleUsers.get("borrower")!.wallet.toLowerCase(), {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await capture(admin, "admin-organizations-desktop");
      await axe(admin, "admin-organizations-desktop");
      await admin.setViewportSize({ width: 390, height: 844 });
      await capture(admin, "admin-organizations-mobile");
      await admin.setViewportSize({ width: 1440, height: 1000 });
    },
    admin,
  );
  await check(
    "Admin audit filter and disclosure expand real persisted entries",
    async () => {
      await visit(admin, "admin", "/admin/audit");
      await admin.locator("#ops-audit-action").fill("ACCESS_REQUEST_APPROVED");
      await admin
        .getByRole("button", { name: "Terapkan", exact: true })
        .click();
      await settled(admin);
      const entries = await request<ApiPage<{ action: string }>>(
        admin,
        "/v1/ops/audit?action=ACCESS_REQUEST_APPROVED&limit=20&offset=0",
      );
      assert.equal(entries.status, 200);
      assert.ok(
        entries.data.items.length > 0,
        "ACCESS_APPROVAL_AUDIT_FIXTURE_REQUIRED",
      );
      assert.ok(
        entries.data.items.every(
          (event) => event.action === "ACCESS_REQUEST_APPROVED",
        ),
      );
      await admin.locator("summary").first().click();
      await expect(
        admin.getByText("Correlation ID", { exact: true }).first(),
      ).toBeVisible();
      await capture(admin, "admin-audit-desktop");
      await axe(admin, "admin-audit-desktop");
      await admin.setViewportSize({ width: 390, height: 844 });
      await capture(admin, "admin-audit-mobile");
      await admin.setViewportSize({ width: 1440, height: 1000 });
    },
    admin,
  );
  await check(
    "Unprovisioned wallet remains outside protected claims and operator data",
    async () => {
      await login(anonymous, baseUrl);
      await expect(anonymous).toHaveURL(/\/app$/);
      for (const path of ["/borrower", "/agent", "/admin/audit"]) {
        await assertPageDenied(anonymous, path);
      }
      await anonymous.goto(`${baseUrl}/app`);
      assert.equal((await request(anonymous, "/v1/ops/status")).status, 403);
      const claimList = await request<ApiPage<Claim>>(
        borrower,
        "/v1/claims?limit=1&offset=0",
      );
      const claim = claimList.data.items[0];
      if (claim)
        assert.equal(
          (await request(anonymous, `/v1/claims/${claim.id}`)).status,
          404,
        );
    },
    anonymous,
  );
  await check(
    "Browser runtime has no uncaught errors and never requests financial broadcasts",
    async () => {
      assert.deepEqual(pageErrors, []);
      assert.equal(
        controls.reduce(
          (sum, control) => sum + (control.requests.eth_sendTransaction ?? 0),
          0,
        ),
        0,
      );
    },
  );
} finally {
  await writeFile(
    resolve(artifacts, "report.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        chainId,
        baseUrl,
        checks,
        routes,
        deniedRoutes,
        axeResults,
        pageErrors,
        onchainTransactionsSent: controls.reduce(
          (sum, control) => sum + (control.requests.eth_sendTransaction ?? 0),
          0,
        ),
        fixturePolicy:
          "Read-only operational checks; actual SIWE sessions only. No database edits, fixture deletions, financial transactions, or participant keys written.",
      },
      null,
      2,
    ),
  );
  await browser.close();
}
process.exitCode = checks.some((check) => check.status === "FAILED") ? 1 : 0;
