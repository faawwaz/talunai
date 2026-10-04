import { chromium, expect } from "@playwright/test";
import { beats } from "../src/features/demo/replay";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.DEMO_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const output = process.env.DEMO_QA_DIR ?? ".private/demo-qa/local";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
let monitoringReplay = true;
const errors: string[] = [],
  requests: string[] = [],
  broken: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (!monitoringReplay) return;
  if (
    /\/v1\/|openrouter|walletconnect|reown|eth_sendTransaction/.test(r.url()) ||
    !["GET", "HEAD"].includes(r.method())
  )
    requests.push(`${r.method()} ${r.url()}`);
});
page.on("response", (r) => {
  if (r.status() >= 400 && new URL(r.url()).origin === new URL(origin).origin)
    broken.push(`${r.status()} ${r.url()}`);
});
expect.configure({ timeout: 30000 });
const deal = page.getByTestId("demo-deal");
const steps = page.getByRole("navigation", { name: "Tahap demo" });
const goto = async (name: string) =>
  steps.getByRole("button", { name: new RegExp(name) }).click();
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: "Lihat Demo", exact: true })
    .first()
    .click();
  await expect(deal).toHaveAttribute("data-step", "0", { timeout: 30000 });
  requests.length = 0;
  await expect(
    page.getByRole("heading", { name: "INV/GKN/20260930/HERO", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Mode Demo", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${output}/01-pengajuan-1440.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Lihat konfirmasi buyer", exact: true })
    .click();
  await expect(deal).toHaveAttribute("data-step", "1");
  await page
    .getByRole("button", { name: "Konfirmasi invoice", exact: true })
    .click();
  await expect(deal).toHaveAttribute("data-phase", "1");
  await page
    .getByRole("button", { name: "Mulai pemeriksaan", exact: true })
    .click();
  await expect(deal).toHaveAttribute("data-step", "2");
  await expect(deal).toHaveAttribute("data-phase", "4", { timeout: 10000 });
  await expect(
    page.getByText("Kategori barang perlu tinjauan manual.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `${output}/03-pemeriksaan-1440.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Lanjut ke review", exact: true })
    .click();
  await page.getByRole("button", { name: "Setujui deal", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Lihat pencatatan deal/ }),
  ).toHaveAttribute("href", /0x70d12a0c/);
  await page
    .getByRole("button", { name: "Lihat pendanaan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Danai Rp70.000.000", exact: true })
    .click();
  await expect(deal).toHaveAttribute("data-phase", "1");
  await expect(
    page.getByRole("heading", { name: "Mengonfirmasi transaksi…" }),
  ).toBeVisible();
  await expect(deal).toHaveAttribute("data-phase", "2", { timeout: 6000 });
  await expect(
    page.getByRole("link", { name: /Lihat transaksi pendanaan/ }),
  ).toHaveAttribute("href", /0xb11a90ec/);
  await page.screenshot({
    path: `${output}/05-didanai-1440.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Lihat pembayaran buyer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bayar invoice", exact: true })
    .click();
  await expect(deal).toHaveAttribute("data-phase", "2", { timeout: 6000 });
  await page
    .getByRole("button", { name: "Lihat pembagian dana", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tarik hak pendana", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tarik sisa pemasok", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deal selesai", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${output}/07-selesai-1440.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Deal selesai", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Putar Otomatis", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sebelumnya", exact: true }).click();
  await expect(deal).toHaveAttribute("data-step", "5");
  await page.getByRole("button", { name: "Ulangi Demo", exact: true }).click();
  await expect(deal).toHaveAttribute("data-step", "0");
  // Autoplay, pause, and hidden-tab behavior use a controlled browser clock.
  await page.clock.install();
  await page
    .getByRole("button", { name: "Putar Otomatis", exact: true })
    .click();
  await page.clock.runFor(5050);
  await expect(deal).toHaveAttribute("data-step", "1");
  await page.getByRole("button", { name: "Jeda", exact: true }).click();
  await page.clock.runFor(15000);
  await expect(deal).toHaveAttribute("data-phase", "0");
  await page
    .getByRole("button", { name: "Putar Otomatis", exact: true })
    .click();
  for (let i = 2; i < beats.length; i++) {
    await page.clock.runFor(beats[i - 1].duration + 50);
    await expect(deal).toHaveAttribute("data-step", String(beats[i].step));
    await expect(deal).toHaveAttribute("data-phase", String(beats[i].phase));
  }
  await expect(
    page.getByRole("heading", { name: "Deal selesai", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1080 });
    for (const [name, suffix] of [
      ["Pengajuan", "invoice"],
      ["Pemeriksaan", "checks"],
      ["Pendanaan", "funding"],
      ["Settlement", "settlement"],
    ]) {
      await goto(name);
      if (name === "Pemeriksaan") {
        for (let phase = 1; phase <= 4; phase++) {
          await page.clock.runFor(1050);
          await expect(deal).toHaveAttribute("data-phase", String(phase));
        }
      }
      if (name === "Settlement") {
        await page
          .getByRole("button", { name: "Tarik hak pendana", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Tarik sisa pemasok", exact: true })
          .click();
      }
      await page.clock.runFor(400);
      await expect(deal).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${output}/${width}-${suffix}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await writeFile(
    `${output}/axe.json`,
    JSON.stringify(axe.violations, null, 2),
  );
  expect(axe.violations).toEqual([]);
  await goto("Pengajuan");
  const keyboardTarget = steps.getByRole("button", {
    name: /Konfirmasi buyer/,
  });
  await keyboardTarget.focus();
  await page.keyboard.press("Enter");
  await expect(deal).toHaveAttribute("data-step", "1");
  await page
    .getByRole("button", { name: "Putar Otomatis", exact: true })
    .click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Putar Otomatis", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(6000);
  await expect(deal).toHaveAttribute("data-phase", "0");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto("Pengajuan");
  expect(
    await page
      .locator(".demo-stage-panel")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  // Actual files are public but no private document API or credentials are used.
  for (const name of ["invoice", "delivery-note", "buyer-acknowledgement"]) {
    const response = await context.request.get(
      `${origin}/demo/coconut-sugar/${name}.pdf`,
    );
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  }
  expect(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every(
          (img) =>
            (img as HTMLImageElement).complete &&
            (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(broken).toEqual([]);
  // Verify the real app handoff after the replay side-effect assertions.
  monitoringReplay = false;
  await page.clock.resume();
  await page.getByRole("link", { name: "Buka Aplikasi", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:[?#]|$)/, { timeout: 30000 });
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        origin,
        result: "PASS",
        viewports: [1440, 1280, 1024, 768, 390, 360],
        pageErrors: errors,
        forbiddenRequests: requests,
        brokenResponses: broken,
        axeViolations: axe.violations.length,
        manualFlow: true,
        autoplay: true,
        resumeAfterRefresh: true,
        reducedMotion: true,
        realDocuments: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS guided demo: ${origin}; no API/wallet/LLM requests; six viewport widths; manual/autoplay/refresh/links/axe.`,
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      { error: String(error), errors, requests, broken, url: page.url() },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
