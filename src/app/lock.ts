// Not kilidi: PIN'in PBKDF2 özeti saklanır (PIN'in kendisi değil). Veri şifrelenmez; amaç paylaşılan
// bilgisayarda dosyanın ve önizlemesinin kolayca açılmasını engellemek.

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 150_000 }, key, 256);
  return b64(bits);
}

export async function makeLock(pin: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await derive(pin, salt) };
}

export async function checkLock(lock: { salt: string; hash: string }, pin: string): Promise<boolean> {
  return (await derive(pin, unb64(lock.salt))) === lock.hash;
}
