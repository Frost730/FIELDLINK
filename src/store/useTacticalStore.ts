import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { calculateDistanceKm, calculateBearing } from '../utils/coordinates';
import { encryptVaultData, decryptVaultData } from '../utils/crypto';

// Tactical Data-at-Rest Protection: RFC 8439 ChaCha20 256-bit Authenticated Envelope
const safeStorage = createJSONStorage(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return {
      getItem: (name: string) => {
        const val = window.localStorage.getItem(name);
        return val ? decryptVaultData(val) : null;
      },
      setItem: (name: string, value: string) => {
        window.localStorage.setItem(name, encryptVaultData(value));
      },
      removeItem: (name: string) => {
        window.localStorage.removeItem(name);
      },
    };
  }
  const memoryStore = new Map<string, string>();
  return {
    getItem: (name: string) => memoryStore.get(name) ?? null,
    setItem: (name: string, value: string) => memoryStore.set(name, value),
    removeItem: (name: string) => memoryStore.delete(name),
  };
});

export interface SquadMember {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  alt?: number;
  heading?: number;
  speed?: number;
  distanceKm?: number;
  bearing?: number;
  isLeader?: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'SOS';
  accuracy?: number;
  fixType?: 'GNSS_3D' | 'CELL_2D' | 'WIFI_2D' | 'PINNED_INDOOR';
  lastSeen: number;
}

export interface TacticalDrawing {
  id: string;
  createdBy: string;
  points: Array<{ lat: number; lon: number }>;
  color?: string;
  createdAt: number;
}

export interface TacticalWaypoint {
  id: string;
  name: string;
  category: 'RP' | 'OBJ' | 'MP' | 'CAMP' | 'VEH' | 'H2O' | 'MED' | 'HAZARD' | 'SOS' | 'CUSTOM';
  lat: number;
  lon: number;
  description?: string;
  createdBy?: string;
  createdAt: number;
}

export interface TacticalOverlayFeature {
  id: string;
  type: 'sector_line' | 'boundary_circle' | 'route' | 'unit_box';
  color: 'blue' | 'yellow' | 'red' | 'cyan' | 'orange' | 'green';
  coordinates: any;
  label?: string;
}

interface TacticalState {
  // Navigation & Location
  lat: number;
  lon: number;
  altitudeM: number;
  hasAltitudeFix: boolean;
  accuracyM: number;
  speedKmh: number;
  gpsBearing: number;
  hasGpsFix: boolean;
  gpsTimestamp: number;
  satellitesCount: number;
  locationProvider: string;

  // Sensor Compass
  compassHeading: number;
  compassTrueHeading: number;
  compassMagneticHeading: number;
  compassDeclination: number;
  compassMils: number;
  compassAccuracy: number;
  compassSensorType: string;
  compassPitch: number;
  compassRoll: number;
  compassNorthMode: 'TRUE' | 'MAGNETIC';
  compassTrimOffset: number;

  // Operator
  callsign: string;
  isLeader: boolean;
  clusterLeaderCallsign: string | null;
  isLocationSharing: boolean;

  // Preferences (Master Spec Part 4)
  distanceUnit: 'MI' | 'KM';
  coordFormat: 'MGRS' | 'DMS' | 'DECIMAL';
  gpsIntervalMs: number;
  activeTransport: 'NEARBY_CONNECTIONS' | 'WIFI_DIRECT' | 'LOCAL_HOTSPOT';

  // UI Modes (from reference toolbar & drawer)
  isNightMode: boolean;
  isGridVisible: boolean;
  isDrawingActive: boolean;
  isSquadTrackingActive: boolean;
  mapStyle: 'satellite' | 'topo';
  isDrawerOpen: boolean;
  activeModal: 'waypoints' | 'offline_maps' | 'squad' | 'nearby' | 'settings' | 'sos' | 'measure' | 'compass_cal' | null;

  // Offline Tile Cache Status & Telemetry
  tileCacheStatus: 'cached' | 'downloading' | 'offline_grid';
  cachedTilesCount: number;
  setTileCacheStatus: (status: 'cached' | 'downloading' | 'offline_grid') => void;
  incrementCachedTilesCount: (delta?: number) => void;

  // Data Collections (strictly real, no mock data)
  squadMembers: SquadMember[];
  waypoints: TacticalWaypoint[];
  drawings: TacticalDrawing[];
  deletedWaypointIds: Record<string, number>;
  deletedDrawingIds: Record<string, number>;
  overlays: TacticalOverlayFeature[];
  drawingPoints: Array<{ lat: number; lon: number }>;
  activeSOS: { callsign: string; lat: number; lon: number; timestamp: number } | null;
  selectedTarget: { lat: number; lon: number; name?: string } | null;

  // Actions
  updatePosition: (pos: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    accuracy?: number | null;
    speed?: number | null;
    bearing?: number | null;
    timestamp?: number;
    satellites?: number;
    provider?: string;
  }) => void;
  updateCompass: (heading: number, mils: number, accuracy?: number) => void;
  updateCompassData: (data: {
    heading: number;
    trueHeading?: number;
    magneticHeading?: number;
    declination?: number;
    mils: number;
    accuracy?: number;
    sensorType?: string;
    pitch?: number;
    roll?: number;
  }) => void;
  setCompassNorthMode: (mode: 'TRUE' | 'MAGNETIC') => void;
  setCompassTrimOffset: (offset: number) => void;
  setCallsign: (callsign: string) => void;
  setIsLeader: (isLeader: boolean) => void;
  claimLeadership: () => { success: boolean; reason?: string };
  abdicateLeadership: () => void;
  setDistanceUnit: (unit: 'MI' | 'KM') => void;
  setCoordFormat: (format: 'MGRS' | 'DMS' | 'DECIMAL') => void;
  setGpsIntervalMs: (ms: number) => void;
  setActiveTransport: (transport: 'NEARBY_CONNECTIONS' | 'WIFI_DIRECT' | 'LOCAL_HOTSPOT') => void;
  toggleLocationSharing: () => void;
  toggleNightMode: () => void;
  toggleGrid: () => void;
  toggleDrawing: () => void;
  addDrawingPoint: (pt: { lat: number; lon: number }) => void;
  undoDrawingPoint: () => void;
  clearDrawing: () => void;
  addDrawing: (drawing: TacticalDrawing) => void;
  removeDrawing: (id: string) => void;
  clearAllDrawings: () => void;
  toggleSquadTracking: () => void;
  setMapStyle: (style: 'satellite' | 'topo') => void;
  setDrawerOpen: (open: boolean) => void;
  setActiveModal: (modal: TacticalState['activeModal']) => void;
  addWaypoint: (wp: Omit<TacticalWaypoint, 'id' | 'createdAt'>) => void;
  removeWaypoint: (id: string) => void;
  applyRemoteTombstones: (waypointIds: string[], drawingIds: string[]) => void;
  setClusterLeader: (leaderCallsign: string | null) => void;
  updateSquadMember: (member: SquadMember) => void;
  markSquadMemberDisconnected: (callsignOrId: string) => void;
  markAllSquadDisconnected: () => void;
  renameSquadMember: (oldCallsign: string, newCallsign: string) => void;
  pruneStaleSquadMembers: (staleMs?: number) => void;
  removeSquadMember: (id: string) => void;
  triggerSOS: (active: boolean) => void;
  setSelectedTarget: (target: { lat: number; lon: number; name?: string } | null) => void;
  clearLocalData: () => void;
}

const MAX_TOMBSTONES = 200;

function recordTombstones(existing: Record<string, number>, ids: string[]): Record<string, number> {
  if (ids.length === 0) return existing;
  const now = Date.now();
  const next: Record<string, number> = { ...existing };
  for (const id of ids) {
    if (id) next[id] = now;
  }
  const keys = Object.keys(next);
  if (keys.length > MAX_TOMBSTONES) {
    keys.sort((a, b) => next[a] - next[b]);
    const excess = keys.length - MAX_TOMBSTONES;
    for (let i = 0; i < excess; i++) {
      delete next[keys[i]];
    }
  }
  return next;
}

export const useTacticalStore = create<TacticalState>()(
  persist(
    (set, get) => ({
      // Real GPS state (defaults to unacquired 0,0 until native GPS fix is delivered)
      lat: 0,
      lon: 0,
      altitudeM: 0,
      hasAltitudeFix: false,
      accuracyM: 0,
      speedKmh: 0,
      gpsBearing: 0,
      hasGpsFix: false,
      gpsTimestamp: 0,
      satellitesCount: 0,
      locationProvider: 'unknown',

      compassHeading: 0,
      compassTrueHeading: 0,
      compassMagneticHeading: 0,
      compassDeclination: 0,
      compassMils: 0,
      compassAccuracy: 3,
      compassSensorType: 'INITIALIZING',
      compassPitch: 0,
      compassRoll: 0,
      compassNorthMode: 'TRUE',
      compassTrimOffset: 0,

      callsign: 'OPERATOR-' + Math.floor(100 + Math.random() * 900),
      isLeader: false,
      clusterLeaderCallsign: null,
      isLocationSharing: true,
      distanceUnit: 'KM',
      coordFormat: 'DECIMAL',
      gpsIntervalMs: 1000,
      activeTransport: 'NEARBY_CONNECTIONS',

      isNightMode: false,
      isGridVisible: true,
      isDrawingActive: false,
      isSquadTrackingActive: true,
      mapStyle: 'satellite',
      isDrawerOpen: false,
      activeModal: null,

      // Offline Tile Cache Tracking
      tileCacheStatus: 'cached',
      cachedTilesCount: 0,
      setTileCacheStatus: (status) =>
        set((state) => (state.tileCacheStatus === status ? state : { tileCacheStatus: status })),
      incrementCachedTilesCount: (delta = 1) =>
        set((state) => ({ cachedTilesCount: state.cachedTilesCount + delta })),

      // Empty collections (no fake screenshot data)
      squadMembers: [],
      waypoints: [],
      drawings: [],
      deletedWaypointIds: {},
      deletedDrawingIds: {},
      overlays: [],
      drawingPoints: [],
      activeSOS: null,
      selectedTarget: null,

      updatePosition: (pos) => {
        const lat = pos.latitude;
        const lon = pos.longitude;
        const hasAlt = pos.altitude !== null && pos.altitude !== undefined;
        const alt = hasAlt ? pos.altitude! : get().altitudeM;
        const acc = pos.accuracy ?? get().accuracyM;
        const prevLat = get().lat;
        const prevLon = get().lon;
        const prevTime = get().gpsTimestamp;
        const nowTime = pos.timestamp || Date.now();
        const dtSeconds = prevTime > 0 ? (nowTime - prevTime) / 1000 : 0;

        let rawSpeed: number;
        if (pos.speed !== null && pos.speed !== undefined) {
          // Hardware GNSS Doppler or Fused speed (m/s -> km/h)
          rawSpeed = Math.round(pos.speed * 3.6);
        } else if (dtSeconds >= 0.8 && dtSeconds <= 10 && prevLat !== 0 && prevLon !== 0) {
          // Fallback speed from displacement over time when hardware speed is unavailable
          const distKm = calculateDistanceKm(prevLat, prevLon, lat, lon);
          if (distKm * 1000 >= 1.5) {
            rawSpeed = Math.round((distKm / dtSeconds) * 3600);
          } else {
            rawSpeed = 0;
          }
        } else {
          rawSpeed = 0;
        }

        // Suppress stationary indoor GPS jitter (under 1.2 km/h is noise)
        const speed = rawSpeed < 1.2 ? 0 : rawSpeed;
        const bearing = pos.bearing ?? get().gpsBearing;

        set({
          lat,
          lon,
          altitudeM: alt,
          hasAltitudeFix: hasAlt || (get().hasAltitudeFix && get().altitudeM !== 0),
          accuracyM: acc,
          speedKmh: speed,
          gpsBearing: bearing,
          hasGpsFix: true,
          gpsTimestamp: pos.timestamp || Date.now(),
          satellitesCount: pos.satellites ?? get().satellitesCount,
          locationProvider: pos.provider ?? get().locationProvider,
        });
      },

      updateCompass: (heading, mils, accuracy = 3) => {
        set({
          compassHeading: heading,
          compassMils: mils,
          compassAccuracy: accuracy,
        });
      },

      updateCompassData: (data) => {
        set({
          compassHeading: data.heading,
          compassTrueHeading: data.trueHeading ?? data.heading,
          compassMagneticHeading: data.magneticHeading ?? data.heading,
          compassDeclination: data.declination ?? 0,
          compassMils: data.mils,
          compassAccuracy: data.accuracy ?? 3,
          compassSensorType: data.sensorType ?? get().compassSensorType,
          compassPitch: data.pitch ?? get().compassPitch,
          compassRoll: data.roll ?? get().compassRoll,
        });
      },

      setCompassNorthMode: (compassNorthMode) => set({ compassNorthMode }),
      setCompassTrimOffset: (compassTrimOffset) => set({ compassTrimOffset }),

      setCallsign: (callsign) => set({ callsign }),
      setIsLeader: (isLeader) => set({ isLeader }),
      setDistanceUnit: (distanceUnit) => set({ distanceUnit }),
      setCoordFormat: (coordFormat) => set({ coordFormat }),
      setGpsIntervalMs: (gpsIntervalMs) => set({ gpsIntervalMs }),
      setActiveTransport: (activeTransport) => set({ activeTransport }),
      toggleLocationSharing: () => set((state) => ({ isLocationSharing: !state.isLocationSharing })),
      toggleNightMode: () => set((state) => ({ isNightMode: !state.isNightMode })),
      toggleGrid: () => set((state) => ({ isGridVisible: !state.isGridVisible })),
      toggleDrawing: () => set((state) => ({ isDrawingActive: !state.isDrawingActive })),
      addDrawingPoint: (pt) => set((state) => ({ drawingPoints: [...state.drawingPoints, pt] })),
      undoDrawingPoint: () => set((state) => ({ drawingPoints: state.drawingPoints.slice(0, -1) })),
      clearDrawing: () => set({ drawingPoints: [] }),
      addDrawing: (drawing) => set((state) => {
        if (state.deletedDrawingIds[drawing.id]) return state;
        const idx = state.drawings.findIndex((d) => d.id === drawing.id);
        if (idx >= 0) {
          const copy = [...state.drawings];
          copy[idx] = drawing;
          return { drawings: copy };
        }
        return { drawings: [...state.drawings, drawing] };
      }),
      removeDrawing: (id) => set((state) => ({
        drawings: state.drawings.filter((d) => d.id !== id),
        deletedDrawingIds: recordTombstones(state.deletedDrawingIds, [id]),
      })),
      clearAllDrawings: () => set((state) => ({
        drawings: [],
        drawingPoints: [],
        deletedDrawingIds: recordTombstones(
          state.deletedDrawingIds,
          state.drawings.map((d) => d.id)
        ),
      })),
      toggleSquadTracking: () => set((state) => ({ isSquadTrackingActive: !state.isSquadTrackingActive })),
      setMapStyle: (style) => set({ mapStyle: style }),
      setDrawerOpen: (isDrawerOpen) => set({ isDrawerOpen }),
      setActiveModal: (activeModal) => set({ activeModal }),

      addWaypoint: (wp) => set((state) => {
        const wpId = (wp as any).id || 'wp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
        // Prevent duplicate or zombie-resurrected waypoint IDs
        if (state.deletedWaypointIds[wpId] || state.waypoints.some((w) => w.id === wpId)) {
          return state;
        }
        return {
          waypoints: [
            ...state.waypoints,
            {
              ...wp,
              id: wpId,
              createdAt: (wp as any).createdAt || Date.now(),
              createdBy: wp.createdBy || state.callsign,
            }
          ]
        };
      }),

      removeWaypoint: (id) => set((state) => ({
        waypoints: state.waypoints.filter((w) => w.id !== id),
        deletedWaypointIds: recordTombstones(state.deletedWaypointIds, [id]),
      })),

      applyRemoteTombstones: (waypointIds, drawingIds) => set((state) => {
        const wpSet = new Set(waypointIds);
        const drSet = new Set(drawingIds);
        const nextWaypoints = wpSet.size > 0 ? state.waypoints.filter((w) => !wpSet.has(w.id)) : state.waypoints;
        const nextDrawings = drSet.size > 0 ? state.drawings.filter((d) => !drSet.has(d.id)) : state.drawings;
        return {
          waypoints: nextWaypoints,
          drawings: nextDrawings,
          deletedWaypointIds: wpSet.size > 0 ? recordTombstones(state.deletedWaypointIds, waypointIds) : state.deletedWaypointIds,
          deletedDrawingIds: drSet.size > 0 ? recordTombstones(state.deletedDrawingIds, drawingIds) : state.deletedDrawingIds,
        };
      }),

      claimLeadership: () => {
        const state = get();
        if (state.clusterLeaderCallsign && state.clusterLeaderCallsign !== state.callsign) {
          return {
            success: false,
            reason: `Cluster leadership is currently held by ${state.clusterLeaderCallsign}. Leadership must be relinquished by the current leader.`,
          };
        }
        const updatedSquad = state.squadMembers.map((m) => ({
          ...m,
          isLeader: false,
        }));
        set({ isLeader: true, clusterLeaderCallsign: state.callsign, squadMembers: updatedSquad });
        return { success: true };
      },

      abdicateLeadership: () => {
        set((state) => ({
          isLeader: false,
          clusterLeaderCallsign: null,
          squadMembers: state.squadMembers.map((m) => ({ ...m, isLeader: false })),
        }));
      },

      setClusterLeader: (leaderCallsign) => set((state) => {
        const isLeader = leaderCallsign ? leaderCallsign === state.callsign : false;
        const updatedSquad = state.squadMembers.map((m) => ({
          ...m,
          isLeader: leaderCallsign ? m.callsign === leaderCallsign : false,
        }));
        return {
          clusterLeaderCallsign: leaderCallsign,
          isLeader,
          squadMembers: updatedSquad,
        };
      }),

      updateSquadMember: (member) => set((state) => {
        if (member.callsign === state.callsign) return state;

        const myLat = state.lat;
        const myLon = state.lon;

        // Prefer exact hardware nodeId match; only match by callsign if neither record is keyed by NODE-
        const isIncomingNodeKeyed = member.id.startsWith('NODE-');
        const idx = state.squadMembers.findIndex((m) => {
          if (m.id === member.id) return true;
          if (!isIncomingNodeKeyed || !m.id.startsWith('NODE-')) {
            return m.callsign === member.callsign;
          }
          return false;
        });
        let finalLat = member.lat;
        let finalLon = member.lon;
        let finalAlt = member.alt;

        if ((finalLat === 0 && finalLon === 0) && idx >= 0) {
          const prev = state.squadMembers[idx];
          if (prev.lat !== 0 || prev.lon !== 0) {
            finalLat = prev.lat;
            finalLon = prev.lon;
            finalAlt = prev.alt;
          }
        }

        const isMemberAcquiring = finalLat === 0 && finalLon === 0;
        const distanceKm = (state.hasGpsFix && !isMemberAcquiring)
          ? calculateDistanceKm(myLat, myLon, finalLat, finalLon)
          : undefined;
        const bearing = (state.hasGpsFix && !isMemberAcquiring)
          ? calculateBearing(myLat, myLon, finalLat, finalLon)
          : undefined;

        const updatedMember: SquadMember = {
          ...member,
          lat: finalLat,
          lon: finalLon,
          alt: finalAlt,
          distanceKm,
          bearing,
          accuracy: member.accuracy !== undefined ? member.accuracy : (idx >= 0 ? state.squadMembers[idx].accuracy : undefined),
          fixType: member.fixType || (idx >= 0 ? state.squadMembers[idx].fixType : 'GNSS_3D'),
        };

        let clusterLeaderCallsign = state.clusterLeaderCallsign;
        if (member.isLeader) {
          clusterLeaderCallsign = member.callsign;
        } else if (state.clusterLeaderCallsign === member.callsign && member.isLeader === false) {
          // If this member previously held leadership and has now abdicated, unlock cluster
          clusterLeaderCallsign = null;
        }

        if (idx >= 0) {
          const copy = [...state.squadMembers];
          copy[idx] = updatedMember;
          return { squadMembers: copy, clusterLeaderCallsign };
        }
        return { squadMembers: [...state.squadMembers, updatedMember], clusterLeaderCallsign };
      }),

      removeSquadMember: (id) => set((state) => {
        const memberToRemove = state.squadMembers.find((m) => m.id === id);
        const isLeaderLeaving = state.clusterLeaderCallsign && (
          state.clusterLeaderCallsign === id ||
          (memberToRemove && memberToRemove.callsign === state.clusterLeaderCallsign)
        );
        return {
          squadMembers: state.squadMembers.filter((m) => m.id !== id),
          clusterLeaderCallsign: isLeaderLeaving ? null : state.clusterLeaderCallsign,
        };
      }),

      markSquadMemberDisconnected: (callsignOrId) => set((state) => {
        if (!callsignOrId) return state;
        let changed = false;
        const nextMembers = state.squadMembers.map((m) => {
          if ((m.id === callsignOrId || m.callsign === callsignOrId) && m.status !== 'DISCONNECTED') {
            changed = true;
            return { ...m, status: 'DISCONNECTED' as const };
          }
          return m;
        });
        return changed ? { squadMembers: nextMembers } : state;
      }),

      markAllSquadDisconnected: () => set((state) => {
        let changed = false;
        const nextMembers = state.squadMembers.map((m) => {
          if (m.status !== 'DISCONNECTED') {
            changed = true;
            return { ...m, status: 'DISCONNECTED' as const };
          }
          return m;
        });
        return changed ? { squadMembers: nextMembers } : state;
      }),

      renameSquadMember: (oldCallsign, newCallsign) => set((state) => {
        if (!oldCallsign || !newCallsign || oldCallsign === newCallsign) return state;
        let changed = false;
        const nextMembers = state.squadMembers.map((m) => {
          if (m.callsign === oldCallsign || m.id === oldCallsign) {
            changed = true;
            const nextId = m.id.startsWith('NODE-') ? m.id : newCallsign;
            return { ...m, id: nextId, callsign: newCallsign };
          }
          return m;
        });
        const nextLeader = state.clusterLeaderCallsign === oldCallsign ? newCallsign : state.clusterLeaderCallsign;
        return changed || nextLeader !== state.clusterLeaderCallsign
          ? { squadMembers: nextMembers, clusterLeaderCallsign: nextLeader }
          : state;
      }),

      pruneStaleSquadMembers: (staleMs = 20000) => set((state) => {
        const now = Date.now();
        let changed = false;
        const nextMembers = state.squadMembers.map((m) => {
          if (m.status === 'CONNECTED' && m.lastSeen > 0 && now - m.lastSeen > staleMs) {
            changed = true;
            return { ...m, status: 'DISCONNECTED' as const };
          }
          return m;
        });
        return changed ? { squadMembers: nextMembers } : state;
      }),

      triggerSOS: (active) => set((state) => {
        if (active) {
          return {
            activeSOS: {
              callsign: state.callsign,
              lat: state.lat,
              lon: state.lon,
              timestamp: Date.now(),
            }
          };
        }
        return { activeSOS: null };
      }),

      setSelectedTarget: (selectedTarget) => set({ selectedTarget }),

      clearLocalData: () => set({
        waypoints: [],
        drawings: [],
        deletedWaypointIds: {},
        deletedDrawingIds: {},
        selectedTarget: null,
        overlays: [],
        squadMembers: [],
        drawingPoints: [],
      }),
    }),
    {
      name: 'fieldlink-tactical-store',
      storage: safeStorage,
      version: 6,
      migrate: (persistedState: any, _version: number) => {
        const state = persistedState || {};
        if (!state.distanceUnit) state.distanceUnit = 'KM';
        if (!state.coordFormat) state.coordFormat = 'DECIMAL';
        if (state.isGridVisible === undefined) state.isGridVisible = true;
        if (!state.compassNorthMode) state.compassNorthMode = 'TRUE';
        if (state.compassTrimOffset === undefined) state.compassTrimOffset = 0;
        if (state.cachedTilesCount === undefined) state.cachedTilesCount = 0;
        if (!Array.isArray(state.drawingPoints)) state.drawingPoints = [];
        if (!Array.isArray(state.overlays)) state.overlays = [];
        if (!state.deletedWaypointIds || typeof state.deletedWaypointIds !== 'object') state.deletedWaypointIds = {};
        if (!state.deletedDrawingIds || typeof state.deletedDrawingIds !== 'object') state.deletedDrawingIds = {};
        // Rehydrate recent (< 30 min) last-known location so beacon & map render immediately on launch
        const ageMs = state.gpsTimestamp ? Date.now() - state.gpsTimestamp : Infinity;
        if ((state.lat || state.lon) && ageMs >= 0 && ageMs < 30 * 60 * 1000) {
          state.hasGpsFix = true;
        }
        return state;
      },
      partialize: (state) => ({
        lat: state.lat,
        lon: state.lon,
        altitudeM: state.altitudeM,
        hasAltitudeFix: state.hasAltitudeFix,
        accuracyM: state.accuracyM,
        gpsTimestamp: state.gpsTimestamp,
        locationProvider: state.locationProvider,
        callsign: state.callsign,
        isLeader: state.isLeader,
        clusterLeaderCallsign: state.clusterLeaderCallsign,
        distanceUnit: state.distanceUnit,
        coordFormat: state.coordFormat,
        gpsIntervalMs: state.gpsIntervalMs,
        waypoints: state.waypoints,
        deletedWaypointIds: state.deletedWaypointIds,
        deletedDrawingIds: state.deletedDrawingIds,
        isNightMode: state.isNightMode,
        isGridVisible: state.isGridVisible,
        mapStyle: state.mapStyle,
        compassNorthMode: state.compassNorthMode,
        compassTrimOffset: state.compassTrimOffset,
        cachedTilesCount: state.cachedTilesCount,
        drawingPoints: state.drawingPoints,
        overlays: state.overlays,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && (state.lat !== 0 || state.lon !== 0)) {
          const ageMs = state.gpsTimestamp ? Date.now() - state.gpsTimestamp : Infinity;
          if (ageMs >= 0 && ageMs < 30 * 60 * 1000) {
            state.hasGpsFix = true;
          }
        }
      },
    }
  )
);
