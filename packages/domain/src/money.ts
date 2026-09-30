function groupThousands(value: number): string {
  const digits = String(value);
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    const reverseIndex = digits.length - index;
    grouped += digits[index];
    if (reverseIndex > 1 && reverseIndex % 3 === 1) {
      grouped += ".";
    }
  }
  return grouped;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const frac = abs % 100;
  const majorText = groupThousands(major);
  const body = frac === 0 ? majorText : `${majorText},${String(frac).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${body} ${currency}`;
}

export function assertPositiveMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }
}
