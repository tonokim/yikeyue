export type Currency = "CNY";

export interface Money {
  cents: number;
  currency: Currency;
}

/**
 * Converts cents (integer) to a standard Yuan display string (e.g. 990 -> "9.90").
 * Avoids floating point issues.
 */
export function centsToYuanString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error("Cents must be an integer");
  }
  const isNegative = cents < 0;
  const absoluteCents = Math.abs(cents);
  const yuan = Math.floor(absoluteCents / 100);
  const remainingCents = absoluteCents % 100;
  const centsStr = remainingCents.toString().padStart(2, "0");
  return `${isNegative ? "-" : ""}${yuan}.${centsStr}`;
}

/**
 * Converts a standard Yuan display string (e.g. "9.90" or "9.9") to cents (integer).
 * Safe from floating-point errors.
 */
export function yuanStringToCents(yuanStr: string): number {
  const trimmed = yuanStr.trim();
  const match = trimmed.match(/^(-)?\s*(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error(`Invalid money string format: "${yuanStr}"`);
  }

  const isNegative = !!match[1];
  const yuanPart = parseInt(match[2], 10);
  const centsPartStr = match[3] || "";
  const centsPart = parseInt(centsPartStr.padEnd(2, "0"), 10);

  const totalCents = yuanPart * 100 + centsPart;
  return isNegative ? -totalCents : totalCents;
}
