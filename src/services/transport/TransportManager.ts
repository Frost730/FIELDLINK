/**
 * FIELDLINK Automatic Transport Manager
 * Implements Master Spec Part 10:
 * Multi-layer communication transport selection & failover:
 * 1. Nearby Connections (P2P Cluster - Highest priority, multi-peer mesh)
 * 2. Wi-Fi Direct (High bandwidth peer-to-peer Wi-Fi socket fallback)
 * 3. Local Hotspot / Ad-hoc Wi-Fi (Field AP fallback)
 */

import { NativeNearby } from '../native/FieldlinkNearby';
import { NativeWifiDirect, FieldlinkWifiDirectService } from '../native/FieldlinkWifiDirect';
import { FieldlinkProtocol, type TransportType } from '../protocol/FieldlinkProtocol';
import { useTacticalStore } from '../../store/useTacticalStore';

export type TransportStatus = 'IDLE' | 'SCANNING' | 'CONNECTED' | 'FALLBACK_SWITCHING' | 'ERROR';

export interface TransportState {
  activeTransport: TransportType;
  status: TransportStatus;
  connectedPeerCount: number;
  lastHeartbeatTs: number;
  availableTransports: TransportType[];
}

export class TransportManager {
  private static activeTransport: TransportType = 'NEARBY_CONNECTIONS';
  private static status: TransportStatus = 'IDLE';
  private static heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private static connectionWatchdog: ReturnType<typeof setInterval> | null = null;
  private static wifiDirectListener: { remove: () => void } | null = null;
  private static lastHeartbeatReceived: Map<string, number> = new Map();
  private static listeners: Set<(state: TransportState) => void> = new Set();

  private static readonly HEARTBEAT_TIMEOUT_MS = 8000;
  private static readonly HEARTBEAT_SEND_INTERVAL_MS = 2500;

  static getState(): TransportState {
    return {
      activeTransport: this.activeTransport,
      status: this.status,
      connectedPeerCount: this.lastHeartbeatReceived.size,
      lastHeartbeatTs: Date.now(),
      availableTransports: ['NEARBY_CONNECTIONS', 'WIFI_DIRECT', 'LOCAL_HOTSPOT'],
    };
  }

  static subscribe(listener: (state: TransportState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private static notify() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }

  /**
   * Initializes the primary transport (Nearby Connections) and activates watchdog
   */
  static async start(callsign: string): Promise<void> {
    this.status = 'SCANNING';
    this.activeTransport = 'NEARBY_CONNECTIONS';
    this.notify();

    try {
      // 1. Check Nearby Connections radio readiness & live connected link count
      const nearbyStatus = await NativeNearby.checkMeshStatus().catch(() => null);
      if (nearbyStatus) {
        this.status = nearbyStatus.connectedCount > 0 ? 'CONNECTED' : 'SCANNING';
      } else {
        // Fallback to Wi-Fi Direct if Nearby is unavailable
        await this.fallbackToWifiDirect();
      }
    } catch {
      await this.fallbackToWifiDirect();
    }

    this.startWatchdog(callsign);
    this.notify();
  }

  /**
   * Heartbeat & connection timeout watchdog
   */
  private static startWatchdog(callsign: string) {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.connectionWatchdog) clearInterval(this.connectionWatchdog);

    if (!this.wifiDirectListener) {
      NativeWifiDirect.addListener('wifiDirectPayloadReceived', ({ data }) => {
        const parsed = FieldlinkProtocol.deserialize(data);
        if (parsed.valid && parsed.message) {
          const msg = parsed.message;
          const myCallsign = useTacticalStore.getState().callsign;
          this.recordPeerHeartbeat(msg.callsign);
          if (msg.callsign === myCallsign) return;

          if (msg.type === 'LOCATION_UPDATE') {
            const p = msg.payload;
            useTacticalStore.getState().updateSquadMember({
              id: msg.senderId || msg.callsign,
              callsign: msg.callsign,
              lat: p.lat,
              lon: p.lon,
              alt: p.altitudeM,
              heading: p.headingDeg,
              speed: p.speedKmh,
              status: p.status,
              accuracy: p.accuracyM,
              lastSeen: msg.timestamp || Date.now(),
            });
          } else if (msg.type === 'WAYPOINT_CREATE' || msg.type === 'WAYPOINT_UPDATE') {
            const p = msg.payload;
            useTacticalStore.getState().addWaypoint({
              id: p.id,
              name: p.name,
              category: p.category,
              lat: p.lat,
              lon: p.lon,
              description: p.description,
              createdBy: msg.callsign,
            } as any);
          } else if (msg.type === 'WAYPOINT_DELETE') {
            useTacticalStore.getState().removeWaypoint(msg.payload.id);
          }
        }
      })
        .then((handle) => {
          this.wifiDirectListener = handle;
        })
        .catch(() => {});
    }

    let sequence = 0;
    this.heartbeatInterval = setInterval(async () => {
      // App.tsx manages primary Nearby Connections mesh telemetry & heartbeat.
      // Only allocate & transmit fallback heartbeats when activeTransport is WIFI_DIRECT.
      if (this.activeTransport !== 'WIFI_DIRECT') {
        return;
      }
      sequence++;
      const hbMsg = FieldlinkProtocol.createMessage('HEARTBEAT', callsign, callsign, {
        activeTransport: this.activeTransport,
        sequence,
      });

      try {
        const serialized = FieldlinkProtocol.serialize(hbMsg);
        await FieldlinkWifiDirectService.send(serialized);
      } catch {
        // Ignore transient fallback socket write failures
      }
    }, this.HEARTBEAT_SEND_INTERVAL_MS);

    // Watchdog to check for stale peers and trigger transport switch if degraded
    this.connectionWatchdog = setInterval(() => {
      const now = Date.now();
      let hasStalePeer = false;

      this.lastHeartbeatReceived.forEach((lastSeen, peerId) => {
        if (now - lastSeen > this.HEARTBEAT_TIMEOUT_MS) {
          hasStalePeer = true;
          this.lastHeartbeatReceived.delete(peerId);
        }
      });

      if (hasStalePeer) {
        this.notify();
      }
    }, 4000);
  }

  /**
   * Records incoming heartbeat from a peer node
   */
  static recordPeerHeartbeat(peerId: string) {
    this.lastHeartbeatReceived.set(peerId, Date.now());
    this.notify();
  }

  /**
   * Executes seamless transport failover from Nearby Connections to Wi-Fi Direct
   */
  static async fallbackToWifiDirect(): Promise<boolean> {
    this.status = 'FALLBACK_SWITCHING';
    this.activeTransport = 'WIFI_DIRECT';
    this.notify();

    try {
      const wdStatus = await NativeWifiDirect.checkStatus().catch(() => null);
      if (wdStatus && wdStatus.supported) {
        await NativeWifiDirect.discoverPeers().catch(() => {});
        this.status = 'CONNECTED';
        this.notify();
        return true;
      }
    } catch (e) {
      console.warn('Wi-Fi Direct fallback error:', e);
    }

    this.activeTransport = 'LOCAL_HOTSPOT';
    this.status = 'IDLE';
    this.notify();
    return false;
  }

  /**
   * Switches transport back to primary Nearby Connections mesh when signal recovers
   */
  static async restorePrimaryTransport(callsign: string): Promise<void> {
    this.activeTransport = 'NEARBY_CONNECTIONS';
    this.status = 'SCANNING';
    this.notify();

    try {
      await NativeNearby.startAdvertising({ callsign });
      await NativeNearby.startDiscovery();
      this.status = 'CONNECTED';
    } catch {
      this.status = 'IDLE';
    }
    this.notify();
  }

  static stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.connectionWatchdog) clearInterval(this.connectionWatchdog);
    if (this.wifiDirectListener) {
      this.wifiDirectListener.remove();
      this.wifiDirectListener = null;
    }
    this.heartbeatInterval = null;
    this.connectionWatchdog = null;
    this.lastHeartbeatReceived.clear();
    this.status = 'IDLE';
    this.notify();
  }
}
