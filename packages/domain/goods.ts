import { z } from "zod";

/** Goods describe the delivered invoice. They are not collateral or a sector risk score. */
export const GoodsSchema = z
  .object({
    category: z.enum(["COCOA", "PACKAGING", "OTHER"]),
    description: z.string().trim().min(1).max(500),
    lineItems: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(500),
            quantity: z
              .string()
              .regex(/^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/)
              .refine(
                (value) => /[1-9]/.test(value),
                "Quantity must be positive",
              ),
            unit: z.string().trim().min(1).max(32),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type GoodsMetadata = z.infer<typeof GoodsSchema>;
export type GoodsCategory = GoodsMetadata["category"];

export function goodsPolicyReasons(
  assetType: string | undefined,
  goods: unknown,
): string[] {
  if (assetType !== "TRADE_RECEIVABLE") return ["TRADE_RECEIVABLE_REQUIRED"];
  const parsed = GoodsSchema.safeParse(goods);
  if (!parsed.success) return ["GOODS_DETAILS_REQUIRED"];
  // Category describes delivered goods; eligibility depends on evidence and
  // the fixed trade receivable, not on a sector allowlist.
  return [];
}
