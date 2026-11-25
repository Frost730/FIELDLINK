import { registerPlugin, Capacitor } from '@capacitor/core';
import { useTacticalStore, type SquadMember } from '../../store/useTacticalStore';

export interface DiscoveredPeer {
  endpointId: string;
  callsign: string;
  nodeId?: string;
  isPending?: boolean;
  keyMismatch?: boolean;
}

export interface PeerConnectionEvent {
  endpointId: string;
  callsign?: string;
  nodeId?: string;
  remainingConnectedCount?: number;
  status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
}

export interface SquadTelemetryPayload {
  endpointId?: string;
  nodeId?: string;
  type: string;
  callsign: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  speed: number;
  status: 'CONNECTED' | 'DISCONNECTED' | 'SOS';
  accuracy?: number;
  fixType?: 'GNSS_3D' | 'CELL_2D' | 'WIFI_2D' | 'PINNED_INDOOR';
  isLeader?: boolean;
  clusterLeader?: string;
  timestamp: number;
}

export interface FieldlinkNearbyPluginInterface {
  startAdvertising(options: { callsign: string }): Promise<{ status: string; callsign: string }>;
  startDiscovery(): Promise<{ status: string }>;
  stopNearby(): Promise<{ status: string }>;
  connectToPeer(options: { endpointId: string }): Promise<{ status: string; endpointId: string }>;
  broadcastSquadTelemetry(options: {
    callsign: string;
    lat: number;
    lon: number;
    alt: number;
    heading: number;
    speed: number;
    status: string;
    accuracy?: number;
    fixType?: string;
    isLeader?: boolean;
    clusterLeader?: string;
    targetEndpointId?: string;
  }): Promise<{ sentCount: number }>;
  broadcastLeaderClaim(options: {
    callsign: string;
    isLeader: boolean;
    clusterLeader?: string;
    targetEndpointId?: string;
  }): Promise<{ sentCount: number; type: string }>;
  broadcastWaypoint(options: {
    callsign: string;
    id?: string;
    name: string;
    category: string;
    lat: number;
    lon: number;
    description?: string;
    createdBy?: string;
    targetEndpointId?: string;
  }): Promise<{ sentCount: number }>;
  broadcastDeleteWaypoint(options: {
    id: string;
    callsign: string;
  }): Promise<{ sentCount: number }>;
  broadcastDrawing(options: {
    id: string;
    callsign: string;
    points: string;
    color?: string;
    targetEndpointId?: string;
  }): Promise<{ sentCount: number }>;
  broadcastDeleteDrawing(options: {
    id: string;
    callsign: string;
  }): Promise<{ sentCount: number }>;
  broadcastClearAllDrawings(options: {
    callsign: string;
  }): Promise<{ sentCount: number }>;
  broadcastTombstones(options: {
    waypointIds: string[];
    drawingIds: string[];
    targetEndpointId?: string;
  }): Promise<{ sentCount: number }>;
  broadcastRoute(options: {
    callsign: string;
    points: string;
  }): Promise<{ sentCount: number }>;
  checkMeshStatus(): Promise<{
    isAdvertising: boolean;
    isDiscovering: boolean;
    connectedCount: number;
    pendingCount?: number;
    mismatchedCount?: number;
    pendingEndpoints?: string[];
    connectedEndpoints?: Array<{ endpointId: string; callsign: string; nodeId?: string; keyMismatch?: boolean }>;
    hasPermissions: boolean;
    callsign: string;
    nodeId?: string;
    isDefaultMissionKey?: boolean;
    hasCustomMissionKey?: boolean;
    missionKey?: string;
    discoveredPeers: DiscoveredPeer[];
  }>;
  requestMeshPermissions(): Promise<{ granted?: boolean }>;
  setMissionKey(options: { key: string }): Promise<{ status: string; isDefaultMissionKey?: boolean }>;
  updateCallsign(options: { callsign: string }): Promise<{ callsign: string; oldCallsign?: string }>;
  addListener(eventName: 'connectionInitiated', listenerFunc: (data: { endpointId: string; callsign: string; nodeId?: string; authDigits?: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'cryptoError', listenerFunc: (data: { endpointId: string; callsign: string; nodeId?: string; type: string; message: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'missionKeyRotated', listenerFunc: (data: { isDefaultMissionKey: boolean }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'callsignUpdated', listenerFunc: (data: { callsign: string; oldCallsign?: string; nodeId?: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'peerDiscovered', listenerFunc: (peer: DiscoveredPeer) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'peerLost', listenerFunc: (data: { endpointId: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'peerConnected', listenerFunc: (data: PeerConnectionEvent) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'peerConnectionFailed', listenerFunc: (data: PeerConnectionEvent) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'peerDisconnected', listenerFunc: (data: PeerConnectionEvent) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'squadTelemetryReceived', listenerFunc: (data: SquadTelemetryPayload) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'leaderClaimReceived', listenerFunc: (data: { callsign: string; isLeader: boolean; clusterLeader?: string; timestamp: number }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'waypointReceived', listenerFunc: (data: { id?: string; name: string; category: string; lat: number; lon: number; description?: string; callsign: string; createdBy?: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'waypointDeleted', listenerFunc: (data: { id: string; deletedBy: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'drawingReceived', listenerFunc: (data: { id: string; createdBy: string; points: string; color?: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'drawingDeleted', listenerFunc: (data: { id: string; deletedBy: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'drawingsCleared', listenerFunc: (data: { deletedBy: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'tombstonesReceived', listenerFunc: (data: { waypointIds: string; drawingIds: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'routeReceived', listenerFunc: (data: { points: string; callsign: string }) => void): Promise<{ remove: () => void }>;
}

export const NativeNearby = registerPlugin<FieldlinkNearbyPluginInterface>('FieldlinkNearby');

export class FieldlinkMeshService {
  private static isNative = Capacitor.isNativePlatform();
  private static broadcastTimer: any = null;
  private static listeners: Array<{ remove: () => void }> = [];

  static async initMesh(
    callsign: string,
    onSquadMemberUpdate: (member: SquadMember) => void,
    onDiscovered?: (peers: DiscoveredPeer[]) => void
  ): Promise<void> {
    if (!this.isNative) return;

    try {
      await NativeNearby.requestMeshPermissions();
    } catch (e) {
      console.warn('Mesh permissions request:', e);
    }

    // 1. Listen for discovered peers
    const discHandle = await NativeNearby.addListener('peerDiscovered', (peer) => {
      console.log('Tactical peer discovered:', peer);
      if (onDiscovered) {
        NativeNearby.checkMeshStatus().then((s) => onDiscovered(s.discoveredPeers)).catch(() => {});
      }
    });
    this.listeners.push(discHandle);

    // 2. Listen for connected peers
    const connHandle = await NativeNearby.addListener('peerConnected', (event) => {
      console.log('Tactical peer connected:', event);
      if (onDiscovered) {
        NativeNearby.checkMeshStatus().then((s) => onDiscovered(s.discoveredPeers)).catch(() => {});
      }
      FieldlinkMeshService.syncStateToCluster(event.endpointId);
    });
    this.listeners.push(connHandle);

    // 2b. Listen for Tactical Crypto Key Mismatch & Key Rotation
    try {
      const cryptoHandle = await NativeNearby.addListener('cryptoError', (err) => {
        console.warn('TACTICAL CIPHER MISMATCH DETECTED:', err);
        window.dispatchEvent(new CustomEvent('fieldlink:crypto-error', { detail: err }));
      });
      this.listeners.push(cryptoHandle);

      const keyRotHandle = await NativeNearby.addListener('missionKeyRotated', () => {
        setTimeout(() => {
          FieldlinkMeshService.syncStateToCluster();
        }, 250);
      });
      this.listeners.push(keyRotHandle);
    } catch {
      // Ignore listener setup error on unsupported platform
    }

    // 2c. Listen for direct peer disconnections, live callsign renames, & deletion tombstones
    try {
      const disconnHandle = await NativeNearby.addListener('peerDisconnected', (event) => {
        // When zero direct RF links remain, all direct and relayed squad peers are unreachable
        if ((event.remainingConnectedCount ?? 0) === 0) {
          useTacticalStore.getState().markAllSquadDisconnected();
        } else if (event.nodeId || event.callsign) {
          useTacticalStore.getState().markSquadMemberDisconnected(event.nodeId || event.callsign!);
        }
        if (onDiscovered) {
          NativeNearby.checkMeshStatus().then((s) => onDiscovered(s.discoveredPeers)).catch(() => {});
        }
      });
      this.listeners.push(disconnHandle);

      const csHandle = await NativeNearby.addListener('callsignUpdated', (data) => {
        if (data.oldCallsign && data.callsign) {
          useTacticalStore.getState().renameSquadMember(data.oldCallsign, data.callsign);
        }
      });
      this.listeners.push(csHandle);

      const tombHandle = await NativeNearby.addListener('tombstonesReceived', (data) => {
        try {
          const wpIds = JSON.parse(data.waypointIds || '[]');
          const drIds = JSON.parse(data.drawingIds || '[]');
          if (Array.isArray(wpIds) && Array.isArray(drIds)) {
            useTacticalStore.getState().applyRemoteTombstones(wpIds, drIds);
          }
        } catch {}
      });
      this.listeners.push(tombHandle);
    } catch {
      // Ignore listener setup error on unsupported platform
    }

    // 3. Listen for dedicated cluster leader claims & abdications
    try {
      const leaderHandle = await NativeNearby.addListener('leaderClaimReceived', (data) => {
        console.log('Tactical leader claim event received:', data);
        const myCallsign = useTacticalStore.getState().callsign;
        if (data.callsign === myCallsign) return;

        if (data.isLeader) {
          useTacticalStore.getState().setClusterLeader(data.clusterLeader || data.callsign);
        } else {
          const currentLeader = useTacticalStore.getState().clusterLeaderCallsign;
          if (currentLeader === data.callsign || currentLeader === data.clusterLeader) {
            useTacticalStore.getState().setClusterLeader(null);
          }
        }
      });
      this.listeners.push(leaderHandle);
    } catch {
      // Ignore listener setup error
    }

    // 4. Listen for incoming squad telemetry packets (direct & relayed multi-hop)
    const telemetryHandle = await NativeNearby.addListener('squadTelemetryReceived', (payload) => {
      const myCallsign = useTacticalStore.getState().callsign;
      if (payload.callsign && payload.callsign === myCallsign) return;

      const member: SquadMember = {
        id: payload.nodeId || payload.callsign, // Globally stable nodeId across renames & multi-hop relays
        callsign: payload.callsign,
        lat: payload.lat,
        lon: payload.lon,
        alt: payload.alt,
        heading: payload.heading,
        speed: payload.speed || 0,
        status: (payload.status as SquadMember['status']) || 'CONNECTED',
        accuracy: payload.accuracy,
        fixType: payload.fixType,
        isLeader: payload.isLeader || false,
        lastSeen: payload.timestamp || Date.now(),
      };
      onSquadMemberUpdate(member);

      // Automatically sync cluster leadership from telemetry packets
      if (payload.isLeader) {
        useTacticalStore.getState().setClusterLeader(payload.callsign);
      } else if (payload.clusterLeader) {
        useTacticalStore.getState().setClusterLeader(payload.clusterLeader);
      } else if (useTacticalStore.getState().clusterLeaderCallsign === payload.callsign && !payload.isLeader) {
        useTacticalStore.getState().setClusterLeader(null);
      }
    });
    this.listeners.push(telemetryHandle);

    // 4. Listen for incoming waypoints/markers from squad peers
    try {
      const wpHandle = await NativeNearby.addListener('waypointReceived', (wp) => {
        console.log('Incoming waypoint from squad peer:', wp);
        const store = useTacticalStore.getState();
        const exists = store.waypoints.some((w) => wp.id && w.id === wp.id);
        if (!exists) {
          store.addWaypoint({
            id: wp.id,
            name: wp.name,
            category: (wp.category as any) || 'RP',
            lat: wp.lat,
            lon: wp.lon,
            description: wp.description || `Marked by ${wp.createdBy || wp.callsign}`,
            createdBy: wp.createdBy || wp.callsign,
          } as any);
        }
      });
      this.listeners.push(wpHandle);

      const delWpHandle = await NativeNearby.addListener('waypointDeleted', (data) => {
        console.log('Waypoint deleted by peer/leader:', data);
        if (data.id) {
          useTacticalStore.getState().removeWaypoint(data.id);
        }
      });
      this.listeners.push(delWpHandle);
    } catch (e) {
      console.warn('Waypoint listener setup:', e);
    }

    // 5. Listen for incoming tactical drawings from squad peers
    try {
      const drawHandle = await NativeNearby.addListener('drawingReceived', (data) => {
        console.log('Incoming tactical drawing from peer:', data);
        try {
          const pts = JSON.parse(data.points);
          if (Array.isArray(pts) && pts.length > 0) {
            useTacticalStore.getState().addDrawing({
              id: data.id,
              createdBy: data.createdBy,
              points: pts,
              color: data.color || '#35D5D9',
              createdAt: Date.now(),
            });
          }
        } catch {}
      });
      this.listeners.push(drawHandle);

      const delDrawHandle = await NativeNearby.addListener('drawingDeleted', (data) => {
        console.log('Drawing deleted by peer/leader:', data);
        if (data.id) {
          useTacticalStore.getState().removeDrawing(data.id);
        }
      });
      this.listeners.push(delDrawHandle);

      const clearDrawHandle = await NativeNearby.addListener('drawingsCleared', (data) => {
        console.log('All drawings cleared by leader:', data);
        useTacticalStore.getState().clearAllDrawings();
      });
      this.listeners.push(clearDrawHandle);

      const routeHandle = await NativeNearby.addListener('routeReceived', (data) => {
        console.log('Incoming route from squad peer:', data);
        try {
          const pts = JSON.parse(data.points);
          if (Array.isArray(pts) && pts.length > 0) {
            useTacticalStore.getState().addDrawing({
              id: 'draw-' + data.callsign + '-' + Date.now(),
              createdBy: data.callsign,
              points: pts,
              createdAt: Date.now(),
            });
          }
        } catch {}
      });
      this.listeners.push(routeHandle);
    } catch (e) {
      console.warn('Drawing listener setup:', e);
    }

    // 6. Start Advertising & Discovery simultaneously (P2P Cluster)
    try {
      await NativeNearby.startAdvertising({ callsign });
      await NativeNearby.startDiscovery();
    } catch (e) {
      console.warn('Start Nearby mesh warning:', e);
    }

    // 7. Periodic discovery & mesh maintenance keep-alive (every 10 seconds)
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.broadcastTimer = setInterval(async () => {
      try {
        const s = await NativeNearby.checkMeshStatus();
        if (!s.isAdvertising) {
          await NativeNearby.startAdvertising({ callsign: useTacticalStore.getState().callsign });
        }
        if (!s.isDiscovering) {
          await NativeNearby.startDiscovery();
        }
      } catch {}
    }, 10000);
  }

  static async syncStateToCluster(targetEndpointId?: string) {
    if (!this.isNative) return;
    const state = useTacticalStore.getState();

    await this.broadcastPosition(
      state.callsign,
      state.lat,
      state.lon,
      state.altitudeM,
      state.compassHeading,
      state.speedKmh,
      state.activeSOS ? 'SOS' : 'CONNECTED',
      state.isLeader,
      state.clusterLeaderCallsign,
      state.accuracyM,
      undefined,
      targetEndpointId
    );
    if (state.isLeader) {
      await NativeNearby.broadcastLeaderClaim({
        callsign: state.callsign,
        isLeader: true,
        clusterLeader: state.callsign,
        targetEndpointId,
      }).catch(() => {});
    }

    const wpTombstones = Object.keys(state.deletedWaypointIds || {});
    const drTombstones = Object.keys(state.deletedDrawingIds || {});
    if (wpTombstones.length > 0 || drTombstones.length > 0) {
      await NativeNearby.broadcastTombstones({
        waypointIds: wpTombstones.slice(-50),
        drawingIds: drTombstones.slice(-50),
        targetEndpointId,
      }).catch(() => {});
    }

    const currentWps = useTacticalStore.getState().waypoints;
    currentWps.forEach((wp, idx) => {
      setTimeout(() => {
        void this.broadcastWaypoint(wp, targetEndpointId);
      }, 350 + idx * 60);
    });

    const currentDrawings = useTacticalStore.getState().drawings;
    currentDrawings.forEach((dr, idx) => {
      setTimeout(() => {
        void this.broadcastDrawing(dr, targetEndpointId);
      }, 650 + idx * 80);
    });
  }

  static async broadcastWaypoint(
    wp: {
      id?: string;
      name: string;
      category: string;
      lat: number;
      lon: number;
      description?: string;
      createdBy?: string;
    },
    targetEndpointId?: string
  ) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastWaypoint({
        callsign: state.callsign,
        id: wp.id,
        name: wp.name,
        category: wp.category,
        lat: wp.lat,
        lon: wp.lon,
        description: wp.description,
        createdBy: wp.createdBy || state.callsign,
        targetEndpointId,
      });
    } catch (e) {
      console.warn('Waypoint broadcast warning:', e);
    }
  }

  static async broadcastDeleteWaypoint(id: string) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastDeleteWaypoint({
        id,
        callsign: state.callsign,
      });
    } catch (e) {
      console.warn('Delete waypoint broadcast warning:', e);
    }
  }

  static async broadcastDrawing(
    drawing: {
      id: string;
      createdBy: string;
      points: Array<{ lat: number; lon: number }>;
      color?: string;
    },
    targetEndpointId?: string
  ) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastDrawing({
        id: drawing.id,
        callsign: state.callsign,
        points: JSON.stringify(drawing.points),
        color: drawing.color || '#35D5D9',
        targetEndpointId,
      });
    } catch (e) {
      console.warn('Drawing broadcast warning:', e);
    }
  }

  static async broadcastDeleteDrawing(id: string) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastDeleteDrawing({
        id,
        callsign: state.callsign,
      });
    } catch (e) {
      console.warn('Delete drawing broadcast warning:', e);
    }
  }

  static async broadcastClearAllDrawings() {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastClearAllDrawings({
        callsign: state.callsign,
      });
    } catch (e) {
      console.warn('Clear all drawings broadcast warning:', e);
    }
  }

  static async broadcastRoute(points: Array<{ lat: number; lon: number }>) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastRoute({
        callsign: state.callsign,
        points: JSON.stringify(points),
      });
    } catch (e) {
      console.warn('Route broadcast warning:', e);
    }
  }

  static async broadcastPosition(
    callsign: string,
    lat: number,
    lon: number,
    alt: number,
    heading: number,
    speed: number,
    status = 'CONNECTED',
    isLeader?: boolean,
    clusterLeader?: string | null,
    accuracy?: number,
    fixType?: string,
    targetEndpointId?: string
  ) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      const leaderVal = isLeader !== undefined ? isLeader : state.isLeader;
      const leaderCallsign = clusterLeader !== undefined ? clusterLeader : state.clusterLeaderCallsign;
      const accVal = accuracy !== undefined ? accuracy : state.accuracyM;
      const isGnss3D = state.hasGpsFix && (state.satellitesCount >= 4 || (state.accuracyM > 0 && state.accuracyM <= 15 && state.hasAltitudeFix && state.locationProvider !== 'network'));
      const fixVal = fixType || (isGnss3D ? 'GNSS_3D' : (state.accuracyM > 35 || state.locationProvider === 'network' ? 'PINNED_INDOOR' : 'WIFI_2D'));

      await NativeNearby.broadcastSquadTelemetry({
        callsign,
        lat,
        lon,
        alt,
        heading,
        speed,
        status,
        accuracy: accVal,
        fixType: fixVal,
        isLeader: leaderVal,
        clusterLeader: leaderCallsign || '',
        targetEndpointId,
      });
    } catch {
      // Ignore broadcast errors when no endpoints connected
    }
  }

  static async broadcastLeaderClaim(isLeader: boolean) {
    if (!this.isNative) return;
    try {
      const state = useTacticalStore.getState();
      await NativeNearby.broadcastLeaderClaim({
        callsign: state.callsign,
        isLeader,
        clusterLeader: isLeader ? state.callsign : '',
      });
      // Also broadcast position/presence immediately to update all peers' squad lists
      await this.broadcastPosition(
        state.callsign,
        state.lat,
        state.lon,
        state.altitudeM,
        state.compassHeading,
        state.speedKmh,
        state.activeSOS ? 'SOS' : 'CONNECTED',
        isLeader,
        isLeader ? state.callsign : null
      );
    } catch (e) {
      console.warn('Leader claim broadcast warning:', e);
    }
  }

  static async stopMesh() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.listeners.forEach((l) => l.remove());
    this.listeners = [];

    if (this.isNative) {
      try {
        await NativeNearby.stopNearby();
      } catch {}
    }
  }

  static async setMissionKey(key: string): Promise<void> {
    if (!this.isNative) return;
    try {
      await NativeNearby.setMissionKey({ key });
    } catch (e) {
      console.warn('Set mission key error:', e);
    }
  }

  static async updateCallsign(newCallsign: string): Promise<void> {
    if (!this.isNative) return;
    try {
      await NativeNearby.updateCallsign({ callsign: newCallsign });
    } catch (e) {
      console.warn('Update callsign mesh error:', e);
    }
  }
}
