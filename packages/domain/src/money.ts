export function formatMoney(amountMinor: number, currency: string): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const frac = abs % 100;
  const majorText = new Intl.NumberFormat("sr-RS", {
    maximumFractionDigits: 0,
  }).format(major);
  const body = frac === 0 ? majorText : `${majorText},${String(frac).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${body} ${currency}`;
}

export function assertPositiveMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }
}
