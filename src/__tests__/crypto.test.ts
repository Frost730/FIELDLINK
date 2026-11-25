import { describe, it, expect } from 'vitest';
import { chacha20Crypt, encryptVaultData, decryptVaultData } from '../utils/crypto';

describe('Tactical Data-at-Rest Cryptography (RFC 8439 ChaCha20)', () => {
  it('encrypts and decrypts arbitrary strings with perfect fidelity', () => {
    const secret = JSON.stringify({
      callsign: 'OPERATOR-301',
      waypoints: [
        { id: 'wp-1', name: 'RALLY ALPHA', lat: 11.1818, lon: 75.8506 },
        { id: 'wp-2', name: 'LZ BRAVO', lat: 11.192, lon: 75.861 },
      ],
      missionPlan: 'SURVEILLANCE & RECON SECTOR 4',
    });

    const encrypted = encryptVaultData(secret);
    expect(encrypted.startsWith('FLK_V3_')).toBe(true);
    expect(encrypted).not.toContain('OPERATOR-301');
    expect(encrypted).not.toContain('RALLY ALPHA');

    const decrypted = decryptVaultData(encrypted);
    expect(decrypted).toBe(secret);
    const parsed = JSON.parse(decrypted);
    expect(parsed.callsign).toBe('OPERATOR-301');
    expect(parsed.waypoints.length).toBe(2);
  });

  it('rejects tampered FLK_V3_ vault payloads via MAC verification', () => {
    const encrypted = encryptVaultData('CLASSIFIED_FIELD_DATA');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    // Must not silently decode corrupted plaintext
    expect(decryptVaultData(tampered)).toBe(tampered);
  });

  it('produces distinct ciphertexts for identical plaintexts (unique nonces)', () => {
    const text = 'RECON_COORDINATES_CONFIDENTIAL';
    const enc1 = encryptVaultData(text);
    const enc2 = encryptVaultData(text);

    expect(enc1).not.toBe(enc2); // Due to 96-bit random nonce
    expect(decryptVaultData(enc1)).toBe(text);
    expect(decryptVaultData(enc2)).toBe(text);
  });

  it('maintains backwards-compatibility with legacy FLK_ENC_ XOR data', () => {
    const legacyPlaintext = '{"callsign":"LEGACY-OPERATOR"}';
    const key = 0x5a;
    const utf8Bytes = new TextEncoder().encode(legacyPlaintext);
    const masked = new Uint8Array(utf8Bytes.length);
    for (let i = 0; i < utf8Bytes.length; i++) {
      masked[i] = utf8Bytes[i] ^ (key ^ (i & 0xff));
    }
    const legacyCiphertext = 'FLK_ENC_' + btoa(String.fromCharCode(...masked));

    const migrated = decryptVaultData(legacyCiphertext);
    expect(migrated).toBe(legacyPlaintext);
  });

  it('handles empty or raw unencrypted plaintext gracefully', () => {
    expect(decryptVaultData('')).toBe('');
    expect(decryptVaultData('{"raw":"json"}')).toBe('{"raw":"json"}');
  });

  it('verifies ChaCha20 bit-level keystream symmetry', () => {
    const key = new Uint8Array(32).fill(0x42);
    const nonce = new Uint8Array(12).fill(0x07);
    const data = new TextEncoder().encode('SITREP_HIGH_PRIORITY_CLASSIFIED');

    const cipher = chacha20Crypt(key, nonce, data);
    expect(cipher).not.toEqual(data);

    const recovered = chacha20Crypt(key, nonce, cipher);
    expect(recovered).toEqual(data);
  });
});
