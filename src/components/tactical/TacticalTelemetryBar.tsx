import React, { useState, useEffect, useRef } from 'react';
import { Navigation2, Radio } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { formatDMS, formatCoordinateString, calculateDistanceKm, getShortestRotation } from '../../utils/coordinates';
import { FieldlinkLocationService } from '../../services/native/FieldlinkLocation';

export const TacticalTelemetryBar: React.FC = () => {
  const {
    lat,
    lon,
    altitudeM,
    hasAltitudeFix,
    accuracyM,
    speedKmh,
    compassHeading,
    hasGpsFix,
    selectedTarget,
    isNightMode,
    isLocationSharing,
    activeTransport,
    distanceUnit,
    coordFormat,
    setCoordFormat,
    satellitesCount,
    locationProvider,
    updatePosition,
  } = useTacticalStore();

  const [timeStr, setTimeStr] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Smooth unwrapped rotation for heading icon to prevent 360° spin at 0°/North
  const headingElRef = useRef<HTMLDivElement>(null);
  const cumulativeHeadingRef = useRef<number>(compassHeading);
  useEffect(() => {
    cumulativeHeadingRef.current = getShortestRotation(cumulativeHeadingRef.current, compassHeading);
    if (headingElRef.current) {
      headingElRef.current.style.transform = `rotate(${cumulativeHeadingRef.current}deg)`;
    }
  }, [compassHeading]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshFix = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const status = await FieldlinkLocationService.checkStatus();
      if (!status.gpsEnabled && !status.networkEnabled) {
        await FieldlinkLocationService.openSettings();
      } else {
        const pos = await FieldlinkLocationService.getCurrentPosition();
        updatePosition(pos);
      }
    } catch (e) {
      console.warn('Manual GPS sync:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const cycleCoordFormat = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = coordFormat === 'MGRS' ? 'DMS' : coordFormat === 'DMS' ? 'DECIMAL' : 'MGRS';
    setCoordFormat(next);
  };

  const formattedCoordString = hasGpsFix && (lat !== 0 || lon !== 0)
    ? formatCoordinateString(lat, lon, coordFormat)
    : (isRefreshing ? 'SYNCING FIX...' : 'ACQUIRING 3D FIX');

  // Target distance calculation in Metric (KM / M)
  const targetDistKm = hasGpsFix && selectedTarget
    ? calculateDistanceKm(lat, lon, selectedTarget.lat, selectedTarget.lon)
    : 0;

  const getCardinal = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(deg / 45) % 8];
  };

  // Accurate GNSS vs NLP / Indoor fix determination
  const isGnss3D = hasGpsFix && (satellitesCount >= 4 || (accuracyM > 0 && accuracyM <= 15 && hasAltitudeFix));
  const isWifiNlp = hasGpsFix && !isGnss3D && accuracyM > 0 && accuracyM <= 35;

  let fixInfoText = isRefreshing ? 'SYNCING PROVIDERS...' : 'SATELLITES: SEARCHING...';
  let fixBadgeText = '○ NO FIX';
  let fixBadgeClass = 'text-amber-400 font-bold';

  if (hasGpsFix && (lat !== 0 || lon !== 0)) {
    if (isGnss3D) {
      fixInfoText = satellitesCount > 0
        ? `SATS: ${satellitesCount} LOCKED • ±${Math.round(accuracyM)}M`
        : `GNSS LOCK • ±${Math.round(accuracyM)}M`;
      fixBadgeText = '● 3D GNSS';
      fixBadgeClass = 'text-emerald-400 font-bold';
    } else if (isWifiNlp || locationProvider === 'network' || locationProvider === 'fused') {
      if (accuracyM > 0 && accuracyM <= 35) {
        fixInfoText = `INDOOR: WI-FI NLP • ±${Math.round(accuracyM)}M`;
        fixBadgeText = '◉ WI-FI 2D';
        fixBadgeClass = 'text-cyan-400 font-bold';
      } else {
        fixInfoText = `INDOOR: CELL TOWER • ±${Math.round(accuracyM)}M`;
        fixBadgeText = '◐ CELL 2D';
        fixBadgeClass = 'text-sky-400 font-bold';
      }
    } else {
      fixInfoText = `INDOOR: ${locationProvider.toUpperCase()} • ±${Math.round(accuracyM)}M`;
      fixBadgeText = '◐ 2D FIX';
      fixBadgeClass = 'text-sky-400 font-bold';
    }
  }

  return (
    <footer className="w-full select-none z-30 safe-bottom">
      {/* Upper Segment Strip (Dark Translucent Bar from Reference) */}
      <div
        className={`h-6 px-2 flex items-center justify-between border-t text-[9.5px] font-mono-tactical font-semibold tracking-normal ${
          isNightMode
            ? 'bg-[#1b0a0a]/95 border-[#4a1212] text-red-300'
            : 'bg-[#121814]/95 border-[#1e2a20] text-slate-300'
        }`}
      >
        {/* Left: Real Distance to selected target */}
        <div className="flex-[1.1] text-center truncate">
          <span className="text-slate-400">TARGET: </span>
          <span className="font-bold text-white">
            {hasGpsFix && selectedTarget
              ? distanceUnit === 'MI'
                ? targetDistKm * 0.621371 < 0.2
                  ? `${Math.round(targetDistKm * 3280.84)} FT`
                  : `${(targetDistKm * 0.621371).toFixed(2)} MI`
                : targetDistKm < 1
                ? `${Math.round(targetDistKm * 1000)} M`
                : `${targetDistKm.toFixed(2)} KM`
              : `TAP MAP (${distanceUnit})`}
          </span>
        </div>

        <div className="w-[1px] h-3.5 bg-[#2a382e]" />

        {/* Center: Real Heading & Direction */}
        <div className="flex-[0.9] text-center truncate">
          <span className="font-bold text-white">
            HEADING {Math.round(compassHeading)}° {getCardinal(compassHeading)}
          </span>
        </div>

        <div className="w-[1px] h-3.5 bg-[#2a382e]" />

        {/* Right: Real Altitude & Speed (Metric / Imperial Adaptive) */}
        <div className="flex-[1.15] text-center truncate">
          <span className="text-slate-400">ALT: </span>
          <span className="font-bold text-white">
            {hasAltitudeFix ? `${Math.round(altitudeM)}M` : `---`}
          </span>
          <span className="text-slate-400 ml-1">SPD: </span>
          <span className="font-bold text-cyan-300">
            {distanceUnit === 'MI' ? `${Math.round(speedKmh * 0.621371)} MPH` : `${speedKmh} KM/H`}
          </span>
        </div>
      </div>

      {/* Main Coordinate Block (Theme & Layout from Reference, Real Telemetry) */}
      <div
        className={`w-full max-w-full overflow-hidden px-2 py-1.5 flex items-center justify-between gap-2 border-t ${
          isNightMode
            ? 'bg-[#0a0303] border-[#4a1212]'
            : 'bg-[#050806] border-[#1b251e]'
        }`}
      >
        {/* Left Teal / Cyan Tactical Pill */}
        <div
          onClick={handleRefreshFix}
          className={`shrink-0 rounded px-2.5 py-1.5 flex items-center gap-2 border shadow-inner cursor-pointer active:scale-[0.98] transition-transform ${
            isNightMode
              ? 'bg-[#3b1212] border-[#701e1e] text-red-200'
              : 'bg-[#084c57] border-[#0c6b7a] text-cyan-100'
          }`}
          title="Tap to refresh GPS fix or check location status"
        >
          {/* Real Tactical Heading Arrow (Resting at 0° True North, perfectly locked & centered in box) */}
          <div className="w-5 h-5 rounded bg-black/40 flex items-center justify-center flex-shrink-0 relative overflow-hidden">
            <div
              ref={headingElRef}
              className="w-3.5 h-3.5 flex items-center justify-center transition-transform duration-150 ease-out will-change-transform"
              style={{
                transformOrigin: '50% 50%',
              }}
            >
              <Navigation2 className="w-full h-full text-cyan-300 fill-cyan-300/30" />
            </div>
          </div>

          <div className="flex flex-col leading-none justify-center">
            {coordFormat === 'DMS' ? (
              <>
                <div className="text-[9.5px] font-mono-tactical font-black text-cyan-200 tracking-tight whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? formatDMS(lat, true) : (isRefreshing ? 'SYNCING...' : 'SEARCHING...')}
                </div>
                <div className="text-[9.5px] font-mono-tactical font-black text-white tracking-tight mt-1 whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? formatDMS(lon, false) : 'POSITION'}
                </div>
              </>
            ) : coordFormat === 'DECIMAL' ? (
              <>
                <div className="text-[10px] font-mono-tactical font-black text-cyan-200 tracking-tight whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? `LAT: ${lat.toFixed(5)}°` : (isRefreshing ? 'SYNCING...' : 'SEARCHING...')}
                </div>
                <div className="text-[10px] font-mono-tactical font-black text-white tracking-tight mt-1 whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? `LON: ${lon.toFixed(5)}°` : 'POSITION'}
                </div>
              </>
            ) : (
              <>
                <div className="text-[10px] font-mono-tactical font-black text-cyan-200 tracking-tight whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? `LAT: ${lat.toFixed(5)}° N` : (isRefreshing ? 'SYNCING...' : 'SEARCHING...')}
                </div>
                <div className="text-[10px] font-mono-tactical font-black text-white tracking-tight mt-1 whitespace-nowrap">
                  {hasGpsFix && (lat !== 0 || lon !== 0) ? `LON: ${lon.toFixed(5)}° E` : 'POSITION'}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Telemetry Block */}
        <div
          onClick={handleRefreshFix}
          className="flex-1 min-w-0 flex flex-col justify-center pr-1 text-right font-mono-tactical cursor-pointer"
        >
          <div className="truncate text-slate-200 font-bold text-[10px] leading-tight tracking-tight flex items-center justify-end gap-1">
            <span className="text-slate-400">{coordFormat}:</span>
            <span className="text-white font-extrabold truncate">{hasGpsFix ? formattedCoordString : '---'}</span>
            <button
              onClick={cycleCoordFormat}
              className="ml-1 px-1 py-0.5 rounded bg-[#0b2826] hover:bg-[#12403d] border border-cyan-500/50 text-[8px] font-black text-[#35D5D9] active:scale-90 transition-transform"
              title="Tap to cycle coordinate format (MGRS ⇄ DMS ⇄ DECIMAL)"
            >
              ⇄
            </button>
          </div>
          <div className="truncate text-[#D1A34A] font-extrabold text-[10px] leading-tight mt-0.5 tracking-tight">
            HEADING: {Math.round(compassHeading)}° {getCardinal(compassHeading)}
          </div>
          <div className="truncate text-slate-400 text-[9px] leading-tight mt-0.5 tracking-tight">
            {hasGpsFix && (lat !== 0 || lon !== 0)
              ? (hasAltitudeFix
                  ? `ELEV: ${Math.round(altitudeM)}M • ${timeStr}`
                  : `ELEV: ACQUIRING... • ${timeStr}`)
              : `${timeStr} • NO FIX`}
          </div>
        </div>
      </div>

      {/* Operational Comms Sub-strip */}
      <div
        className={`px-3 py-1 flex items-center justify-between border-t text-[9px] font-mono-tactical ${
          isNightMode
            ? 'bg-[#0f0404] border-[#380e0e] text-red-400'
            : 'bg-[#060a07] border-[#162018] text-slate-400'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Radio className={`w-3 h-3 ${isLocationSharing ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <span>
            {activeTransport === 'NEARBY_CONNECTIONS' ? 'P2P MESH' : activeTransport === 'WIFI_DIRECT' ? 'WI-FI DIRECT' : 'LOCAL AP'}: {isLocationSharing ? 'ACTIVE' : 'SILENT'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>{fixInfoText}</span>
          <span className={fixBadgeClass}>
            {fixBadgeText}
          </span>
        </div>
      </div>
    </footer>
  );
};
