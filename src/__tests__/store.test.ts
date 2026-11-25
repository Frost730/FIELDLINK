import { describe, it, expect, beforeEach } from 'vitest';
import { useTacticalStore } from '../store/useTacticalStore';
import { getCallsignColor } from '../utils/coordinates';

describe('Tactical Store State Management', () => {
  beforeEach(() => {
    useTacticalStore.getState().clearLocalData();
  });

  it('updates real GPS position correctly and flags fix as active', () => {
    useTacticalStore.getState().updatePosition({
      latitude: 11.181867,
      longitude: 75.850672,
      altitude: 150,
      accuracy: 5.0,
      speed: 10,
      bearing: 180,
    });

    const state = useTacticalStore.getState();
    expect(state.hasGpsFix).toBe(true);
    expect(state.lat).toBe(11.181867);
    expect(state.lon).toBe(75.850672);
    expect(state.altitudeM).toBe(150);
    expect(state.accuracyM).toBe(5.0);
    expect(state.speedKmh).toBe(36); // 10 m/s * 3.6 = 36 km/h
    expect(state.gpsBearing).toBe(180);
  });

  it('suppresses stationary speed jitter below 1.2 km/h', () => {
    useTacticalStore.getState().updatePosition({
      latitude: 11.181867,
      longitude: 75.850672,
      speed: 0.25, // 0.25 m/s * 3.6 = 0.9 km/h (< 1.2 threshold)
    });
    expect(useTacticalStore.getState().speedKmh).toBe(0);
  });

  it('computes fallback speed from displacement when hardware speed is null', () => {
    const t0 = 1700000000000;
    useTacticalStore.getState().updatePosition({
      latitude: 11.180000,
      longitude: 75.850000,
      timestamp: t0,
    });

    // Move ~22 meters in 2 seconds (11 m/s = ~40 km/h)
    // 0.0002 deg lat ~ 22.2 m
    useTacticalStore.getState().updatePosition({
      latitude: 11.180200,
      longitude: 75.850000,
      timestamp: t0 + 2000,
    });

    const speed = useTacticalStore.getState().speedKmh;
    expect(speed).toBeGreaterThan(30);
    expect(speed).toBeLessThan(50);
  });

  it('updates compass azimuth heading and mils', () => {
    useTacticalStore.getState().updateCompass(90, 1600, 3);
    const state = useTacticalStore.getState();
    expect(state.compassHeading).toBe(90);
    expect(state.compassMils).toBe(1600);
    expect(state.compassAccuracy).toBe(3);
  });

  it('manages waypoints lifecycle (create, list, remove)', () => {
    useTacticalStore.getState().addWaypoint({
      name: 'RALLY POINT ALPHA',
      category: 'RP',
      lat: 11.185,
      lon: 75.855,
      description: 'Secondary extraction LZ',
    });

    let state = useTacticalStore.getState();
    expect(state.waypoints.length).toBe(1);
    expect(state.waypoints[0].name).toBe('RALLY POINT ALPHA');
    expect(state.waypoints[0].category).toBe('RP');

    const wpId = state.waypoints[0].id;
    useTacticalStore.getState().removeWaypoint(wpId);

    state = useTacticalStore.getState();
    expect(state.waypoints.length).toBe(0);
  });

  it('assigns unique creator attribution and distinct colors to cluster waypoints', () => {
    useTacticalStore.getState().addWaypoint({
      name: 'LZ VIPER',
      category: 'RP',
      lat: 11.182,
      lon: 75.851,
      createdBy: 'OPERATOR-301',
    });

    useTacticalStore.getState().addWaypoint({
      name: 'AMBUSH POINT',
      category: 'OBJ',
      lat: 11.183,
      lon: 75.852,
      createdBy: 'ALPHA-1',
    });

    useTacticalStore.getState().addWaypoint({
      name: 'WATER CACHE',
      category: 'H2O',
      lat: 11.184,
      lon: 75.853,
      createdBy: 'BRAVO-6',
    });

    const wps = useTacticalStore.getState().waypoints;
    expect(wps.length).toBe(3);
    expect(wps[0].createdBy).toBe('OPERATOR-301');
    expect(wps[1].createdBy).toBe('ALPHA-1');
    expect(wps[2].createdBy).toBe('BRAVO-6');

    const col0 = getCallsignColor(wps[0].createdBy);
    const col1 = getCallsignColor(wps[1].createdBy);
    const col2 = getCallsignColor(wps[2].createdBy);

    expect(col0.hex).toBeDefined();
    expect(col1.hex).toBeDefined();
    expect(col2.hex).toBeDefined();
    expect(col0.hex).not.toBe(col1.hex);
    expect(col1.hex).not.toBe(col2.hex);
  });

  it('manages squad members with real-time distance and bearing computation', () => {
    // Set user position at (0, 0)
    useTacticalStore.getState().updatePosition({
      latitude: 0,
      longitude: 0,
    });

    // Add squad peer at (1, 0) (approx 111 km North)
    useTacticalStore.getState().updateSquadMember({
      id: 'peer-01',
      callsign: 'BRAVO-02',
      lat: 1,
      lon: 0,
      status: 'CONNECTED',
      lastSeen: Date.now(),
    });

    const state = useTacticalStore.getState();
    expect(state.squadMembers.length).toBe(1);
    expect(state.squadMembers[0].callsign).toBe('BRAVO-02');
    expect(Math.round(state.squadMembers[0].distanceKm || 0)).toBe(111);
    expect(Math.round(state.squadMembers[0].bearing || 0)).toBe(0);
  });

  it('triggers and cancels active SOS distress beacon', () => {
    useTacticalStore.getState().setCallsign('VALKYRIE-1');
    useTacticalStore.getState().updatePosition({
      latitude: 11.181,
      longitude: 75.850,
    });

    useTacticalStore.getState().triggerSOS(true);
    let state = useTacticalStore.getState();
    expect(state.activeSOS).not.toBeNull();
    expect(state.activeSOS?.callsign).toBe('VALKYRIE-1');
    expect(state.activeSOS?.lat).toBe(11.181);

    useTacticalStore.getState().triggerSOS(false);
    state = useTacticalStore.getState();
    expect(state.activeSOS).toBeNull();
  });

  it('manages tactical map drawing and measurement vertices', () => {
    expect(useTacticalStore.getState().isDrawingActive).toBe(false);
    expect(useTacticalStore.getState().drawingPoints.length).toBe(0);

    useTacticalStore.getState().toggleDrawing();
    expect(useTacticalStore.getState().isDrawingActive).toBe(true);

    useTacticalStore.getState().addDrawingPoint({ lat: 11.181, lon: 75.850 });
    useTacticalStore.getState().addDrawingPoint({ lat: 11.182, lon: 75.851 });
    useTacticalStore.getState().addDrawingPoint({ lat: 11.183, lon: 75.852 });

    let state = useTacticalStore.getState();
    expect(state.drawingPoints.length).toBe(3);
    expect(state.drawingPoints[0].lat).toBe(11.181);

    useTacticalStore.getState().undoDrawingPoint();
    state = useTacticalStore.getState();
    expect(state.drawingPoints.length).toBe(2);

    useTacticalStore.getState().clearDrawing();
    state = useTacticalStore.getState();
    expect(state.drawingPoints.length).toBe(0);
  });

  it('manages cluster leadership election, locking across peers, and abdication', () => {
    // Reset callsign and cluster leader
    useTacticalStore.getState().setCallsign('DEV1');
    useTacticalStore.getState().setClusterLeader(null);
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBeNull();
    expect(useTacticalStore.getState().isLeader).toBe(false);

    // DEV1 claims leadership
    const claimRes = useTacticalStore.getState().claimLeadership();
    expect(claimRes.success).toBe(true);
    expect(useTacticalStore.getState().isLeader).toBe(true);
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBe('DEV1');

    // DEV2 connects and receives DEV1 leadership lock
    useTacticalStore.getState().setCallsign('DEV2');
    useTacticalStore.getState().setClusterLeader('DEV1');
    expect(useTacticalStore.getState().isLeader).toBe(false);
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBe('DEV1');

    // DEV2 attempts to claim leadership while locked by DEV1 -> must be rejected
    const dev2Claim = useTacticalStore.getState().claimLeadership();
    expect(dev2Claim.success).toBe(false);
    expect(dev2Claim.reason).toContain('Cluster leadership is currently held by DEV1');
    expect(useTacticalStore.getState().isLeader).toBe(false);

    // DEV3 connects and adds DEV1 to squad with isLeader = true
    useTacticalStore.getState().setCallsign('DEV3');
    useTacticalStore.getState().updateSquadMember({
      id: 'DEV1',
      callsign: 'DEV1',
      lat: 0,
      lon: 0,
      status: 'CONNECTED',
      isLeader: true,
      lastSeen: Date.now(),
    });
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBe('DEV1');
    expect(useTacticalStore.getState().squadMembers[0].isLeader).toBe(true);

    // DEV1 abdicates: updates squad member DEV1 with isLeader = false
    useTacticalStore.getState().updateSquadMember({
      id: 'DEV1',
      callsign: 'DEV1',
      lat: 0,
      lon: 0,
      status: 'CONNECTED',
      isLeader: false,
      lastSeen: Date.now(),
    });
    // Cluster leadership should now be released/unlocked
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBeNull();

    // Now DEV3 can successfully claim leadership
    const dev3Claim = useTacticalStore.getState().claimLeadership();
    expect(dev3Claim.success).toBe(true);
    expect(useTacticalStore.getState().isLeader).toBe(true);
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBe('DEV3');

    // DEV3 steps down
    useTacticalStore.getState().abdicateLeadership();
    expect(useTacticalStore.getState().isLeader).toBe(false);
    expect(useTacticalStore.getState().clusterLeaderCallsign).toBeNull();
  });

  it('handles peer disconnect, stale timeout pruning, live rename, and full clearLocalData', () => {
    const oldTs = Date.now() - 30000;
    useTacticalStore.getState().updateSquadMember({
      id: 'ALPHA-9',
      callsign: 'ALPHA-9',
      lat: 11.18,
      lon: 75.85,
      status: 'CONNECTED',
      accuracy: 90,
      fixType: 'PINNED_INDOOR',
      lastSeen: oldTs,
    });

    let member = useTacticalStore.getState().squadMembers[0];
    expect(member.accuracy).toBe(90);
    expect(member.fixType).toBe('PINNED_INDOOR');

    useTacticalStore.getState().renameSquadMember('ALPHA-9', 'RECON-9');
    expect(useTacticalStore.getState().squadMembers[0].callsign).toBe('RECON-9');

    useTacticalStore.getState().pruneStaleSquadMembers(20000);
    expect(useTacticalStore.getState().squadMembers[0].status).toBe('DISCONNECTED');

    useTacticalStore.getState().addDrawing({
      id: 'draw-1',
      createdBy: 'RECON-9',
      points: [
        { lat: 11.18, lon: 75.85 },
        { lat: 11.19, lon: 75.86 },
      ],
      createdAt: Date.now(),
    });
    expect(useTacticalStore.getState().drawings.length).toBe(1);

    useTacticalStore.getState().clearLocalData();
    expect(useTacticalStore.getState().drawings.length).toBe(0);
    expect(useTacticalStore.getState().squadMembers.length).toBe(0);
  });

  it('prevents deleted waypoint/drawing zombie resurrection via tombstones and preserves nodeId on rename', () => {
    useTacticalStore.getState().addWaypoint({
      id: 'wp-cluster-1',
      name: 'OBJ ALPHA',
      category: 'OBJ',
      lat: 11.18,
      lon: 75.85,
    } as any);
    expect(useTacticalStore.getState().waypoints.length).toBe(1);

    useTacticalStore.getState().removeWaypoint('wp-cluster-1');
    expect(useTacticalStore.getState().waypoints.length).toBe(0);

    // Re-adding the same deleted waypoint ID (e.g. from stale reconnecting peer) must be blocked
    useTacticalStore.getState().addWaypoint({
      id: 'wp-cluster-1',
      name: 'OBJ ALPHA',
      category: 'OBJ',
      lat: 11.18,
      lon: 75.85,
    } as any);
    expect(useTacticalStore.getState().waypoints.length).toBe(0);

    useTacticalStore.getState().addDrawing({
      id: 'draw-cluster-2',
      createdBy: 'BRAVO-1',
      points: [{ lat: 11.18, lon: 75.85 }],
      createdAt: Date.now(),
    });
    useTacticalStore.getState().applyRemoteTombstones([], ['draw-cluster-2']);
    expect(useTacticalStore.getState().drawings.length).toBe(0);

    useTacticalStore.getState().updateSquadMember({
      id: 'NODE-1234ABCD',
      callsign: 'VIPER-1',
      lat: 11.18,
      lon: 75.85,
      status: 'CONNECTED',
      lastSeen: Date.now(),
    });
    useTacticalStore.getState().renameSquadMember('VIPER-1', 'GHOST-1');
    expect(useTacticalStore.getState().squadMembers[0].id).toBe('NODE-1234ABCD');
    expect(useTacticalStore.getState().squadMembers[0].callsign).toBe('GHOST-1');
  });
});
