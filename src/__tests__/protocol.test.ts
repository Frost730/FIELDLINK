import { describe, it, expect } from 'vitest';
import { FieldlinkProtocol } from '../services/protocol/FieldlinkProtocol';

describe('FIELDLINK Tactical Communication Protocol (FTCP v1.0)', () => {
  it('creates and serializes a valid LOCATION_UPDATE message', () => {
    const msg = FieldlinkProtocol.createMessage('LOCATION_UPDATE', 'dev-001', 'GHOST-1', {
      lat: 11.181867,
      lon: 75.850672,
      altitudeM: 120,
      accuracyM: 4.5,
      speedKmh: 12,
      headingDeg: 167,
      headingMils: 2967,
      mgrs: '43P EN 92876 36222',
      status: 'CONNECTED',
    });

    expect(msg.version).toBe('1.0');
    expect(msg.type).toBe('LOCATION_UPDATE');
    expect(msg.senderId).toBe('dev-001');
    expect(msg.callsign).toBe('GHOST-1');
    expect(msg.checksum).toBeGreaterThan(0);

    const serialized = FieldlinkProtocol.serialize(msg);
    expect(typeof serialized).toBe('string');
    expect(serialized).toContain('GHOST-1');

    const result = FieldlinkProtocol.deserialize(serialized);
    expect(result.valid).toBe(true);
    expect(result.message?.msgId).toBe(msg.msgId);
    expect(result.message?.callsign).toBe('GHOST-1');
  });

  it('rejects corrupted messages with checksum mismatches', () => {
    const msg = FieldlinkProtocol.createMessage('HEARTBEAT', 'dev-002', 'VIPER-2', {
      activeTransport: 'NEARBY_CONNECTIONS',
      sequence: 1,
    });

    const serialized = FieldlinkProtocol.serialize(msg);
    const tampered = serialized.replace('VIPER-2', 'TAMPERED-CALLSIGN');

    const result = FieldlinkProtocol.deserialize(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Checksum mismatch');
  });

  it('verifies all 14 tactical message types', () => {
    const types = [
      'DEVICE_HELLO',
      'AUTH_REQUEST',
      'AUTH_RESPONSE',
      'SQUAD_JOIN',
      'SQUAD_LEAVE',
      'LOCATION_UPDATE',
      'HEARTBEAT',
      'WAYPOINT_CREATE',
      'WAYPOINT_UPDATE',
      'WAYPOINT_DELETE',
      'SOS_ALERT',
      'SOS_CANCEL',
      'ACKNOWLEDGEMENT',
      'TRANSPORT_SWITCH',
    ] as const;

    types.forEach((type) => {
      const msg = FieldlinkProtocol.createMessage(type, 'tester', 'ALPHA-01', { test: true });
      const serialized = FieldlinkProtocol.serialize(msg);
      const parsed = FieldlinkProtocol.deserialize(serialized);
      expect(parsed.valid).toBe(true);
      expect(parsed.message?.type).toBe(type);
    });
  });
});
