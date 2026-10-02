const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Identifikator jednog slanja unosa sa ponavljanjem.
 *
 * Telefon nema `crypto.randomUUID` (Hermes ga ne daje), a bez identifikatora
 * baza odbija `create_entry_with_rule`. Običan unos taj poziv ne koristi,
 * zato radi i kad je ponavljanje ugašeno.
 */
export function newRequestId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const sixth = bytes[6] ?? 0;
  const eighth = bytes[8] ?? 0;
  bytes[6] = (sixth & 0x0f) | 0x40;
  bytes[8] = (eighth & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function isRequestId(value: string): boolean {
  return UUID_V4.test(value);
}
