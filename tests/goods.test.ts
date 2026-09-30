import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { GoodsSchema, goodsPolicyReasons } from "../packages/domain/goods";
import { extractDeterministic } from "../packages/agents/extraction";
import { parseDocument } from "../packages/agents/documents";

describe("B2B delivered goods scope", () => {
  it.each(["COCOA", "PACKAGING", "OTHER"] as const)(
    "%s uses generic goods metadata",
    (category) => {
      const goods = {
        category,
        description: "Barang demo",
        lineItems: [
          {
            description: "Barang demo",
            quantity: "100000000000000000000000.125",
            unit: "pcs",
          },
        ],
      };
      expect(GoodsSchema.parse(goods)).toEqual(goods);
      expect(goodsPolicyReasons("TRADE_RECEIVABLE", goods)).toEqual([]);
    },
  );
  it("requires complete delivered-goods metadata and a trade receivable", () => {
    expect(goodsPolicyReasons("TRADE_RECEIVABLE", null)).toContain(
      "GOODS_DETAILS_REQUIRED",
    );
    const goods = {
      category: "OTHER",
      description: "Barang lain",
      lineItems: [{ description: "Barang lain", quantity: "1", unit: "pcs" }],
    };
    expect(goodsPolicyReasons("TRADE_RECEIVABLE", goods)).toEqual([]);
    expect(GoodsSchema.safeParse({ ...goods, category: "GOLD" }).success).toBe(
      false,
    );
    for (const asset of [
      "PURCHASE_ORDER",
      "INVENTORY",
      "REAL_ESTATE",
      "GOLD",
      "FUTURE_HARVEST",
    ])
      expect(goodsPolicyReasons(asset, goods)).toContain(
        "TRADE_RECEIVABLE_REQUIRED",
      );
  });
  it.each(["0", "-1", "1e4", "01", "1,5", "NaN", "0.0000001"])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(
        GoodsSchema.safeParse({
          category: "PACKAGING",
          description: "Kemasan",
          lineItems: [{ description: "Karton", quantity, unit: "pcs" }],
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    ["cocoa", "COCOA", "ton"],
    ["packaging", "PACKAGING", "pcs"],
  ])(
    "extracts actual %s fixture text and PDF with source references",
    async (name, category, unit) => {
      for (const extension of ["txt", "pdf"]) {
        const bytes = await readFile(`fixtures/${name}-invoice.${extension}`);
        const document = await parseDocument(
          bytes,
          `${name}-invoice.${extension}`,
          extension === "pdf" ? "application/pdf" : "text/plain",
        );
        const extracted = extractDeterministic([
          {
            id: `fixture-${name}`,
            text: document.text,
            pages: 1,
            status: "PARSED",
          },
        ]);
        expect(extracted.goodsCategory.value).toBe(category);
        expect(extracted.goodsDescription.documentId).toBe(`fixture-${name}`);
        expect(extracted.quantityUnit.value).toBe(unit);
        expect(extracted.acceptedOutstandingAmount.value).toBe("100000000");
        expect(extracted.goodsDescription.line).toBeGreaterThan(0);
      }
    },
  );
});
