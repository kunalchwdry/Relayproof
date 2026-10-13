import { generateSigningKeyPair, getKeyId } from './credential.js';

const RECORDS_KEY = 'relayproof.records.v1';
const TRUSTED_KEYS_KEY = 'relayproof.trusted-keys.v1';
const IDENTITY_META_KEY = 'relayproof.identity-meta.v1';
const DB_NAME = 'relayproof-key-vault';
const DB_VERSION = 1;
const KEY_STORE = 'signing-keys';

let dbPromise;
let memoryKey = null;

function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function loadRecords() {
  try {
    const value = browserStorage()?.getItem(RECORDS_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecords(records) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function loadTrustedKeys() {
  try {
    const value = browserStorage()?.getItem(TRUSTED_KEYS_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTrustedKeys(keys) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(TRUSTED_KEYS_KEY, JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}

export function loadIdentityMetadata() {
  try {
    const value = browserStorage()?.getItem(IDENTITY_META_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveIdentityMetadata(metadata) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(IDENTITY_META_KEY, JSON.stringify(metadata));
    return true;
  } catch {
    return false;
  }
}

function openVault() {
  if (dbPromise) return dbPromise;
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the local signing-key vault.'));
    request.onblocked = () => reject(new Error('The local signing-key vault is blocked by another browser tab.'));
  }).catch(error => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function readPrivateKey(keyId) {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEY_STORE, 'readonly');
    const request = transaction.objectStore(KEY_STORE).get(keyId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read the local signing key.'));
  });
}

async function writePrivateKey(keyId, privateKey) {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEY_STORE, 'readwrite');
    transaction.objectStore(KEY_STORE).put(privateKey, keyId);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('Could not store the local signing key.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local signing-key storage was aborted.'));
  });
}

export async function getOrCreateIdentity() {
  const metadata = loadIdentityMetadata();
  if (metadata?.keyId && metadata?.publicJwk) {
    if (memoryKey?.keyId === metadata.keyId) return { ...memoryKey, persisted: false };
    try {
      const privateKey = await readPrivateKey(metadata.keyId);
      if (privateKey) {
        return {
          privateKey,
          publicJwk: metadata.publicJwk,
          keyId: metadata.keyId,
          createdAt: metadata.createdAt,
          persisted: true,
        };
      }
    } catch {
      // Browser storage may be disabled. Fall through to an in-memory key and surface that fact.
    }
  }

  const pair = await generateSigningKeyPair();
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const keyId = await getKeyId(publicJwk);
  const createdAt = new Date().toISOString();
  let persisted = false;
  try {
    await writePrivateKey(keyId, pair.privateKey);
    persisted = saveIdentityMetadata({ publicJwk, keyId, createdAt });
    if (persisted) memoryKey = null;
    else memoryKey = { privateKey: pair.privateKey, publicJwk, keyId, createdAt };
  } catch {
    memoryKey = { privateKey: pair.privateKey, publicJwk, keyId, createdAt };
  }
  return { privateKey: pair.privateKey, publicJwk, keyId, createdAt, persisted };
}

export function pinTrustedKey(keyId, issuerName = '') {
  const keys = loadTrustedKeys();
  if (keys.some(item => item.keyId === keyId)) return { keys, saved: true };
  const next = [{ keyId, issuerName, pinnedAt: new Date().toISOString() }, ...keys];
  return { keys: next, saved: saveTrustedKeys(next) };
}

export function isKeyTrusted(keys, keyId) {
  return Boolean(keyId && keys.some(item => item.keyId === keyId));
}
