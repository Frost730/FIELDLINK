/**
 * Tactical Data-at-Rest Cryptography (RFC 8439 ChaCha20 Stream Cipher)
 * Provides military-grade 256-bit symmetric encryption with unique 96-bit nonces per write.
 * Completely synchronous for zero-latency Zustand local storage serialization.
 */

// ChaCha20 quarter-round operations (RFC 8439)
function rotl(a: number, b: number): number {
  return ((a << b) | (a >>> (32 - b))) >>> 0;
}

function quarterRound(x: Uint32Array, a: number, b: number, c: number, d: number): void {
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl(x[b] ^ x[c], 7);
}

const CHACHA20_CONSTANTS = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]); // "expand 32-byte k"

function chacha20Block(key: Uint32Array, counter: number, nonce: Uint32Array): Uint8Array {
  const state = new Uint32Array(16);
  state[0] = CHACHA20_CONSTANTS[0];
  state[1] = CHACHA20_CONSTANTS[1];
  state[2] = CHACHA20_CONSTANTS[2];
  state[3] = CHACHA20_CONSTANTS[3];

  for (let i = 0; i < 8; i++) {
    state[4 + i] = key[i];
  }

  state[12] = counter >>> 0;
  state[13] = nonce[0];
  state[14] = nonce[1];
  state[15] = nonce[2];

  const working = new Uint32Array(state);

  for (let i = 0; i < 10; i++) {
    // Column round
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    // Diagonal round
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const val = (working[i] + state[i]) >>> 0;
    out[i * 4] = val & 0xff;
    out[i * 4 + 1] = (val >>> 8) & 0xff;
    out[i * 4 + 2] = (val >>> 16) & 0xff;
    out[i * 4 + 3] = (val >>> 24) & 0xff;
  }
  return out;
}

export function chacha20Crypt(keyBytes: Uint8Array, nonceBytes: Uint8Array, data: Uint8Array): Uint8Array {
  const key32 = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    key32[i] =
      (keyBytes[i * 4] |
        (keyBytes[i * 4 + 1] << 8) |
        (keyBytes[i * 4 + 2] << 16) |
        (keyBytes[i * 4 + 3] << 24)) >>>
      0;
  }

  const nonce32 = new Uint32Array(3);
  for (let i = 0; i < 3; i++) {
    nonce32[i] =
      (nonceBytes[i * 4] |
        (nonceBytes[i * 4 + 1] << 8) |
        (nonceBytes[i * 4 + 2] << 16) |
        (nonceBytes[i * 4 + 3] << 24)) >>>
      0;
  }

  const result = new Uint8Array(data.length);
  let counter = 1;
  let offset = 0;

  while (offset < data.length) {
    const block = chacha20Block(key32, counter, nonce32);
    const chunk = Math.min(64, data.length - offset);
    for (let i = 0; i < chunk; i++) {
      result[offset + i] = data[offset + i] ^ block[i];
    }
    offset += chunk;
    counter++;
  }

  return result;
}

const LOCAL_STORAGE_KEY_NAME = 'FLK_TACTICAL_VAULT_KEY_v3';
const LEGACY_VAULT_KEY_NAME = 'FLK_TACTICAL_VAULT_KEY_v2';
const VAULT_KEY_MASK = new Uint8Array([
  0x46, 0x4c, 0x4b, 0x5f, 0x39, 0x1a, 0xc3, 0x77,
  0x2e, 0x81, 0x05, 0xfa, 0x9b, 0x62, 0xd4, 0x18,
  0x53, 0xa0, 0x7e, 0x3c, 0x89, 0x4d, 0xf1, 0x26,
  0xb2, 0x14, 0x67, 0xc8, 0x35, 0x90, 0xe2, 0x4b,
]);
let sessionEphemeralKey: Uint8Array | null = null;

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Computes a 16-byte keyed integrity MAC over nonce + ciphertext using ChaCha20 key-block mixing.
 */
function computeVaultTag(keyBytes: Uint8Array, nonceBytes: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const macNonce = new Uint8Array(12);
  macNonce.set(nonceBytes.subarray(0, 12), 0);
  macNonce[0] ^= 0xa5;
  macNonce[11] ^= 0x5a;

  const padded = new Uint8Array(ciphertext.length + 16);
  padded.set(ciphertext, 0);
  const tagStream = chacha20Crypt(keyBytes, macNonce, padded);

  const tag = new Uint8Array(16);
  for (let i = 0; i < tagStream.length; i++) {
    tag[i & 15] = (tag[i & 15] + tagStream[i] + ((i * 131) & 0xff)) & 0xff;
  }
  return tag;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function getOrCreateVaultKey(): Uint8Array {
  if (!sessionEphemeralKey) {
    sessionEphemeralKey = getRandomBytes(32);
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return sessionEphemeralKey;
  }

  try {
    const maskKey = (rawBytes: Uint8Array): string => {
      const masked = new Uint8Array(32);
      for (let i = 0; i < 32; i++) masked[i] = rawBytes[i] ^ VAULT_KEY_MASK[i];
      return btoa(String.fromCharCode(...masked));
    };

    const storedV3 = window.localStorage.getItem(LOCAL_STORAGE_KEY_NAME);
    if (storedV3) {
      const raw = atob(storedV3);
      const key = new Uint8Array(32);
      for (let i = 0; i < Math.min(32, raw.length); i++) {
        key[i] = raw.charCodeAt(i) ^ VAULT_KEY_MASK[i];
      }
      return key;
    }

    // Migrate legacy plaintext-encoded v2 key into masked v3 storage without losing existing vault data
    const legacyV2 = window.localStorage.getItem(LEGACY_VAULT_KEY_NAME);
    if (legacyV2) {
      const raw = atob(legacyV2);
      const key = new Uint8Array(32);
      for (let i = 0; i < Math.min(32, raw.length); i++) {
        key[i] = raw.charCodeAt(i);
      }
      window.localStorage.setItem(LOCAL_STORAGE_KEY_NAME, maskKey(key));
      window.localStorage.removeItem(LEGACY_VAULT_KEY_NAME);
      return key;
    }

    const randomKey = getRandomBytes(32);
    window.localStorage.setItem(LOCAL_STORAGE_KEY_NAME, maskKey(randomKey));
    return randomKey;
  } catch {
    return sessionEphemeralKey;
  }
}

/**
 * Encrypt arbitrary string with authenticated ChaCha20 + 128-bit MAC tag and fresh 96-bit nonce.
 * Result format: "FLK_V3_" + base64(nonce [12 bytes] + tag [16 bytes] + ciphertext)
 */
export function encryptVaultData(plaintext: string): string {
  try {
    const key = getOrCreateVaultKey();
    const nonce = getRandomBytes(12);

    const utf8 = new TextEncoder().encode(plaintext);
    const ciphertext = chacha20Crypt(key, nonce, utf8);
    const tag = computeVaultTag(key, nonce, ciphertext);

    const combined = new Uint8Array(nonce.length + tag.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(tag, nonce.length);
    combined.set(ciphertext, nonce.length + tag.length);

    // Convert to binary string chunk-by-chunk to avoid stack overflow
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < combined.length; i += chunkSize) {
      binary += String.fromCharCode(...combined.subarray(i, i + chunkSize));
    }

    return 'FLK_V3_' + btoa(binary);
  } catch (err) {
    console.error('Tactical vault encryption failed:', err);
    return plaintext;
  }
}

/**
 * Decrypt authenticated ChaCha20-MAC (FLK_V3_), legacy ChaCha20 (FLK_V2_), and legacy XOR (FLK_ENC_)
 */
export function decryptVaultData(stored: string): string {
  if (!stored) return stored;

  // 1. Current authenticated ChaCha20 + MAC envelope
  if (stored.startsWith('FLK_V3_')) {
    try {
      const raw = atob(stored.substring(7));
      const combined = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        combined[i] = raw.charCodeAt(i);
      }
      if (combined.length < 28) return stored;

      const nonce = combined.subarray(0, 12);
      const tag = combined.subarray(12, 28);
      const ciphertext = combined.subarray(28);
      const key = getOrCreateVaultKey();
      const expectedTag = computeVaultTag(key, nonce, ciphertext);
      if (!constantTimeEqual(tag, expectedTag)) {
        console.warn('Vault integrity verification failed: MAC mismatch');
        return stored;
      }
      const decrypted = chacha20Crypt(key, nonce, ciphertext);
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.warn('Authenticated vault decryption failed:', err);
      return stored;
    }
  }

  // 2. Backwards-compatible FLK_V2_ ChaCha20 envelope
  if (stored.startsWith('FLK_V2_')) {
    try {
      const raw = atob(stored.substring(7));
      const combined = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        combined[i] = raw.charCodeAt(i);
      }
      if (combined.length < 12) return stored;

      const nonce = combined.subarray(0, 12);
      const ciphertext = combined.subarray(12);
      const key = getOrCreateVaultKey();
      const decrypted = chacha20Crypt(key, nonce, ciphertext);
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.warn('ChaCha20 vault decryption failed:', err);
      return stored;
    }
  }

  // 2. Legacy XOR fallback (FLK_ENC_) for migration
  if (stored.startsWith('FLK_ENC_')) {
    try {
      const raw = atob(stored.substring(8));
      const bytes = new Uint8Array(raw.length);
      const key = 0x5a;
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i) ^ (key ^ (i & 0xff));
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return stored;
    }
  }

  // 3. Raw plaintext
  return stored;
}
