import React from 'react';
import { Compass, RotateCcw, Sliders } from 'lucide-react';
import { useTacticalStore } from '../../../store/useTacticalStore';
import { FieldlinkCompassService } from '../../../services/native/FieldlinkCompass';

export const CompassCalModal: React.FC = () => {
  const {
    compassHeading,
    compassTrueHeading,
    compassMagneticHeading,
    compassDeclination,
    compassMils,
    compassAccuracy,
    compassSensorType,
    compassPitch,
    compassRoll,
    compassNorthMode,
    setCompassNorthMode,
    compassTrimOffset,
    setCompassTrimOffset,
    speedKmh,
    gpsBearing,
    altitudeM,
    setActiveModal,
  } = useTacticalStore();

  return (
    <div className="space-y-2.5 font-mono-tactical">
      {/* North Orientation Mode Selection */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
        <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-[#35D5D9]" />
            <span>Azimuth Reference</span>
          </div>
          <span className="text-[#35D5D9] font-bold">{compassNorthMode === 'TRUE' ? 'TRUE NORTH' : 'MAGNETIC'}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <button
            onClick={() => {
              setCompassNorthMode('TRUE');
              FieldlinkCompassService.setNorthMode('TRUE');
            }}
            className={`py-1.5 px-2 rounded border font-bold flex flex-col items-center gap-0.5 ${
              compassNorthMode === 'TRUE'
                ? 'bg-[#10292b] border-[#35D5D9] text-[#35D5D9]'
                : 'bg-[#101712] text-slate-400 border-[#233125] hover:text-white'
            }`}
          >
            <span className="text-[10.5px]">★ TRUE NORTH (T)</span>
            <span className="text-[8px] font-normal text-slate-400">Map / Satellite</span>
          </button>

          <button
            onClick={() => {
              setCompassNorthMode('MAGNETIC');
              FieldlinkCompassService.setNorthMode('MAGNETIC');
            }}
            className={`py-1.5 px-2 rounded border font-bold flex flex-col items-center gap-0.5 ${
              compassNorthMode === 'MAGNETIC'
                ? 'bg-[#2a2210] border-amber-400 text-amber-300'
                : 'bg-[#101712] text-slate-400 border-[#233125] hover:text-white'
            }`}
          >
            <span className="text-[10.5px]">MAGNETIC (M)</span>
            <span className="text-[8px] font-normal text-slate-400">Lensatic Needle</span>
          </button>
        </div>

        <div className="text-[9px] text-slate-400 flex items-center justify-between pt-1 border-t border-[#1b251e]">
          <span>Declination:</span>
          <span className="text-white font-bold">
            {compassDeclination !== 0 ? `${compassDeclination}° ${compassDeclination < 0 ? 'W' : 'E'}` : 'CALCULATING...'}
          </span>
        </div>
      </div>

      {/* Hardware Sensor State & Calibration Health */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
        <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
          <span>Sensor Health</span>
          <span
            className={
              compassAccuracy >= 3
                ? 'text-emerald-400 font-bold'
                : compassAccuracy === 2
                ? 'text-amber-400 font-bold'
                : 'text-red-400 font-bold animate-pulse'
            }
          >
            {compassAccuracy >= 3 ? '● HIGH ACCURACY' : compassAccuracy === 2 ? '◐ MEDIUM' : '⚠️ UNRELIABLE'}
          </span>
        </div>

        <div className="text-[9.5px] text-slate-400 flex justify-between">
          <span>
            Sensor: <span className="text-cyan-300 font-bold">{compassSensorType}</span>
          </span>
          <span className="text-emerald-400 font-bold">TILT CORRECTED</span>
        </div>

        <div className="p-2 rounded bg-[#0c130e] border border-[#233827] text-[9.5px] text-slate-300 flex items-center gap-2">
          <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" style={{ animationDuration: '6s' }} />
          <span className="text-slate-300 leading-snug">
            Calibrate: Move phone in a smooth <strong>Figure-8 (∞)</strong> motion for 5s.
          </span>
        </div>
      </div>

      {/* Manual Device Trim / Alignment Offset */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
        <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Hardware Trim</span>
          </div>
          <span className="text-amber-400 font-bold">{compassTrimOffset > 0 ? `+${compassTrimOffset}°` : `${compassTrimOffset}°`}</span>
        </div>

        <p className="text-[9px] text-slate-400 leading-tight">
          Adjust offset to synchronize heading across side-by-side devices:
        </p>

        <div className="flex gap-1 text-[10px]">
          {[-5, -1, 0, 1, 5].map((delta) => (
            <button
              key={delta}
              onClick={() => {
                const next = delta === 0 ? 0 : Math.max(-30, Math.min(30, compassTrimOffset + delta));
                setCompassTrimOffset(next);
                FieldlinkCompassService.setManualOffset(next);
              }}
              className={`flex-1 py-1.5 rounded font-bold border transition-colors ${
                delta === 0
                  ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                  : 'bg-[#121c15] border-[#25382a] text-[#9DBB72] hover:bg-[#1a2b20]'
              }`}
            >
              {delta === 0 ? 'RESET 0°' : delta > 0 ? `+${delta}°` : `${delta}°`}
            </button>
          ))}
        </div>
      </div>

      {/* Live Cross-Check Telemetry Table */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
        <div className="text-[11px] font-bold text-white uppercase">Live Telemetry</div>
        <div className="grid grid-cols-3 gap-1.5 text-[9.5px]">
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">HEADING</span>
            <span className="text-white font-black text-xs">{Math.round(compassHeading)}°</span>
          </div>
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">TRUE (T)</span>
            <span className="text-cyan-300 font-black text-xs">{Math.round(compassTrueHeading)}°</span>
          </div>
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">MAG (M)</span>
            <span className="text-amber-300 font-bold text-xs">{Math.round(compassMagneticHeading)}°</span>
          </div>
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">MILS</span>
            <span className="text-[#9DBB72] font-bold text-xs">{compassMils}m</span>
          </div>
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">SPEED</span>
            <span className="text-cyan-300 font-bold text-xs">{speedKmh} KM/H</span>
          </div>
          <div className="p-1.5 rounded bg-black/40 border border-[#1a261c] text-center">
            <span className="text-slate-400 block text-[8px]">ELEV</span>
            <span className="text-white font-bold text-xs">{Math.round(altitudeM)}M</span>
          </div>
        </div>

        <div className="text-[8.5px] text-slate-400 pt-1 flex justify-between border-t border-[#1b251e]">
          <span>
            Pitch: {Math.round(compassPitch)}° • Roll: {Math.round(compassRoll)}°
          </span>
          <span>Track: {speedKmh >= 2 ? `${Math.round(gpsBearing)}°` : 'STATIONARY'}</span>
        </div>
      </div>

      <button
        onClick={() => setActiveModal(null)}
        className="w-full py-2 rounded bg-[#203423] hover:bg-[#2b442f] border border-[#3e5e43] text-[#9DBB72] font-bold uppercase text-[10px] tracking-wider"
      >
        DONE
      </button>
    </div>
  );
};
