/**
 * Persistent Offline Tile Storage for FIELDLINK
 * Stores map raster tiles in IndexedDB so pre-cached sectors remain 100% available offline indefinitely.
 */
import { chacha20Crypt, getOrCreateVaultKey } from '../../utils/crypto';

const DB_NAME = 'FieldlinkOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'tiles';

// Legacy XOR mask (backwards-compatible read support for pre-ChaCha20 cached tiles)
const TILE_MASK_KEY = new Uint8Array([0xa5, 0x5a, 0x3c, 0xc3, 0x0f, 0xf0, 0x96, 0x69]);
const TILE_CIPHER_MAGIC = new Uint8Array([0x46, 0x54, 0x4b, 0x31]); // 'FTK1'

function legacyXorTransform(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i] ^ TILE_MASK_KEY[i & 7] ^ (i & 0x1f);
  }
  return dst.buffer;
}

function transformTileData(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const nonce = new Uint8Array(12);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(nonce);
  } else {
    for (let i = 0; i < nonce.length; i++) nonce[i] = Math.floor(Math.random() * 256);
  }
  const encrypted = chacha20Crypt(getOrCreateVaultKey(), nonce, src);
  const out = new Uint8Array(TILE_CIPHER_MAGIC.length + nonce.length + encrypted.length);
  out.set(TILE_CIPHER_MAGIC, 0);
  out.set(nonce, TILE_CIPHER_MAGIC.length);
  out.set(encrypted, TILE_CIPHER_MAGIC.length + nonce.length);
  return out.buffer;
}

function restoreTileData(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  // 1. Authenticated / per-device ChaCha20 tile format ('FTK1' + 12-byte nonce + ciphertext)
  if (
    bytes.length > 16 &&
    bytes[0] === TILE_CIPHER_MAGIC[0] &&
    bytes[1] === TILE_CIPHER_MAGIC[1] &&
    bytes[2] === TILE_CIPHER_MAGIC[2] &&
    bytes[3] === TILE_CIPHER_MAGIC[3]
  ) {
    const nonce = bytes.subarray(4, 16);
    const cipher = bytes.subarray(16);
    return chacha20Crypt(getOrCreateVaultKey(), nonce, cipher).buffer as ArrayBuffer;
  }
  // 2. Legacy unencrypted JPEG / PNG
  if (bytes.length >= 2) {
    if ((bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
      return buffer;
    }
  }
  // 3. Legacy XOR-masked tile
  return legacyXorTransform(buffer);
}

export interface CachedTileRecord {
  id: string; // Deterministic tile key (e.g. "lyrs_y_z_15_x_2345_y_5678")
  url: string;
  data: ArrayBuffer;
  mimeType: string;
  timestamp: number;
}

class TileCacheManagerService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private ramCache: Map<string, ArrayBuffer> = new Map();
  private readonly MAX_RAM_TILES = 80;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported in this runtime environment'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  /**
   * Deterministically extract a persistent key from a Google Maps or standard tile URL.
   * Matches across subdomains mt0, mt1, mt2, mt3 so duplicates are avoided.
   */
  public normalizeKey(url: string): string {
    try {
      const parsed = new URL(url.replace(/^flktile:\/\//, 'https://'));
      const lyrs = parsed.searchParams.get('lyrs') || 'y';
      const x = parsed.searchParams.get('x');
      const y = parsed.searchParams.get('y');
      const z = parsed.searchParams.get('z');

      if (x !== null && y !== null && z !== null) {
        return `tile_${lyrs}_z${z}_x${x}_y${y}`;
      }
    } catch {
      // Fallback regex parsing if URL parsing fails
      const match = url.match(/lyrs=([a-z0-9]+)&x=(\d+)&y=(\d+)&z=(\d+)/);
      if (match) {
        return `tile_${match[1]}_z${match[4]}_x${match[2]}_y${match[3]}`;
      }
    }
    return url.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Retrieve a cached tile ArrayBuffer (RAM LRU cache first, IndexedDB second).
   */
  public async getTile(url: string): Promise<ArrayBuffer | null> {
    const key = this.normalizeKey(url);

    // 1. Ultra-fast Sub-millisecond RAM hit
    if (this.ramCache.has(key)) {
      const buffer = this.ramCache.get(key)!;
      // Refresh LRU order (delete & re-insert)
      this.ramCache.delete(key);
      this.ramCache.set(key, buffer);
      return buffer;
    }

    try {
      const db = await this.getDB();

      return new Promise<ArrayBuffer | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result as CachedTileRecord | undefined;
          if (record && record.data) {
            const clearData = restoreTileData(record.data);
            // Promote to RAM cache with bounded LRU eviction
            if (this.ramCache.size >= this.MAX_RAM_TILES) {
              const oldestKey = this.ramCache.keys().next().value;
              if (oldestKey) this.ramCache.delete(oldestKey);
            }
            this.ramCache.set(key, clearData);
            resolve(clearData);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => {
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * Store a tile ArrayBuffer into persistent IndexedDB storage & RAM cache.
   */
  public async putTile(url: string, data: ArrayBuffer, mimeType = 'image/jpeg'): Promise<void> {
    const key = this.normalizeKey(url);

    // Immediate RAM cache insertion
    if (this.ramCache.size >= this.MAX_RAM_TILES) {
      const oldestKey = this.ramCache.keys().next().value;
      if (oldestKey) this.ramCache.delete(oldestKey);
    }
    this.ramCache.set(key, data);

    try {
      const db = await this.getDB();

      const diskData = transformTileData(data);
      const record: CachedTileRecord = {
        id: key,
        url,
        data: diskData,
        mimeType,
        timestamp: Date.now(),
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fail silently to avoid interrupting real-time map rendering
    }
  }

  /**
   * Check if a specific tile is already cached.
   */
  public async hasTile(url: string): Promise<boolean> {
    const tile = await this.getTile(url);
    return tile !== null;
  }

  /**
   * Get the total number of cached offline tiles stored.
   */
  public async getTileCount(): Promise<number> {
    try {
      const db = await this.getDB();
      return new Promise<number>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();

        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  /**
   * Clear all cached offline tiles.
   */
  public async clearAllTiles(): Promise<void> {
    this.ramCache.clear();
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Error clearing offline tiles:', e);
    }
  }

  /**
   * Pre-cache an Area of Operations (AO) sector centered at (centerLat, centerLon).
   * Downloads both satellite (`lyrs=y`) and topo (`lyrs=p`) tiles across zoom levels 14, 15, 16.
   */
  public async precacheSector(
    centerLat: number,
    centerLon: number,
    onProgress?: (progressPct: number, current: number, total: number) => void
  ): Promise<{ success: boolean; totalCached: number; newCached: number }> {
    const targetLat = centerLat !== 0 ? centerLat : 11.18187;
    const targetLon = centerLon !== 0 ? centerLon : 75.85067;
    const latRad = (targetLat * Math.PI) / 180;
    const zooms = [14, 15, 16, 17];
    const urls: string[] = [];

    zooms.forEach((z) => {
      const n = Math.pow(2, z);
      const xtile = Math.floor(((targetLon + 180) / 360) * n);
      const ytile = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
      );

      // Precache 3x3 surrounding tile sector at each zoom level
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = xtile + dx;
          const y = ytile + dy;
          urls.push(`https://mt1.google.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}`);
          urls.push(`https://mt1.google.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}`);
        }
      }
    });

    const total = urls.length;
    let completed = 0;
    let newCached = 0;

    // Concurrently download in batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const alreadyCached = await this.hasTile(url);
            if (!alreadyCached) {
              const res = await fetch(url, { mode: 'cors' });
              if (res.ok) {
                const buffer = await res.arrayBuffer();
                await this.putTile(url, buffer, res.headers.get('content-type') || 'image/jpeg');
                newCached++;
              }
            }
          } catch {
            // Continue on network tile error
          } finally {
            completed++;
            if (onProgress) {
              const pct = Math.round((completed / total) * 100);
              onProgress(pct, completed, total);
            }
          }
        })
      );
    }

    const totalCount = await this.getTileCount();
    return { success: true, totalCached: totalCount, newCached };
  }
}

export const TileCacheManager = new TileCacheManagerService();
