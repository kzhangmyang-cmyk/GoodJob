const ISO_4217_TWO_DECIMAL_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG",
  "AZN", "BAM", "BBD", "BDT", "BGN", "BIF", "BMD", "BND", "BOB",
  "BOV", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF",
  "CHE", "CHF", "CHW", "CNY", "COP", "COU", "CRC", "CUP", "CVE",
  "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR",
  "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ",
  "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD",
  "IRR", "ISK", "JMD", "KES", "KGS", "KHR", "KMF", "KPW", "KYD",
  "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL",
  "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK",
  "MXN", "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR",
  "NZD", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
  "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK",
  "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP",
  "SZL", "THB", "TJS", "TMT", "TOP", "TRY", "TTD", "TWD", "TZS",
  "UAH", "UGX", "USD", "USN", "UYI", "UYU", "UZS", "VED", "VES",
  "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR",
  "ZMW", "ZWG"
] as const;

const exponents: Record<string, number> = Object.fromEntries(
  ISO_4217_TWO_DECIMAL_CODES.map((currency) => [currency, 2])
);
for (const currency of [
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"
]) exponents[currency] = 0;
for (const currency of ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"])
  exponents[currency] = 3;
for (const currency of ["CLF", "UYW"]) exponents[currency] = 4;
/** A frozen ISO 4217 currency exponent registry used by all Growth arithmetic. */
export const ISO_4217_EXPONENT_V1: Readonly<Record<string, number>> =
  Object.freeze(exponents);

export function currencyExponent(currency: string): number | null {
  return Object.hasOwn(ISO_4217_EXPONENT_V1, currency)
    ? ISO_4217_EXPONENT_V1[currency]!
    : null;
}

function amountRangeError(field: string): RangeError & { code: string } {
  return Object.assign(new RangeError(field), { code: "amount_out_of_range" });
}

export function roundHalfUpDiv(
  numerator: bigint,
  denominator: bigint
): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("invalid ratio");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

export function roundSignedHalfUpDiv(
  numerator: bigint,
  denominator: bigint
): bigint {
  if (denominator <= 0n) throw new RangeError("invalid ratio");
  return numerator < 0n
    ? -roundHalfUpDiv(-numerator, denominator)
    : roundHalfUpDiv(numerator, denominator);
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("invalid ratio");
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
}

export function safeMinor(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw amountRangeError(field);
  }
  return Number(value);
}

export function safeSignedInteger(value: bigint, field: string): number {
  const minimum = BigInt(Number.MIN_SAFE_INTEGER);
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (value < minimum || value > maximum) throw amountRangeError(field);
  return Number(value);
}

function integerBigInt(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer`);
  }
  return BigInt(value);
}

export function multiplyQuantityMinor(
  unitMinor: number,
  quantityMicros: number,
  rounding: "half_up" | "ceil"
): number {
  const numerator = integerBigInt(unitMinor, "unitMinor")
    * integerBigInt(quantityMicros, "quantityMicros");
  return safeMinor(
    rounding === "ceil"
      ? ceilDiv(numerator, 1_000_000n)
      : roundHalfUpDiv(numerator, 1_000_000n),
    "quantity amount"
  );
}
