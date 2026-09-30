import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { actor } from "./actors";
import { installWallet, login } from "../tests/ui.browser";

const baseUrl = process.env.APP_ORIGIN ?? "https://localhost:3000";
assert.equal(new URL(baseUrl).origin, "https://localhost:3000");
assert.equal(Number(process.env.CHAIN_ID), 97);

const browser = await chromium.launch({ headless: true });
try {
  const actors = [
    { role: "admin", membership: "ADMIN", workspace: "admin" },
    { role: "verifier", membership: "VERIFIER", workspace: "verifier" },
    { role: "borrower", membership: "BORROWER", workspace: "borrower" },
    { role: "buyer", membership: "BUYER", workspace: "buyer" },
    { role: "lender", membership: "LENDER", workspace: "lender" },
    { role: "lenderTwo", membership: "LENDER", workspace: "lender" },
  ] as const;
  for (const { role, membership, workspace } of actors) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const control = { rejectSignatures: false, requests: {} };
    await installWallet(context, actor(role), 97, baseUrl, control);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      if (role === "admin") {
        await page.goto("https://127.0.0.1:3000/app", {
          waitUntil: "domcontentloaded",
        });
        await expect(page).toHaveURL(`${baseUrl}/app`, {
          timeout: 15_000,
        });
      }
      const me = await login(page, baseUrl);
      assert.ok(me.memberships.some((item) => item.role === membership));
      await expect(page).toHaveURL(new RegExp(`/${workspace}(?:/|$)`), {
        timeout: 15_000,
      });
      await expect(page.locator("h1").first()).toBeVisible();
      if (role === "admin") {
        const access = await page.goto(`${baseUrl}/admin/access`);
        assert.equal(access?.status(), 200);
        await expect(page.locator("h1").first()).toBeVisible();
      }
      if (role === "admin" || role === "verifier") {
        const agent = await page.goto(`${baseUrl}/agent`);
        assert.equal(agent?.status(), 200);
        await expect(page.locator("h1").first()).toBeVisible();
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${role} wallet login and workspace route`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
