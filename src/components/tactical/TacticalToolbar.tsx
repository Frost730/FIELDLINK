import React, { useState } from 'react';
import {
  Crosshair,
  Database,
  Layers,
  Compass,
  Camera,
  Grid,
  Target,
  Pencil,
  MapPin,
  Moon,
  Share2,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { FieldlinkLocationService } from '../../services/native/FieldlinkLocation';
import { FieldlinkMeshService } from '../../services/native/FieldlinkNearby';
import { getMGRS } from '../../utils/coordinates';

interface TacticalToolbarProps {
  onCenterMap: (lat?: number, lon?: number) => void;
  onResetBearing: () => void;
  onCaptureScreenshot?: () => void;
  onShowToast?: (msg: string) => void;
}

export const TacticalToolbar: React.FC<TacticalToolbarProps> = ({
  onCenterMap,
  onResetBearing,
  onCaptureScreenshot,
  onShowToast,
}) => {
  const {
    isNightMode,
    toggleNightMode,
    isGridVisible,
    toggleGrid,
    isDrawingActive,
    toggleDrawing,
    mapStyle,
    setMapStyle,
    setActiveModal,
    updatePosition,
    tileCacheStatus,
  } = useTacticalStore();

  const [isRecentering, setIsRecentering] = useState(false);

  const handleCurrentLocation = async () => {
    setIsRecentering(true);
    try {
      const pos = await FieldlinkLocationService.getCurrentPosition();
      updatePosition(pos);
      onCenterMap(pos.latitude, pos.longitude);

      // Immediately broadcast fresh position to all connected squad devices
      const state = useTacticalStore.getState();
      const isGnss3D = (pos.satellites ?? state.satellitesCount) >= 4 || ((pos.accuracy ?? state.accuracyM) <= 15 && pos.altitude !== null);
      const fixType = isGnss3D ? 'GNSS_3D' : ((pos.accuracy ?? state.accuracyM) > 35 ? 'PINNED_INDOOR' : 'WIFI_2D');

      await FieldlinkMeshService.broadcastPosition(
        state.callsign,
        pos.latitude,
        pos.longitude,
        pos.altitude ?? state.altitudeM,
        state.compassHeading,
        pos.speed ?? state.speedKmh,
        state.activeSOS ? 'SOS' : 'CONNECTED',
        state.isLeader,
        state.clusterLeaderCallsign,
        pos.accuracy ?? state.accuracyM,
        fixType
      );
      if (onShowToast) onShowToast('POSITION SYNCED & BROADCAST');
    } catch {
      const state = useTacticalStore.getState();
      onCenterMap(state.lat, state.lon);
    } finally {
      setTimeout(() => setIsRecentering(false), 800);
    }
  };

  const handleLayersToggle = () => {
    const nextStyle = mapStyle === 'satellite' ? 'topo' : 'satellite';
    setMapStyle(nextStyle);
    if (onShowToast) onShowToast(`MAP LAYER: ${nextStyle.toUpperCase()}`);
  };

  const handleToggleDrawing = () => {
    toggleDrawing();
    const willBeActive = !isDrawingActive;
    if (onShowToast) {
      onShowToast(willBeActive ? 'DRAWING MODE: ARMED (TAP MAP)' : 'DRAWING MODE: STANDBY');
    }
  };

  const handleShare = async () => {
    const state = useTacticalStore.getState();
    const mgrs = getMGRS(state.lat, state.lon);
    const sitrep = `[FIELDLINK TACTICAL SITREP]\nOPERATOR: ${state.callsign}\nMGRS: ${mgrs}\nCOORDS: ${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}\nALT: ${Math.round(state.altitudeM)}M\nAZIMUTH: ${Math.round(state.compassHeading)}°\nTIMESTAMP: ${new Date().toISOString()}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `FIELDLINK SITREP - ${state.callsign}`,
          text: sitrep,
        });
        if (onShowToast) onShowToast('SITREP TRANSMITTED');
        return;
      } catch {}
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(sitrep);
        if (onShowToast) onShowToast('📋 SITREP COPIED TO CLIPBOARD');
        return;
      } catch {}
    }

    if (onShowToast) onShowToast(`SITREP: ${mgrs}`);
  };

  const buttonClass = (isActive = false, isSpecial = false) => {
    if (isNightMode) {
      return `w-9 h-9 flex items-center justify-center rounded-none border border-[#4a1212] transition-colors select-none ${
        isActive
          ? 'bg-[#821818] text-white shadow-[0_0_8px_#ff4444]'
          : 'bg-[#1b0a0a]/90 text-red-400 hover:bg-[#2e1010]'
      }`;
    }

    if (isSpecial) {
      // Button 10 in screenshot is highlighted reddish/wine
      return `w-9 h-9 flex items-center justify-center rounded-none border border-[#782828] select-none ${
        isActive ? 'bg-[#912d2d] text-white' : 'bg-[#5c2020]/90 text-red-200 hover:bg-[#782828]'
      }`;
    }

    return `w-9 h-9 flex items-center justify-center rounded-none border border-[#2b382d] select-none transition-colors ${
      isActive
        ? 'bg-[#2a452d] text-[#9DBB72] border-[#46664b] shadow-[0_0_8px_rgba(157,187,114,0.3)]'
        : 'bg-[#141b16]/90 text-slate-300 hover:bg-[#202a22] hover:text-white'
    }`;
  };

  return (
    <aside className="absolute left-2 top-14 flex flex-col gap-1 z-20 select-none shadow-2xl">
      {/* 1. Current Location */}
      <button
        onClick={handleCurrentLocation}
        className={buttonClass(isRecentering)}
        title="Current GPS Location & Broadcast to Squad"
      >
        <Crosshair className={`w-4 h-4 ${isRecentering ? 'animate-spin text-emerald-300' : ''}`} />
      </button>

      {/* 2. Offline Map Manager */}
      <button
        onClick={() => setActiveModal('offline_maps')}
        className={`${buttonClass(tileCacheStatus === 'cached')} relative`}
        title={`Offline Map Package Manager (${
          tileCacheStatus === 'cached'
            ? 'CACHED (OFFLINE READY)'
            : tileCacheStatus === 'downloading'
            ? 'CACHING TILES...'
            : 'OFFLINE GRID'
        })`}
      >
        <Database
          className={`w-4 h-4 ${
            tileCacheStatus === 'cached'
              ? 'text-emerald-400'
              : tileCacheStatus === 'downloading'
              ? 'text-cyan-400 animate-pulse'
              : ''
          }`}
        />
        {/* Real-time Status Indicator LED */}
        <span
          className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full border border-black ${
            tileCacheStatus === 'cached'
              ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
              : tileCacheStatus === 'downloading'
              ? 'bg-cyan-400 animate-ping shadow-[0_0_6px_#22d3ee]'
              : 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
          }`}
        />
      </button>

      {/* 3. Map Layers (Satellite / Topo) */}
      <button
        onClick={handleLayersToggle}
        className={buttonClass(mapStyle === 'topo')}
        title="Switch Map Layers (Satellite / Topo)"
      >
        <Layers className="w-4 h-4" />
      </button>

      {/* 4. Compass / Bearing */}
      <button
        onClick={onResetBearing}
        className={buttonClass(false)}
        title="Orient Map North"
      >
        <Compass className="w-4 h-4" />
      </button>

      {/* 5. Camera / Screenshot */}
      <button
        onClick={onCaptureScreenshot}
        className={buttonClass(false)}
        title="Recon Camera / Screenshot"
      >
        <Camera className="w-4 h-4" />
      </button>

      {/* 6. Coordinate Grid (MGRS) */}
      <button
        onClick={toggleGrid}
        className={buttonClass(isGridVisible)}
        title="Toggle MGRS Coordinate Grid"
      >
        <Grid className="w-4 h-4" />
      </button>

      {/* 7. Squad Tracking */}
      <button
        onClick={() => setActiveModal('squad')}
        className={buttonClass(false)}
        title="Squad Tracking & Offline Mesh"
      >
        <Target className="w-4 h-4" />
      </button>

      {/* 8. Draw / Measure on Map */}
      <button
        onClick={handleToggleDrawing}
        className={buttonClass(isDrawingActive)}
        title="Tactical Rangefinding & Measurement (Toggle Drawing Mode)"
      >
        <Pencil className="w-4 h-4" />
      </button>

      {/* 9. Waypoints & Markers */}
      <button
        onClick={() => setActiveModal('waypoints')}
        className={buttonClass(false)}
        title="Tactical Waypoint Catalog"
      >
        <MapPin className="w-4 h-4" />
      </button>

      {/* 10. Night Mode (Red IR Shift) */}
      <button
        onClick={toggleNightMode}
        className={buttonClass(isNightMode, true)}
        title="Toggle Night Vision / Red IR Filter"
      >
        <Moon className="w-4 h-4" />
      </button>

      {/* 11. Share Map / Export */}
      <button
        onClick={handleShare}
        className={buttonClass(false)}
        title="Share Tactical Coordinates"
      >
        <Share2 className="w-4 h-4" />
      </button>
    </aside>
  );
};
