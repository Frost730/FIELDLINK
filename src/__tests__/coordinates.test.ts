import { describe, it, expect } from 'vitest';
import {
  formatDMS,
  toMils,
  getMGRS,
  formatCoordinateString,
  formatCoordinateShort,
  calculateDistanceKm,
  calculateBearing,
  getCallsignColor,
  escapeHtml,
} from '../utils/coordinates';

describe('Tactical Coordinates Utility', () => {
  it('converts degrees to DMS string correctly for Lat and Lon', () => {
    const latDms = formatDMS(11.181867, true);
    expect(latDms).toContain('11°');
    expect(latDms).toContain('N');

    const lonDms = formatDMS(75.850672, false);
    expect(lonDms).toContain('75°');
    expect(lonDms).toContain('E');

    const southLatDms = formatDMS(-33.8688, true);
    expect(southLatDms).toContain('33°');
    expect(southLatDms).toContain('S');

    const westLonDms = formatDMS(-118.2437, false);
    expect(westLonDms).toContain('118°');
    expect(westLonDms).toContain('W');
  });

  it('converts degrees to NATO mils correctly (6400 mils per circle)', () => {
    expect(toMils(0)).toBe(0);
    expect(toMils(90)).toBe(1600);
    expect(toMils(180)).toBe(3200);
    expect(toMils(270)).toBe(4800);
    expect(toMils(360)).toBe(0);
  });

  it('calculates 10-digit MGRS military grid coordinate', () => {
    // 11.181867, 75.850672 is in Zone 43P EN
    const mgrs = getMGRS(11.181867, 75.850672);
    expect(mgrs).toMatch(/^43P\s+[A-Z]{2}\s+\d{5}\s+\d{5}$/);
  });

  it('calculates Haversine distance between two coordinates accurately', () => {
    // Distance from (0, 0) to (1, 0) should be approx 111 km
    const dist = calculateDistanceKm(0, 0, 1, 0);
    expect(Math.round(dist)).toBe(111);
  });

  it('calculates true bearing azimuth correctly', () => {
    // Due North
    const bearingNorth = calculateBearing(0, 0, 1, 0);
    expect(Math.round(bearingNorth)).toBe(0);

    // Due East
    const bearingEast = calculateBearing(0, 0, 0, 1);
    expect(Math.round(bearingEast)).toBe(90);

    // Due South
    const bearingSouth = calculateBearing(1, 0, 0, 0);
    expect(Math.round(bearingSouth)).toBe(180);
  });

  it('formats coordinates correctly across MGRS, DMS, and DECIMAL formats', () => {
    const lat = 11.181867;
    const lon = 75.850672;

    const mgrsStr = formatCoordinateString(lat, lon, 'MGRS');
    expect(mgrsStr).toMatch(/^43P\s+[A-Z]{2}\s+\d{5}\s+\d{5}$/);

    const dmsStr = formatCoordinateString(lat, lon, 'DMS');
    expect(dmsStr).toContain('11°');
    expect(dmsStr).toContain('75°');
    expect(dmsStr).toContain('N');
    expect(dmsStr).toContain('E');

    const decStr = formatCoordinateString(lat, lon, 'DECIMAL');
    expect(decStr).toContain('11.18187° N');
    expect(decStr).toContain('75.85067° E');

    const mgrsShort = formatCoordinateShort(lat, lon, 'MGRS');
    expect(mgrsShort).toContain('43P');

    const dmsShort = formatCoordinateShort(lat, lon, 'DMS');
    expect(dmsShort).toContain('11°');
    expect(dmsShort).toContain('75°');

    const decShort = formatCoordinateShort(lat, lon, 'DECIMAL');
    expect(decShort).toBe('11.1819°, 75.8507°');
  });

  it('assigns deterministic and distinct colors to cluster callsigns', () => {
    const col1 = getCallsignColor('OPERATOR-301');
    const col2 = getCallsignColor('ALPHA-1');
    const col3 = getCallsignColor('BRAVO-6');

    expect(col1.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(col2.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(col3.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);

    // Same callsign always receives exact same color
    const col1Repeat = getCallsignColor('OPERATOR-301');
    expect(col1Repeat.hex).toBe(col1.hex);

    // Case-insensitive consistency
    const col1Lower = getCallsignColor('operator-301');
    expect(col1Lower.hex).toBe(col1.hex);
  });

  it('sanitizes peer strings against DOM XSS injection', () => {
    expect(escapeHtml('<script>alert("pwn")</script>')).toBe('&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;');
    expect(escapeHtml("POI 'Alpha' & 'Beta'")).toBe('POI &#39;Alpha&#39; &amp; &#39;Beta&#39;');
    expect(escapeHtml('<img src=x onerror=evil()>')).toBe('&lt;img src=x onerror=evil()&gt;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('SAFE-CALLSIGN-01')).toBe('SAFE-CALLSIGN-01');
  });
});
