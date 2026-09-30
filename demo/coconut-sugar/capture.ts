import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import type { PrivateKeyAccount } from "viem/accounts";
import { installWallet, login } from "../../tests/ui.browser";
import { artifact, read, save, sha256, type Role } from "./common";

export class ProductCapture {
  private browser?: Browser;
  private pages = new Map<Role, Page>();
  private errors: string[] = [];
  constructor(
    private readonly accounts: Record<Role, PrivateKeyAccount>,
    private readonly enabled = true,
  ) {}
  async page(role: Role) {
    if (this.pages.has(role)) return this.pages.get(role)!;
    this.browser ??= await chromium.launch({
      headless: true,
      ...(process.env.CASE_CHROMIUM_PATH
        ? { executablePath: process.env.CASE_CHROMIUM_PATH }
        : {}),
    });
    const base = process.env.APP_ORIGIN!;
    const context = await this.browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1080 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
    });
    await installWallet(context, this.accounts[role], 97, base, {
      rejectSignatures: false,
      requests: {},
    });
    const page = await context.newPage();
    page.setDefaultTimeout(35_000);
    page.on("pageerror", (e) => this.errors.push(e.message));
    await login(page, base);
    this.pages.set(role, page);
    return page;
  }
  async take(
    role: Role,
    claimId: string,
    name: string,
    tab?: "evidence" | "terms" | "payments",
  ) {
    if (!this.enabled) return;
    const page = await this.page(role);
    const suffix = tab ? `/${tab}` : "";
    const url = `${process.env.APP_ORIGIN}/${role}/claims/${claimId}${suffix}`;
    const res = await page.goto(url, { waitUntil: "domcontentloaded" });
    assert.equal(res?.status(), 200, "CAPTURE_ROUTE_FAILED");
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[role="status"]')].some((n) =>
          /^(Memuat|Membuka|Memeriksa akses)/.test(
            (n.textContent ?? "").trim(),
          ),
        ),
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Hide development chrome in this capture only; leave application errors and testnet labels visible.
    await page.addStyleTag({
      content: "nextjs-portal { visibility: hidden !important; }",
    });
    await page.waitForTimeout(450);
    assert.equal(
      this.errors.length,
      0,
      `CAPTURE_RUNTIME_ERROR:${this.errors.join(";")}`,
    );
    const text = await page.locator("main").innerText();
    assert.doesNotMatch(
      text,
      /Application error|ECONNREFUSED|Internal Server Error|Tidak dapat memuat|Data tidak tersedia/,
    );
    assert.match(text, /GKN\//, "CAPTURE_WRONG_INVOICE");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "CAPTURE_HORIZONTAL_OVERFLOW",
    );
    await mkdir(artifact("screenshots"), { recursive: true });
    const filename = `screenshots/${name}.png`;
    // Full page avoids clipping a tall real financial surface; editors can use the matching main crop.
    await page.screenshot({
      path: artifact(filename),
      fullPage: true,
      animations: "disabled",
    });
    await page.locator("main").screenshot({
      path: artifact(`screenshots/${name}-main.png`),
      animations: "disabled",
    });
    const entries =
      (await read<Array<Record<string, unknown>>>(
        artifact("screenshots/manifest.json"),
      )) ?? [];
    const entry = {
      name,
      role,
      claimId,
      source: "ACTUAL_TALUNAI_UI",
      url,
      capturedAt: new Date().toISOString(),
      viewport: { width: 1440, height: 1080 },
      fullPage: true,
      sha256: sha256(await readFile(artifact(filename))),
    };
    await save(artifact("screenshots/manifest.json"), [
      ...entries.filter((e) => e.name !== name),
      entry,
    ]);
    console.log(`Capture actual UI: ${name}`);
  }
  async close() {
    await this.browser?.close();
  }
}
