import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = process.env.LANDING_BASE_URL ?? "https://localhost:3000";
const output = ".local/landing-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const report: Record<string, unknown>[] = [];

async function revealPage(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((position) => window.scrollTo(0, position), y);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(750);
  await page.evaluate(() => window.scrollTo(0, 0));
}

try {
  for (const [width, height] of [
    [1440, 1000],
    [1280, 900],
    [1024, 900],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    const mutations: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      requests.push(request.url());
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
        mutations.push(`${request.method()} ${request.url()}`);
    });
    const response = await page.goto(origin, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.title(), /Modal lebih awal dari invoice bisnis/);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}px`,
    );
    const cta = await page
      .locator(".landing-hero-actions a")
      .first()
      .boundingBox();
    assert.ok(
      cta && cta.y + cta.height < height,
      `Hero CTA below viewport at ${width}px`,
    );
    const invalidAnchors = await page
      .locator('a[href^="#"]')
      .evaluateAll((anchors) =>
        anchors
          .filter(
            (anchor) =>
              !document.getElementById(
                (anchor as HTMLAnchorElement).hash.slice(1),
              ),
          )
          .map((anchor) => anchor.getAttribute("href")),
      );
    assert.deepEqual(invalidAnchors, []);
    await page.screenshot({ path: `${output}/hero-${width}.png` });
    await revealPage(page);
    await page.screenshot({
      path: `${output}/page-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      requests.some((url) => /\/v1\/(auth|me|config)(?:\/|\?|$)/.test(url)),
      false,
      "Landing must not load application auth/config",
    );

    if (width === 1440 || width === 390) {
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        accessibility.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map((node) => node.target),
        })),
        [],
      );
      const tab = page.getByRole("tab", { name: "Pendanaan", exact: true });
      await tab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: "Pembayaran", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.match(
        await page.locator("#proof-panel").innerText(),
        /Rp100\.000\.000/,
      );
      assert.equal(
        await page.locator(".landing-allocation dl").isVisible(),
        true,
      );
      assert.equal(
        await page.locator(".landing-allocation summary").count(),
        0,
      );
      assert.match(
        await page.locator(".landing-allocation").innerText(),
        /Rp120\.000\.000/,
      );
      assert.match(
        await page.locator(".landing-allocation").innerText(),
        /Rp20\.000\.000/,
      );
      assert.match(
        await page.locator(".landing-allocation").innerText(),
        /Rp71\.050\.000/,
      );
      assert.match(
        await page.locator(".landing-allocation").innerText(),
        /Rp28\.950\.000/,
      );
      await page
        .locator(".landing-deal")
        .screenshot({ path: `${output}/allocation-${width}.png` });

      // A role preview changes explanation only, never authority or deal state.
      await page.getByRole("tab", { name: /Pembeli Konfirmasi/ }).focus();
      await page.keyboard.press("End");
      assert.match(
        await page.locator("#role-preview-panel").innerText(),
        /Deal siap didanai/,
      );
      assert.match(
        await page.locator("#role-preview-panel").innerText(),
        /Rp70\.000\.000/,
      );
      assert.match(
        await page.locator("#role-preview-panel").innerText(),
        /Rp1\.050\.000/,
      );
      await page.keyboard.press("Home");
      assert.match(
        await page.locator("#role-preview-panel").innerText(),
        /Lengkapi bukti invoice/,
      );
      await page.keyboard.press("ArrowRight");
      assert.match(
        await page.locator("#role-preview-panel").innerText(),
        /Periksa bukti dan ambil keputusan/,
      );
      await page
        .locator(".landing-workflow")
        .screenshot({ path: `${output}/workflow-${width}.png` });
      await page.locator(".landing-check-log summary").click();
      assert.equal(await page.locator(".landing-check-log time").count(), 3);
      assert.equal(
        await page
          .locator(".landing-check-log time")
          .first()
          .getAttribute("datetime"),
        "2026-09-29T08:24:09.664Z",
      );
      await page
        .locator(".landing-checks-visual")
        .screenshot({ path: `${output}/checks-${width}.png` });
    }
    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const menu = page.locator(".landing-mobile-menu summary");
      await menu.click();
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".landing-mobile-menu").getAttribute("open"),
        null,
      );
      assert.equal(
        await menu.evaluate((element) => element === document.activeElement),
        true,
      );
      await menu.click();
      await page
        .locator(".landing-menu-panel")
        .getByRole("link", { name: "Cara Kerja" })
        .click();
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "cara-kerja",
      );
      assert.equal(
        await page.locator(".landing-mobile-menu").getAttribute("open"),
        null,
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(
      mutations,
      [],
      "Landing previews must never mutate deal state",
    );
    report.push({
      width,
      height,
      horizontalOverflow: false,
      consoleErrors: errors,
      authRequests: false,
      dealMutations: false,
      rolePreview:
        width === 1440 || width === 390
          ? "four roles; keyboard and amounts verified"
          : "layout checked",
      accessibility:
        width === 1440 || width === 390
          ? "WCAG A/AA: no automated violations"
          : "layout checked",
    });
    await context.close();
  }

  const fallback = await browser.newPage({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
  });
  await fallback.route("**/v1/explore?events=0", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":{"code":"UNAVAILABLE"}}',
    }),
  );
  await fallback.goto(origin, { waitUntil: "networkidle" });
  await fallback.locator("#produk").scrollIntoViewIfNeeded();
  await fallback
    .getByText("Pembaruan jaringan belum tersedia.", { exact: false })
    .waitFor();
  assert.equal(
    await fallback
      .locator(".landing-hero-object")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  assert.equal(
    await fallback.locator(".landing-proof-amount").innerText(),
    "Rp70.000.000",
  );
  await fallback
    .getByRole("button", { name: "Periksa ulang data jaringan" })
    .click();
  await fallback
    .getByText("Pembaruan jaringan belum tersedia.", { exact: false })
    .waitFor();
  await fallback
    .locator(".landing-deal")
    .screenshot({ path: `${output}/network-unavailable.png` });
  const checks = fallback.locator(".landing-checks-visual");
  await checks.scrollIntoViewIfNeeded();
  assert.equal(
    await checks.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
    0,
    "Reduced motion must start static",
  );
  const archivedChecks = await checks.locator("ul").innerText();
  await fallback
    .getByRole("button", { name: "Putar animasi pemeriksaan" })
    .click();
  await fallback.waitForFunction(
    () =>
      document
        .querySelector(".landing-checks-visual")
        ?.getAnimations({ subtree: true })
        .some(
          (animation) =>
            (animation.effect?.getComputedTiming().currentIteration ?? 0) >= 1,
        ),
    undefined,
    { timeout: 12_000 },
  );
  const scan = checks.locator(".landing-check-scan").first();
  const firstPosition = await scan.evaluate(
    (element) => getComputedStyle(element, "::after").transform,
  );
  await fallback.waitForTimeout(450);
  assert.notEqual(
    await scan.evaluate(
      (element) => getComputedStyle(element, "::after").transform,
    ),
    firstPosition,
    "Explicit play must visibly move the scan, despite the global reduced-motion reset",
  );
  assert.equal(await checks.locator("ul").innerText(), archivedChecks);
  assert.equal(
    await fallback
      .locator(".landing-hero-object")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
    "Explicit play must not enable motion elsewhere",
  );
  await fallback
    .getByRole("button", { name: "Jeda animasi pemeriksaan" })
    .click();
  assert.equal(
    await checks.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
    0,
  );
  report.push({
    reducedMotion:
      "static by default; explicit play visibly repeats; pause works",
    apiFailure: "archived proof preserved; retry available",
  });
  await fallback.close();

  const noJs = await browser.newPage({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  await noJs.goto(origin);
  assert.ok(await noJs.getByRole("heading", { level: 1 }).isVisible());
  assert.equal(
    await noJs.locator(".landing-hero-actions a").first().getAttribute("href"),
    "/app",
  );
  assert.equal(await noJs.locator(".landing-network-read").isVisible(), false);
  assert.match(
    await noJs.locator(".landing-deal-terms").innerText(),
    /13 Nov 2026/,
  );
  await noJs.close();
  report.push({
    withoutJavaScript:
      "headline, primary links, static proof and native menu available",
  });

  const handoff = await browser.newPage({ ignoreHTTPSErrors: true });
  const handoffErrors: string[] = [];
  handoff.on("pageerror", (error) => handoffErrors.push(error.message));
  await handoff.goto(origin, { waitUntil: "networkidle" });
  await handoff.locator(".landing-hero-actions a").first().click();
  await handoff.waitForURL(/\/app(?:\?.*)?$/);
  await handoff.waitForLoadState("networkidle");
  assert.deepEqual(handoffErrors, []);
  report.push({
    applicationHandoff: "/app loads without browser runtime errors",
  });
  await handoff.close();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { checkedAt: new Date().toISOString(), origin, results: report },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
