/** All token amounts are exact base-10 integers. MockIDR has zero decimals. */
export function amount(value: string): bigint {
  if (!/^(0|[1-9]\d{0,77})$/.test(value)) throw new Error("INVALID_AMOUNT");
  const parsed = BigInt(value);
  if (parsed > (1n << 256n) - 1n) throw new Error("AMOUNT_EXCEEDS_UINT256");
  return parsed;
}

export function ceilDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error("INVALID_DIVISION");
  return (n + d - 1n) / d;
}

/** A locale is mandatory: 1.000 means different things in id-ID and en-US. */
export function parseLocalizedDecimal(
  raw: string,
  locale: "id-ID" | "en-US",
): string {
  const text = raw.trim();
  const grammar =
    locale === "id-ID"
      ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/
      : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!grammar.test(text)) throw new Error("AMBIGUOUS_OR_INVALID_NUMBER");
  const normalized =
    locale === "id-ID"
      ? text.replaceAll(".", "").replace(",", ".")
      : text.replaceAll(",", "");
  const [whole, fraction] = normalized.split(".");
  const normalizedWhole = BigInt(whole).toString();
  return fraction ? `${normalizedWhole}.${fraction}` : normalizedWhole;
}

export function parseLocalizedMoney(
  raw: string,
  locale: "id-ID" | "en-US",
): string {
  const parsed = parseLocalizedDecimal(raw, locale);
  const [whole, fraction] = parsed.split(".");
  if (fraction && /[1-9]/.test(fraction))
    throw new Error("FRACTIONAL_MOCK_IDR_UNSUPPORTED");
  return amount(whole).toString();
}

export function quantityInKg(
  raw: string,
  unit: "kg" | "ton",
  locale: "id-ID" | "en-US",
): string {
  const value = parseLocalizedDecimal(raw, locale);
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const base =
    (BigInt(whole) * scale + BigInt(fraction || "0")) *
    (unit === "ton" ? 1000n : 1n);
  const integral = base / scale;
  const remainder = (base % scale)
    .toString()
    .padStart(fraction.length, "0")
    .replace(/0+$/, "");
  return remainder ? `${integral}.${remainder}` : integral.toString();
}

export function parseDocumentDate(
  raw: string,
  format?: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY",
): string {
  let year: number, month: number, day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && (!format || format === "YYYY-MM-DD")) {
    [year, month, day] = raw.split("-").map(Number);
  } else if (
    /^\d{2}\/\d{2}\/\d{4}$/.test(raw) &&
    format &&
    format !== "YYYY-MM-DD"
  ) {
    const [a, b, c] = raw.split("/").map(Number);
    year = c;
    month = format === "DD/MM/YYYY" ? b : a;
    day = format === "DD/MM/YYYY" ? a : b;
  } else throw new Error("AMBIGUOUS_OR_INVALID_DATE");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("INVALID_DATE");
  return date.toISOString().slice(0, 10);
}
