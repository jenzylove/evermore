// The play Satchel key is kept encrypted at rest: AES-GCM under a browser key that page scripts cannot export
// (WebCrypto, non extractable, held in IndexedDB). A copy of this site's storage alone does not reveal the key.
// A plain key from an older version is sealed only after the sealed copy is proven to open, so no key is ever lost.

const DB = 'evermore-keys', STORE = 'k', ID = 'aes';
const PREFIX = 'enc1:';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function read(d: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((res, rej) => {
    const q = d.transaction(STORE).objectStore(STORE).get(ID);
    q.onsuccess = () => res(q.result as CryptoKey | undefined);
    q.onerror = () => rej(q.error);
  });
}

/** The browser key; created once. `add` never overwrites, so two tabs racing still end up sharing one key. */
async function vaultKey(create: boolean): Promise<CryptoKey | undefined> {
  const d = await db();
  let k = await read(d);
  if (!k && create) {
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((res) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).add(fresh, ID);
      t.oncomplete = () => res();
      t.onerror = (e) => { e.preventDefault(); res(); };
      t.onabort = () => res();
    });
    k = await read(d);
  }
  return k;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isSealed = (v: string | null | undefined) => !!v && v.startsWith(PREFIX);

async function seal(plain: string): Promise<string> {
  const k = await vaultKey(true);
  if (!k) throw new Error('no browser key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain)));
  return `${PREFIX}${b64(iv)}:${b64(ct)}`;
}

export async function unseal(v: string): Promise<string> {
  const [iv, ct] = v.slice(PREFIX.length).split(':');
  const k = await vaultKey(false);
  if (!k) throw new Error("This browser's key store was cleared, so the saved play key cannot be opened. Import your backed up play key to continue.");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, unb64(ct)));
}

/** Seal a plain key in storage. Keeps the plain key unless the sealed copy opens to the same key; never throws. */
export async function sealInPlace(store: { getItem(k: string): string | null; setItem(k: string, v: string): void }, key: string, plain: string) {
  try {
    if (typeof indexedDB === 'undefined' || !crypto?.subtle) return;
    const sealed = await seal(plain);
    if ((await unseal(sealed)) !== plain) return;
    store.setItem(key, sealed);
    if (store.getItem(key) !== sealed) store.setItem(key, plain);
  } catch { /* no IndexedDB or WebCrypto here: the key stays as it was */ }
}
