import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { actor } from "./actors";
import {
  installWallet,
  login,
  openWalletLogin,
  request,
} from "../tests/ui.browser";

// Signs login messages only. No broadcasts, fixture writes or financial actions.
const baseUrl = process.env.WALLET_TEST_ORIGIN ?? "https://localhost:3000";
const output = ".private/wallet-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

async function stableCapture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // Let RainbowKit's entrance transition finish.
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(size.scroll <= size.width, `Overflow: ${name}`);
  const dialog = page.getByRole("dialog");
  const box = await dialog.getByRole("document").boundingBox();
  assert.ok(
    box && box.x >= 0 && box.x + box.width <= size.width + 1,
    `Dialog clipped: ${name}`,
  );
  await page.screenshot({ path: `${output}/${name}.png` });
}

try {
  // Real wallet selection, QR generation, keyboard dismissal and mobile layout.
  const visual = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
  });
  const page = await visual.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/app`);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
    await page
      .getByRole("button", { name: "Masuk dengan wallet", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "OKX Wallet", exact: true }),
    ).toBeVisible();
    await stableCapture(page, `wallet-picker-${width}`);
    const a11y = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      // RainbowKit 2.2.11 duplicates the wallet name with a decorative role=img
      // wrapper lacking alt. Check the labelled buttons and rest of the modal.
      .exclude('button[data-testid^="rk-wallet-option-"] [role="img"]')
      .analyze();
    assert.deepEqual(
      a11y.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
      [],
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page
    .getByRole("button", { name: "Masuk dengan wallet", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "WalletConnect", exact: true })
    .click();
  // QR is generated from a real WalletConnect pairing URI, never a placeholder.
  await expect(page.getByRole("dialog")).toContainText(/Pindai|Scan/, {
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole("dialog")
      .locator("svg[role=img], svg[data-testid], svg")
      .filter({ visible: true })
      .last(),
  ).toBeVisible({ timeout: 30_000 });
  await stableCapture(page, "walletconnect-qr");
  assert.deepEqual(pageErrors, []);
  await visual.close();
  console.log(
    "PASS responsive wallet picker, keyboard, a11y and WalletConnect QR",
  );

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
  });
  const control: Parameters<typeof installWallet>[4] = {
    rejectSignatures: true,
    authorized: false,
    requests: {},
  };
  await installWallet(context, actor("admin"), 97, baseUrl, control);
  // A second extension must never take over the wallet selected via EIP-6963.
  await context.addInitScript({
    content: `window.ethereum = { request() { throw new Error('WRONG_PROVIDER_USED'); }, on() {}, removeListener() {} };`,
  });
  const auth = await context.newPage();
  const authErrors: string[] = [];
  auth.on("pageerror", (error) => authErrors.push(error.message));
  await auth.goto(`${baseUrl}/app`);
  await expect(
    auth
      .getByRole("button", { name: "Masuk dengan wallet", exact: true })
      .first(),
  ).toBeVisible();
  assert.equal(
    control.requests.eth_accounts ?? 0,
    0,
    "A fresh visit must not auto-connect another provider in the background",
  );
  await openWalletLogin(auth, baseUrl);
  await auth.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect.poll(() => control.requests.personal_sign ?? 0).toBe(1);
  await expect(
    auth.getByRole("button", { name: "Kirim pesan", exact: true }),
  ).toBeEnabled();
  assert.equal((await request(auth, "/v1/me")).status, 401);
  await stableCapture(auth, "signature-retry");
  control.rejectSignatures = false;
  await auth.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect(
    auth.getByRole("button", { name: "Keluar dari sesi", exact: true }),
  ).toBeVisible();
  assert.equal((await request(auth, "/v1/me")).status, 200);
  await expect(auth.getByRole("dialog")).toBeHidden();
  await auth.setViewportSize({ width: 360, height: 844 });
  await expect
    .poll(() =>
      auth.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await auth.screenshot({ path: `${output}/connected-mobile.png` });
  console.log(
    "PASS rejected signature recovery and selected provider isolation",
  );
  const signaturesBeforeReload = control.requests.personal_sign;
  await auth.reload();
  await expect(
    auth.getByRole("button", { name: /Kelola wallet/ }),
  ).toBeVisible();
  assert.equal((await request(auth, "/v1/me")).status, 200);
  assert.equal(control.requests.personal_sign, signaturesBeforeReload);
  console.log(
    "PASS chosen wallet reconnects after reload without another signature",
  );
  await auth.getByRole("button", { name: /Kelola wallet/ }).click();
  await stableCapture(auth, "wallet-account");
  await auth.getByRole("button", { name: /Putuskan koneksi/ }).click();
  await expect
    .poll(async () => (await request(auth, "/v1/me")).status)
    .toBe(401);
  console.log("PASS RainbowKit disconnect revokes server session");

  await login(auth, baseUrl);
  control.activeAddress = actor("buyer").address;
  await auth.evaluate((address) => {
    (
      window as unknown as {
        __talunaiTestWalletEmit: (event: string, value: unknown) => void;
      }
    ).__talunaiTestWalletEmit("accountsChanged", [address]);
  }, control.activeAddress);
  await expect
    .poll(async () => (await request(auth, "/v1/me")).status)
    .toBe(401);
  await expect(
    auth.getByRole("button", { name: /Kelola wallet/ }),
  ).toBeHidden();
  control.activeAddress = actor("admin").address;
  await auth.evaluate((address) => {
    (
      window as unknown as {
        __talunaiTestWalletEmit: (event: string, value: unknown) => void;
      }
    ).__talunaiTestWalletEmit("accountsChanged", [address]);
  }, control.activeAddress);
  await login(auth, baseUrl);
  control.activeChainId = 1;
  await auth.evaluate(() => {
    (
      window as unknown as {
        __talunaiTestWalletEmit: (event: string, value: unknown) => void;
      }
    ).__talunaiTestWalletEmit("chainChanged", "0x1");
  });
  await expect
    .poll(async () => (await request(auth, "/v1/me")).status)
    .toBe(401);
  assert.equal(control.requests.eth_sendTransaction ?? 0, 0);
  assert.deepEqual(authErrors, []);
  console.log(
    "PASS account / chain changes lock previous role; no financial transaction sent",
  );
  await context.close();
} finally {
  await browser.close();
}
