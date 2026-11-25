import { forward } from 'mgrs';

export interface TacticalCoordinates {
  mgrs: string;
  lat: number;
  lon: number;
  decimalStr: string;
  dmsStr: string;
  altitudeM: number;
  altitudeFt: number;
  accuracyM: number;
  headingDeg: number;
  headingMils: number;
  speedKmh: number;
  timestamp: string;
}

export function formatDMS(deg: number, isLat: boolean): string {
  const absolute = Math.abs(deg);
  const d = Math.floor(absolute);
  const minutesNotTruncated = (absolute - d) * 60;
  const m = Math.floor(minutesNotTruncated);
  const s = Math.floor((minutesNotTruncated - m) * 60);

  let direction = '';
  if (isLat) {
    direction = deg >= 0 ? 'N' : 'S';
  } else {
    direction = deg >= 0 ? 'E' : 'W';
  }

  return `${d}° ${m.toString().padStart(2, '0')}' ${s.toString().padStart(2, '0')}" ${direction}`;
}

export function toMils(degrees: number): number {
  const norm = ((degrees % 360) + 360) % 360;
  return Math.round((norm / 360) * 6400);
}

export function getMGRS(lat: number, lon: number): string {
  try {
    const raw = forward([lon, lat], 5); // 1-meter precision (10-digit grid)
    // raw is like "17SPU6499090173" -> format to "17S PU 64990 90173"
    const match = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/);
    if (match) {
      return `${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
    }
    return raw;
  } catch {
    return 'GRID UNKNOWN';
  }
}

export function getMGRSShort(lat: number, lon: number, digits: 4 | 6 | 8 | 10 = 8): string {
  try {
    const raw = forward([lon, lat], 5);
    const match = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/);
    if (!match) return raw;
    const gzd = match[1];
    const sq = match[2];
    const e = match[3];
    const n = match[4];
    if (digits === 4) {
      return `${sq} ${e.substring(0, 2)} ${n.substring(0, 2)}`;
    }
    if (digits === 6) {
      return `${sq} ${e.substring(0, 3)} ${n.substring(0, 3)}`;
    }
    if (digits === 8) {
      return `${gzd} ${sq} ${e.substring(0, 4)} ${n.substring(0, 4)}`;
    }
    return `${gzd} ${sq} ${e} ${n}`;
  } catch {
    return 'GRID UNKNOWN';
  }
}

export function formatCoordinateString(lat: number, lon: number, format: 'MGRS' | 'DMS' | 'DECIMAL' = 'MGRS'): string {
  if (lat === 0 && lon === 0) return 'NO FIX';
  switch (format) {
    case 'MGRS':
      return getMGRS(lat, lon);
    case 'DMS':
      return `${formatDMS(lat, true)}  ${formatDMS(lon, false)}`;
    case 'DECIMAL':
      return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
    default:
      return getMGRS(lat, lon);
  }
}

export function formatCoordinateShort(lat: number, lon: number, format: 'MGRS' | 'DMS' | 'DECIMAL' = 'MGRS'): string {
  if (lat === 0 && lon === 0) return 'NO FIX';
  switch (format) {
    case 'MGRS':
      return getMGRSShort(lat, lon, 8);
    case 'DMS': {
      const latAbs = Math.abs(lat);
      const lonAbs = Math.abs(lon);
      const dLat = Math.floor(latAbs);
      const mLat = Math.floor((latAbs - dLat) * 60);
      const dLon = Math.floor(lonAbs);
      const mLon = Math.floor((lonAbs - dLon) * 60);
      return `${dLat}°${mLat.toString().padStart(2, '0')}'${lat >= 0 ? 'N' : 'S'} ${dLon}°${mLon.toString().padStart(2, '0')}'${lon >= 0 ? 'E' : 'W'}`;
    }
    case 'DECIMAL':
      return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    default:
      return getMGRSShort(lat, lon, 8);
  }
}

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180));
  const x =
    Math.cos(lat1 * (Math.PI / 180)) * Math.sin(lat2 * (Math.PI / 180)) -
    Math.sin(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.cos((lon2 - lon1) * (Math.PI / 180));
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

/**
 * Unwraps target angle relative to previous cumulative angle so CSS transitions
 * always take the shortest path around the circle and never violently spin 360° across 0°/North.
 */
export function getShortestRotation(prevCumulative: number, targetDeg: number): number {
  const target = ((targetDeg % 360) + 360) % 360;
  const currentMod = ((prevCumulative % 360) + 360) % 360;
  let diff = target - currentMod;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return prevCumulative + diff;
}

export interface TacticalUserColor {
  hex: string;
  borderHex: string;
  bgHex: string;
  glow: string;
  textClass: string;
  badgeBg: string;
  badgeBorder: string;
  name: string;
}

export const TACTICAL_COLOR_PALETTE: TacticalUserColor[] = [
  {
    hex: '#F59E0B', // Amber Gold
    borderHex: '#FBBF24',
    bgHex: 'rgba(245, 158, 11, 0.25)',
    glow: '0 0 10px rgba(245, 158, 11, 0.65)',
    textClass: 'text-amber-300',
    badgeBg: 'bg-amber-950/85',
    badgeBorder: 'border-amber-500/80',
    name: 'AMBER',
  },
  {
    hex: '#06B6D4', // Cyan Teal
    borderHex: '#22D3EE',
    bgHex: 'rgba(6, 182, 212, 0.25)',
    glow: '0 0 10px rgba(6, 182, 212, 0.65)',
    textClass: 'text-cyan-300',
    badgeBg: 'bg-cyan-950/85',
    badgeBorder: 'border-cyan-500/80',
    name: 'CYAN',
  },
  {
    hex: '#10B981', // Emerald Green
    borderHex: '#34D399',
    bgHex: 'rgba(16, 185, 129, 0.25)',
    glow: '0 0 10px rgba(16, 185, 129, 0.65)',
    textClass: 'text-emerald-300',
    badgeBg: 'bg-emerald-950/85',
    badgeBorder: 'border-emerald-500/80',
    name: 'EMERALD',
  },
  {
    hex: '#A855F7', // Electric Violet / Purple
    borderHex: '#C084FC',
    bgHex: 'rgba(168, 85, 247, 0.25)',
    glow: '0 0 10px rgba(168, 85, 247, 0.65)',
    textClass: 'text-purple-300',
    badgeBg: 'bg-purple-950/85',
    badgeBorder: 'border-purple-500/80',
    name: 'PURPLE',
  },
  {
    hex: '#F97316', // Tactical Orange
    borderHex: '#FB923C',
    bgHex: 'rgba(249, 115, 22, 0.25)',
    glow: '0 0 10px rgba(249, 115, 22, 0.65)',
    textClass: 'text-orange-300',
    badgeBg: 'bg-orange-950/85',
    badgeBorder: 'border-orange-500/80',
    name: 'ORANGE',
  },
  {
    hex: '#EC4899', // Tactical Magenta / Pink
    borderHex: '#F472B6',
    bgHex: 'rgba(236, 72, 153, 0.25)',
    glow: '0 0 10px rgba(236, 72, 153, 0.65)',
    textClass: 'text-pink-300',
    badgeBg: 'bg-pink-950/85',
    badgeBorder: 'border-pink-500/80',
    name: 'MAGENTA',
  },
  {
    hex: '#84CC16', // Tactical Lime
    borderHex: '#A3E635',
    bgHex: 'rgba(132, 204, 22, 0.25)',
    glow: '0 0 10px rgba(132, 204, 22, 0.65)',
    textClass: 'text-lime-300',
    badgeBg: 'bg-lime-950/85',
    badgeBorder: 'border-lime-500/80',
    name: 'LIME',
  },
  {
    hex: '#38BDF8', // Sky Blue
    borderHex: '#7DD3FC',
    bgHex: 'rgba(56, 189, 248, 0.25)',
    glow: '0 0 10px rgba(56, 189, 248, 0.65)',
    textClass: 'text-sky-300',
    badgeBg: 'bg-sky-950/85',
    badgeBorder: 'border-sky-500/80',
    name: 'SKY',
  },
  {
    hex: '#F43F5E', // Tactical Rose / Coral
    borderHex: '#FB7185',
    bgHex: 'rgba(244, 63, 94, 0.25)',
    glow: '0 0 10px rgba(244, 63, 94, 0.65)',
    textClass: 'text-rose-300',
    badgeBg: 'bg-rose-950/85',
    badgeBorder: 'border-rose-500/80',
    name: 'ROSE',
  },
  {
    hex: '#EAB308', // High-Vis Yellow
    borderHex: '#FACC15',
    bgHex: 'rgba(234, 179, 8, 0.25)',
    glow: '0 0 10px rgba(234, 179, 8, 0.65)',
    textClass: 'text-yellow-300',
    badgeBg: 'bg-yellow-950/85',
    badgeBorder: 'border-yellow-500/80',
    name: 'YELLOW',
  },
];

/**
 * Deterministically assigns a unique, vibrant tactical color to a callsign or device ID
 * across a peer-to-peer cluster.
 */
export function getCallsignColor(callsign?: string | null): TacticalUserColor {
  if (!callsign || !callsign.trim()) {
    return TACTICAL_COLOR_PALETTE[0];
  }
  const clean = callsign.trim().toUpperCase();
  // Robust DJB2 string hash for uniform distribution
  let hash = 5381;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) + hash) + clean.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % TACTICAL_COLOR_PALETTE.length;
  return TACTICAL_COLOR_PALETTE[index];
}

/**
 * Safely escapes HTML special characters to prevent DOM-based XSS when injecting strings into innerHTML
 */
export function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a GeoJSON Polygon representing a circular radius in meters around a coordinate.
 * Scales accurately with map projection and zoom for GPS & Cell uncertainty visualization.
 */
export function createGeoJsonCircle(centerLon: number, centerLat: number, radiusMeters: number, points = 48) {
  const coords: number[][] = [];
  const km = radiusMeters / 1000;
  const distanceX = km / (111.320 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = km / 110.574;
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([centerLon + x, centerLat + y]);
  }
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coords],
    },
    properties: {
      radiusMeters,
    },
  };
}

