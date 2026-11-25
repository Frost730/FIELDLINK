import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { SplashScreen } from '@capacitor/splash-screen';
import { TacticalHeader } from './components/tactical/TacticalHeader';
import { TacticalToolbar } from './components/tactical/TacticalToolbar';
import { TacticalCompassWidget } from './components/tactical/TacticalCompassWidget';
import { TacticalTelemetryBar } from './components/tactical/TacticalTelemetryBar';
import { TacticalMapLibre } from './components/tactical/TacticalMapLibre';
import { TacticalDrawer } from './components/tactical/TacticalDrawer';
import { TacticalModals } from './components/tactical/TacticalModals';
import { useTacticalStore } from './store/useTacticalStore';
import { FieldlinkLocationService } from './services/native/FieldlinkLocation';
import { FieldlinkCompassService } from './services/native/FieldlinkCompass';
import { FieldlinkMeshService } from './services/native/FieldlinkNearby';
import { FieldlinkBackgroundService } from './services/native/FieldlinkBackground';
import { TransportManager } from './services/transport/TransportManager';
import { formatCoordinateShort } from './utils/coordinates';

export const App: React.FC = () => {
  const mapRef = useRef<MapLibreMap | null>(null);
  const { isNightMode, activeSOS, triggerSOS } = useTacticalStore();
  const [hudToast, setHudToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setHudToast(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setHudToast(null);
      toastTimerRef.current = null;
    }, 3000);
  };

  const handleCaptureScreenshot = async () => {
    try {
      // Wait a frame so button press highlight clears before capturing full tactical HUD
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));
      const { lat, lon, coordFormat } = useTacticalStore.getState();
      const filename = `FIELDLINK-RECON-${Date.now()}.png`;
      const res = await FieldlinkBackgroundService.captureFullScreenRecon(
        () => (mapRef.current ? mapRef.current.getCanvas().toDataURL('image/png') : null),
        filename
      );
      if (res.success) {
        showToast(`📷 RECON SAVED: Pictures/FIELDLINK (${formatCoordinateShort(lat, lon, coordFormat)})`);
      } else {
        showToast('⚠️ RECON CAPTURE FAILED');
      }
    } catch {
      showToast('⚠️ RECON CAPTURE FAILED');
    }
  };

  // Initialize Real GPS Location & Sensor Compass
  useEffect(() => {
    SplashScreen.hide().catch(() => {});
    let unwatchLocation: (() => void) | null = null;
    let unwatchCompass: (() => void) | null = null;

    // Start Automatic Multi-Transport Manager
    TransportManager.start(useTacticalStore.getState().callsign).catch(() => {});
    const unsubTransport = TransportManager.subscribe((tState) => {
      useTacticalStore.getState().setActiveTransport(tState.activeTransport);
    });

    // Start Real GPS streaming (respecting operator-configured interval)
    let activeGpsRate = useTacticalStore.getState().gpsIntervalMs || 1000;
    FieldlinkLocationService.startTracking((pos) => {
      useTacticalStore.getState().updatePosition(pos);
      if (pos.latitude && pos.longitude) {
        FieldlinkCompassService.setLocation(pos.latitude, pos.longitude, pos.altitude ?? undefined);
      }
    }, activeGpsRate).then((unwatch) => {
      unwatchLocation = unwatch;
    }).catch((err) => {
      console.warn('GPS location tracking error:', err);
    });

    // Start Real Hardware Compass streaming with True/Magnetic North & Sensor Fusion
    FieldlinkCompassService.start((headingData) => {
      useTacticalStore.getState().updateCompassData(headingData);
      useTacticalStore.getState().updateCompass(headingData.heading, headingData.mils, headingData.accuracy);
    }).then((unwatch) => {
      unwatchCompass = unwatch;
    }).catch((err) => {
      console.warn('Compass sensor streaming error:', err);
    });

    // Start Foreground Service to keep GNSS & Mesh alive when screen locks
    FieldlinkBackgroundService.startService(useTacticalStore.getState().callsign).catch(() => {});

    // Start Offline Tactical P2P Mesh for Squad Tracking
    FieldlinkMeshService.initMesh(
      useTacticalStore.getState().callsign,
      (member: any) => {
        useTacticalStore.getState().updateSquadMember(member);
      }
    ).catch((err: any) => {
      console.warn('Mesh service start error:', err);
    });

    // React immediately to GPS interval changes, callsign updates, and SOS activations/cancellations
    let lastGpsIntervalSetting = activeGpsRate;
    let lastSosActive = Boolean(useTacticalStore.getState().activeSOS);
    let lastCallsign = useTacticalStore.getState().callsign;
    const unsubStoreSync = useTacticalStore.subscribe((state) => {
      if (state.gpsIntervalMs !== lastGpsIntervalSetting) {
        lastGpsIntervalSetting = state.gpsIntervalMs;
        activeGpsRate = state.gpsIntervalMs;
        FieldlinkLocationService.setTrackingRate(state.gpsIntervalMs);
      }

      if (state.callsign !== lastCallsign) {
        lastCallsign = state.callsign;
        FieldlinkBackgroundService.startService(state.callsign).catch(() => {});
      }

      const sosNow = Boolean(state.activeSOS);
      if (sosNow !== lastSosActive) {
        lastSosActive = sosNow;
        const isGnss3D = state.hasGpsFix && (state.satellitesCount >= 4 || (state.accuracyM > 0 && state.accuracyM <= 15 && state.hasAltitudeFix && state.locationProvider !== 'network'));
        const fixType = isGnss3D ? 'GNSS_3D' : (state.accuracyM > 35 || state.locationProvider === 'network' ? 'PINNED_INDOOR' : 'WIFI_2D');
        FieldlinkMeshService.broadcastPosition(
          state.callsign,
          state.lat,
          state.lon,
          state.altitudeM,
          state.compassHeading,
          state.speedKmh,
          sosNow ? 'SOS' : 'CONNECTED',
          state.isLeader,
          state.clusterLeaderCallsign,
          state.accuracyM,
          fixType
        );
      }
    });

    // Broadcast live telemetry to connected squad peers with movement & dead-band filtering
    let lastBroadcastLat = 0;
    let lastBroadcastLon = 0;
    let lastBroadcastHeading = 0;
    let lastBroadcastTime = 0;
    let stationaryTicks = 0;
    let staleCheckTicks = 0;

    const meshBroadcastInterval = setInterval(() => {
      const state = useTacticalStore.getState();
      staleCheckTicks++;
      if (staleCheckTicks >= 5) {
        staleCheckTicks = 0;
        state.pruneStaleSquadMembers(20000);
      }
      const now = Date.now();
      const distMoved = Math.hypot(state.lat - lastBroadcastLat, state.lon - lastBroadcastLon);
      const headingDelta = Math.abs(state.compassHeading - lastBroadcastHeading);
      const timeSince = now - lastBroadcastTime;
      const baseRate = state.gpsIntervalMs || 1000;
      const stationaryRate = Math.max(3000, baseRate);

      // Adaptive Battery Throttling (PERF-06): Throttle GNSS rate when stationary
      if (state.speedKmh < 1.0 && distMoved < 0.00001) {
        stationaryTicks++;
        if (stationaryTicks >= 25 && activeGpsRate !== stationaryRate) {
          activeGpsRate = stationaryRate;
          FieldlinkLocationService.setTrackingRate(stationaryRate);
        }
      } else {
        stationaryTicks = 0;
        if (activeGpsRate !== baseRate) {
          activeGpsRate = baseRate;
          FieldlinkLocationService.setTrackingRate(baseRate);
        }
      }

      // Respect Location Sharing mute setting (always override if SOS emergency is active)
      if (!state.isLocationSharing && !state.activeSOS) {
        return;
      }

      // Broadcast if moved > ~1.2m, or turned > 6 deg, or at least every 3s as heartbeat
      if (distMoved > 0.00001 || headingDelta > 6 || timeSince >= 3000 || state.activeSOS) {
        lastBroadcastLat = state.lat;
        lastBroadcastLon = state.lon;
        lastBroadcastHeading = state.compassHeading;
        lastBroadcastTime = now;

        const isGnss3D = state.hasGpsFix && (state.satellitesCount >= 4 || (state.accuracyM > 0 && state.accuracyM <= 15 && state.hasAltitudeFix && state.locationProvider !== 'network'));
        const fixType = isGnss3D ? 'GNSS_3D' : (state.accuracyM > 35 || state.locationProvider === 'network' ? 'PINNED_INDOOR' : 'WIFI_2D');

        FieldlinkMeshService.broadcastPosition(
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
          fixType
        );
      }
    }, 1000);

    return () => {
      if (unwatchLocation) unwatchLocation();
      if (unwatchCompass) unwatchCompass();
      unsubStoreSync();
      clearInterval(meshBroadcastInterval);
      FieldlinkMeshService.stopMesh();
      unsubTransport();
      TransportManager.stop();
    };
  }, []);

  const handleCenterMap = (targetLat?: number, targetLon?: number) => {
    const lat = targetLat !== undefined ? targetLat : useTacticalStore.getState().lat;
    const lon = targetLon !== undefined ? targetLon : useTacticalStore.getState().lon;
    if (mapRef.current && (lat !== 0 || lon !== 0)) {
      mapRef.current.flyTo({ center: [lon, lat], zoom: 17.5, duration: 1000 });
      window.dispatchEvent(new CustomEvent('fieldlink:recenter'));
    }
  };

  const handleResetBearing = () => {
    if (mapRef.current) {
      mapRef.current.resetNorthPitch();
    }
  };

  const handleMapReady = useCallback((m: MapLibreMap | null) => {
    mapRef.current = m;
  }, []);

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden relative select-none ${
        isNightMode ? 'bg-[#0f0303]' : 'bg-[#050606]'
      }`}
    >
      {/* 1. Black Top Application Header */}
      <TacticalHeader />

      {/* 2. Active SOS Emergency Notification Banner */}
      {activeSOS && (
        <div className="bg-red-600 px-3 py-1.5 flex items-center justify-between text-white font-mono-tactical text-xs z-30 animate-pulse">
          <span className="font-bold tracking-wider">
            🚨 ACTIVE SOS BEACON TRANSMITTING: {activeSOS.callsign}
          </span>
          <button
            onClick={() => triggerSOS(false)}
            className="px-2 py-0.5 rounded bg-black/40 hover:bg-black/60 text-white font-bold"
          >
            CANCEL
          </button>
        </div>
      )}

      {/* Tactical HUD Notification Toast Banner */}
      {hudToast && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-fade-in">
          <div className="px-3.5 py-1.5 rounded bg-black/90 border border-[#9DBB72] text-[#9DBB72] font-mono-tactical text-[11px] font-black tracking-wide shadow-2xl flex items-center gap-2 backdrop-blur-md">
            <span>{hudToast}</span>
          </div>
        </div>
      )}

      {/* 3. Main Full-Screen Map Area (occupies 85-90% of screen) */}
      <div className="relative flex-1 w-full overflow-hidden">
        {/* Full-Screen Map Canvas */}
        <TacticalMapLibre onMapReady={handleMapReady} />

        {/* Vertical Left Tactical Toolbar (11 square buttons matching reference) */}
        <TacticalToolbar
          onCenterMap={handleCenterMap}
          onResetBearing={handleResetBearing}
          onCaptureScreenshot={handleCaptureScreenshot}
          onShowToast={showToast}
        />

        {/* Upper-Right Military Compass Dial */}
        <TacticalCompassWidget onResetNorth={handleResetBearing} />
      </div>

      {/* 4. Bottom Tactical Telemetry Panel */}
      <TacticalTelemetryBar />

      {/* Slide-out Tactical Drawer */}
      <TacticalDrawer />

      {/* Tactical Modals */}
      <TacticalModals onCenterMap={handleCenterMap} />
    </div>
  );
};

export default App;
