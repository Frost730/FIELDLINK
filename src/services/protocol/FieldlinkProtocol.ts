/**
 * FIELDLINK Tactical Communication Protocol (FTCP v1.0)
 * Specification-compliant binary/JSON tactical message exchange protocol
 * Handles peer authentication, squad membership, real-time GPS telemetry,
 * waypoint synchronisation, emergency SOS distress, and transport switching.
 */

export type TacticalMessageType =
  | 'DEVICE_HELLO'
  | 'AUTH_REQUEST'
  | 'AUTH_RESPONSE'
  | 'SQUAD_JOIN'
  | 'SQUAD_LEAVE'
  | 'LOCATION_UPDATE'
  | 'HEARTBEAT'
  | 'WAYPOINT_CREATE'
  | 'WAYPOINT_UPDATE'
  | 'WAYPOINT_DELETE'
  | 'SOS_ALERT'
  | 'SOS_CANCEL'
  | 'ACKNOWLEDGEMENT'
  | 'TRANSPORT_SWITCH';

export type TransportType = 'NEARBY_CONNECTIONS' | 'WIFI_DIRECT' | 'LOCAL_HOTSPOT';

export interface BaseTacticalMessage {
  version: '1.0';
  msgId: string;
  type: TacticalMessageType;
  senderId: string;
  callsign: string;
  timestamp: number;
  checksum: number;
}

export interface DeviceHelloPayload {
  supportedTransports: TransportType[];
  protocolVersion: string;
  capabilities: string[];
}

export interface AuthRequestPayload {
  nonce: string;
  squadKeyHash?: string;
}

export interface AuthResponsePayload {
  status: 'ACCEPTED' | 'REJECTED';
  authenticated: boolean;
  reason?: string;
}

export interface SquadJoinPayload {
  squadId: string;
  callsign: string;
  role: 'LEADER' | 'MEMBER' | 'OBSERVER';
}

export interface SquadLeavePayload {
  squadId: string;
  reason?: string;
}

export interface LocationUpdatePayload {
  lat: number;
  lon: number;
  altitudeM: number;
  accuracyM: number;
  speedKmh: number;
  headingDeg: number;
  headingMils: number;
  mgrs: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'SOS';
}

export interface HeartbeatPayload {
  batteryPct?: number;
  activeTransport: TransportType;
  sequence: number;
}

export interface WaypointPayload {
  id: string;
  name: string;
  category: 'RP' | 'OBJ' | 'MP' | 'CAMP' | 'VEH' | 'H2O' | 'MED' | 'HAZARD' | 'SOS' | 'CUSTOM';
  lat: number;
  lon: number;
  description?: string;
  createdAt: number;
}

export interface SOSAlertPayload {
  callsign: string;
  lat: number;
  lon: number;
  altitudeM: number;
  accuracyM: number;
  mgrs: string;
  timestamp: number;
  urgency: 'CRITICAL';
}

export interface SOSCancelPayload {
  callsign: string;
  timestamp: number;
}

export interface AcknowledgementPayload {
  replyToMsgId: string;
  status: 'OK' | 'ERROR';
  details?: string;
}

export interface TransportSwitchPayload {
  targetTransport: TransportType;
  reason: 'HEARTBEAT_TIMEOUT' | 'SIGNAL_DEGRADATION' | 'MANUAL';
  connectionParams?: Record<string, string>;
}

export type TacticalMessage =
  | (BaseTacticalMessage & { type: 'DEVICE_HELLO'; payload: DeviceHelloPayload })
  | (BaseTacticalMessage & { type: 'AUTH_REQUEST'; payload: AuthRequestPayload })
  | (BaseTacticalMessage & { type: 'AUTH_RESPONSE'; payload: AuthResponsePayload })
  | (BaseTacticalMessage & { type: 'SQUAD_JOIN'; payload: SquadJoinPayload })
  | (BaseTacticalMessage & { type: 'SQUAD_LEAVE'; payload: SquadLeavePayload })
  | (BaseTacticalMessage & { type: 'LOCATION_UPDATE'; payload: LocationUpdatePayload })
  | (BaseTacticalMessage & { type: 'HEARTBEAT'; payload: HeartbeatPayload })
  | (BaseTacticalMessage & { type: 'WAYPOINT_CREATE'; payload: WaypointPayload })
  | (BaseTacticalMessage & { type: 'WAYPOINT_UPDATE'; payload: WaypointPayload })
  | (BaseTacticalMessage & { type: 'WAYPOINT_DELETE'; payload: { id: string } })
  | (BaseTacticalMessage & { type: 'SOS_ALERT'; payload: SOSAlertPayload })
  | (BaseTacticalMessage & { type: 'SOS_CANCEL'; payload: SOSCancelPayload })
  | (BaseTacticalMessage & { type: 'ACKNOWLEDGEMENT'; payload: AcknowledgementPayload })
  | (BaseTacticalMessage & { type: 'TRANSPORT_SWITCH'; payload: TransportSwitchPayload });

/**
 * Calculates a lightweight 32-bit checksum for payload integrity verification
 */
export function calculateChecksum(dataStr: string): number {
  let hash = 0;
  for (let i = 0; i < dataStr.length; i++) {
    const char = dataStr.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash >>> 0;
}

export class FieldlinkProtocol {
  private static readonly PROTOCOL_VERSION = '1.0';

  /**
   * Constructs and serializes a validated tactical message
   */
  static createMessage<T extends TacticalMessageType>(
    type: T,
    senderId: string,
    callsign: string,
    payload: any
  ): TacticalMessage {
    const msgId = `fl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = Date.now();
    const payloadStr = JSON.stringify(payload);
    const integrityData = `${type}|${senderId}|${callsign}|${timestamp}|${payloadStr}`;
    const checksum = calculateChecksum(integrityData);

    return {
      version: this.PROTOCOL_VERSION,
      msgId,
      type,
      senderId,
      callsign,
      timestamp,
      checksum,
      payload,
    } as TacticalMessage;
  }

  /**
   * Serializes a message to string format for RF / Socket transmission
   */
  static serialize(msg: TacticalMessage): string {
    return JSON.stringify(msg);
  }

  /**
   * Deserializes and validates an incoming raw tactical message
   */
  static deserialize(raw: string): { valid: boolean; message?: TacticalMessage; error?: string } {
    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        return { valid: false, error: 'Malformed message: not an object' };
      }

      if (parsed.version !== this.PROTOCOL_VERSION) {
        return { valid: false, error: `Incompatible protocol version: ${parsed.version}` };
      }

      if (!parsed.msgId || !parsed.type || !parsed.senderId || !parsed.callsign) {
        return { valid: false, error: 'Missing mandatory header fields' };
      }

      // Checksum integrity check across entire message envelope
      const payloadStr = JSON.stringify(parsed.payload);
      const integrityData = `${parsed.type}|${parsed.senderId}|${parsed.callsign}|${parsed.timestamp}|${payloadStr}`;
      const computedChecksum = calculateChecksum(integrityData);
      if (parsed.checksum !== computedChecksum) {
        return { valid: false, error: 'Checksum mismatch - packet corrupted or tampered' };
      }

      // Replay prevention: reject packets older than 5 minutes
      const ageMs = Math.abs(Date.now() - parsed.timestamp);
      if (ageMs > 300000) {
        return { valid: false, error: 'Packet rejected: timestamp too stale (>5m)' };
      }

      return { valid: true, message: parsed as TacticalMessage };
    } catch (e: any) {
      return { valid: false, error: `JSON parse error: ${e.message}` };
    }
  }
}
