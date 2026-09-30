import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { actor } from "./actors";
import { installWallet, login, request } from "../tests/ui.browser";
import type { AccessRequestState, CurrentUser } from "../packages/client";

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
const artifacts = resolve(
  process.env.UI_ARTIFACTS_DIR ?? ".local/onboarding-ui",
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const controls: Array<{
  rejectSignatures: boolean;
  requests: Record<string, number>;
}> = [];
const pageErrors: string[] = [];
const checks: Array<{ name: string; status: string; error?: string }> = [];
const runId = randomUUID().slice(0, 8);
const orgName = `CV Kemasan Onboarding ${runId} Simulasi`;
const newcomer = privateKeyToAccount(generatePrivateKey());
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
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    checks.push({ name, status: "PASSED" });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({
      name,
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
async function capture(page: Page, name: string) {
  await page.screenshot({
    path: resolve(artifacts, `${name}.png`),
    fullPage: true,
  });
}
async function axe(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await writeFile(
    resolve(artifacts, `${name}-axe.json`),
    JSON.stringify(
      {
        violations: result.violations,
        incomplete: result.incomplete,
        passed: result.passes.length,
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

let exitCode = 0;
try {
  const userPage = await walletPage(newcomer);
  await check(
    "Legacy example link opens the live workspace entry",
    async () => {
      await userPage.goto(`${baseUrl}/app/demo`);
      await expect(userPage).toHaveURL(`${baseUrl}/app`);
      await expect(
        userPage.getByRole("heading", { name: /Invoice yang jelas/ }),
      ).toBeVisible();
      await capture(userPage, "workspace-entry");
    },
  );
  await check(
    "New wallet signs in and sees actionable organization form",
    async () => {
      const me = await login(userPage, baseUrl);
      assert.equal(me.memberships.length, 0);
      await expect(
        userPage.getByLabel("Organisasi yang akan diwakili", { exact: true }),
      ).toBeVisible();
      await capture(userPage, "access-desktop");
      await axe(userPage, "access-desktop");
      await userPage.setViewportSize({ width: 390, height: 844 });
      await userPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        userPage.getByLabel("Organisasi yang akan diwakili", { exact: true }),
      ).toBeVisible();
      await userPage.waitForFunction(
        () =>
          window.innerWidth === 390 &&
          document.documentElement.scrollWidth === 390,
      );
      await capture(userPage, "access-mobile");
      await axe(userPage, "access-mobile");
      assert.ok(
        await userPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await userPage.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  if (process.env.UI_VISUAL_ONLY !== "1") {
    await check(
      "Access request persists after reload without granting membership",
      async () => {
        await userPage
          .getByLabel("Organisasi yang akan diwakili", { exact: true })
          .fill(orgName);
        await userPage
          .getByLabel("Catatan untuk pengelola", { exact: false })
          .fill(
            "Permohonan sintetis dari pengujian onboarding nyata; tidak ada dana nyata.",
          );
        await userPage
          .getByRole("button", { name: "Ajukan akses", exact: true })
          .click();
        await expect(
          userPage.getByRole("heading", {
            name: "Menunggu persetujuan akses.",
          }),
        ).toBeVisible();
        await userPage.reload();
        await expect(
          userPage.getByRole("heading", { name: orgName, exact: true }),
        ).toBeVisible();
        const state = await request<AccessRequestState>(
          userPage,
          "/v1/access-request",
        );
        assert.equal(state.status, 200);
        assert.equal(state.data.request?.status, "PENDING");
        const me = await request<CurrentUser>(userPage, "/v1/me");
        assert.equal(me.data.memberships.length, 0);
        assert.equal(
          (await request(userPage, "/v1/access-requests")).status,
          403,
        );
        await capture(userPage, "access-pending");
      },
    );
    // The following checks drive the operator through the same authenticated UI
    // as a real administrator. No database shortcut or participant key in browser.
    const adminPage = await walletPage(actor("admin"));
    await check(
      "Approved administrator can open access request review",
      async () => {
        const admin = await login(adminPage, baseUrl);
        assert.ok(admin.memberships.some((item) => item.role === "ADMIN"));
        await adminPage.goto(`${baseUrl}/admin/access`);
        await expect(
          adminPage.getByText(orgName, { exact: true }).first(),
        ).toBeVisible();
      },
    );
    await check(
      "Administrator creates a reviewed canonical organization and approves exact request",
      async () => {
        await adminPage
          .getByRole("button")
          .filter({ hasText: orgName })
          .click();
        await expect(adminPage.getByTestId("access-review-wallet")).toHaveText(
          newcomer.address.toLowerCase(),
        );
        await adminPage
          .getByRole("button", { name: "Organisasi baru", exact: true })
          .click();
        await adminPage
          .locator("#access-org-identity")
          .fill(`onboarding-ui-${runId}`);
        await adminPage
          .locator("#access-org-reason")
          .fill(
            "Identitas sintetis unik untuk uji onboarding; berbeda dari organisasi seed.",
          );
        await adminPage
          .getByRole("button", {
            name: "Buat organisasi sintetis",
            exact: true,
          })
          .click();
        await expect(
          adminPage.locator("#create-access-organization"),
        ).toHaveCount(0);
        await expect(adminPage.locator("#review-organization")).not.toHaveValue(
          "",
        );
        await adminPage
          .locator("#access-review-reason")
          .fill(
            "Wallet peserta terpisah; organisasi sintetis dan kewenangan borrower ditinjau untuk uji ini.",
          );
        await capture(adminPage, "admin-review");
        await axe(adminPage, "admin-review");
        await adminPage
          .getByRole("button", { name: "Setujui akses", exact: true })
          .click();
        await expect(
          adminPage.getByText("Akses organisasi disetujui", { exact: true }),
        ).toBeVisible();
      },
    );
    await check(
      "Approved participant automatically enters workspace and can start an invoice",
      async () => {
        await expect(
          userPage.getByRole("heading", {
            name: "Usaha berjalan. Piutang terpantau.",
            exact: true,
          }),
        ).toBeVisible({ timeout: 40_000 });
        const me = await request<CurrentUser>(userPage, "/v1/me");
        assert.ok(
          me.data.memberships.some(
            (item) =>
              item.role === "BORROWER" && item.organizationName === orgName,
          ),
        );
        await userPage
          .locator('a[href="/borrower/claims/new"]')
          .first()
          .click();
        await expect(userPage).toHaveURL(/\/borrower\/claims\/new$/);
        await expect(
          userPage.getByText("Ajukan akses organisasi.", {
            exact: true,
          }),
        ).toHaveCount(0);
        await capture(userPage, "approved-new-invoice");
        assert.equal(
          (await request(userPage, "/v1/access-requests")).status,
          403,
        );
      },
    );
    await check(
      "Rejected request retains review reason and can be corrected",
      async () => {
        const rejectedPage = await walletPage(
          privateKeyToAccount(generatePrivateKey()),
        );
        await login(rejectedPage, baseUrl);
        const rejectedName = `CV Perbaikan ${runId} Simulasi`;
        await rejectedPage
          .getByLabel("Organisasi yang akan diwakili", { exact: true })
          .fill(rejectedName);
        await rejectedPage
          .getByRole("button", { name: "Ajukan akses", exact: true })
          .click();
        await expect(
          rejectedPage.getByRole("heading", {
            name: "Menunggu persetujuan akses.",
          }),
        ).toBeVisible();
        await adminPage
          .getByRole("button", { name: "Perbarui", exact: true })
          .click();
        await adminPage
          .getByRole("button")
          .filter({ hasText: rejectedName })
          .click();
        await adminPage
          .locator("#access-review-reason")
          .fill(
            "Mohon jelaskan kewenangan wallet pada organisasi sintetis ini sebelum mengajukan ulang.",
          );
        await adminPage
          .getByRole("button", { name: "Tolak permohonan", exact: true })
          .click();
        await expect(
          adminPage.getByText("Keputusan penolakan tersimpan", { exact: true }),
        ).toBeVisible();
        await rejectedPage
          .getByRole("button", { name: "Periksa status akses", exact: true })
          .click();
        await expect(
          rejectedPage.getByRole("heading", {
            name: "Permohonan perlu diperbaiki",
          }),
        ).toBeVisible();
        await rejectedPage
          .getByLabel("Catatan untuk pengelola", { exact: false })
          .fill(
            "Saya peserta fiktif berwenang sebagai pemohon pada organisasi uji ini.",
          );
        await rejectedPage
          .getByRole("button", { name: "Ajukan akses", exact: true })
          .click();
        await expect(
          rejectedPage.getByRole("heading", {
            name: "Menunggu persetujuan akses.",
          }),
        ).toBeVisible();
      },
    );
    await check(
      "Configured agent wallet cannot acquire participant role",
      async () => {
        if (
          !process.env.DEMO_AGENT_PRIVATE_KEY &&
          process.env.AGENT_PRIVATE_KEY
        )
          process.env.DEMO_AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
        const agentPage = await walletPage(actor("agent"));
        await login(agentPage, baseUrl);
        await expect(
          agentPage.getByRole("heading", {
            name: "Gunakan wallet peserta.",
            exact: true,
          }),
        ).toBeVisible();
        const response = await request(
          agentPage,
          "/v1/access-request",
          "POST",
          {
            organizationName: "Agent participant escalation",
            requestedRole: "BORROWER",
          },
        );
        assert.equal(response.status, 403);
        await capture(agentPage, "restricted-agent");
        await axe(agentPage, "restricted-agent");
      },
    );
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(
    controls.reduce(
      (total, item) => total + (item.requests.eth_sendTransaction ?? 0),
      0,
    ),
    0,
  );
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await writeFile(
    resolve(artifacts, "report.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        pageErrors,
        onchainTransactionsSent: controls.reduce(
          (total, item) => total + (item.requests.eth_sendTransaction ?? 0),
          0,
        ),
      },
      null,
      2,
    ),
  );
  await browser.close();
}
process.exitCode = exitCode;
