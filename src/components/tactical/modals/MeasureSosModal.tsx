import React, { useState } from 'react';
import { Pencil, AlertOctagon } from 'lucide-react';
import { useTacticalStore } from '../../../store/useTacticalStore';
import { getMGRS, calculateDistanceKm, calculateBearing } from '../../../utils/coordinates';

interface MeasureModalProps {
  formatDist: (km?: number) => string;
}

export const MeasureModal: React.FC<MeasureModalProps> = ({ formatDist }) => {
  const {
    lat,
    lon,
    selectedTarget,
    setSelectedTarget,
    drawingPoints,
    clearDrawing,
    isDrawingActive,
    toggleDrawing,
    setActiveModal,
  } = useTacticalStore();

  return (
    <div className="space-y-3">
      <div className="p-3 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
        <div className="text-[11px] font-bold text-white uppercase flex items-center gap-2">
          <Pencil className="w-4 h-4 text-[#9DBB72]" />
          <span>Tactical Range & Bearing</span>
        </div>
        {selectedTarget ? (
          <div className="text-[10px] text-slate-300 space-y-1">
            <div className="text-[#35D5D9] font-bold">{selectedTarget.name}</div>
            <div className="flex justify-between">
              <span>Coordinates:</span>
              <span className="font-bold">
                {selectedTarget.lat.toFixed(5)}, {selectedTarget.lon.toFixed(5)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Target MGRS:</span>
              <span className="text-[#9DBB72] font-bold">{getMGRS(selectedTarget.lat, selectedTarget.lon)}</span>
            </div>
            <div className="flex justify-between">
              <span>Distance From Me:</span>
              <span className="text-white font-bold">
                {formatDist(calculateDistanceKm(lat, lon, selectedTarget.lat, selectedTarget.lon))}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Compass Bearing:</span>
              <span className="text-[#D1A34A] font-bold">
                {calculateBearing(lat, lon, selectedTarget.lat, selectedTarget.lon).toFixed(1)}°
              </span>
            </div>
          </div>
        ) : (
          <div className="text-slate-400 text-[10px]">
            Tap anywhere on the tactical map to drop a crosshair measurement target.
          </div>
        )}
      </div>

      {drawingPoints.length > 0 && (
        <div className="p-3 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
          <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-[#D1A34A]" />
              <span>Drawn Route Telemetry</span>
            </span>
            <button onClick={clearDrawing} className="text-[9px] text-red-400 hover:underline uppercase font-bold">
              Clear
            </button>
          </div>
          <div className="text-[10px] text-slate-300 space-y-1">
            <div className="flex justify-between">
              <span>Vertices:</span>
              <span className="font-bold text-white">{drawingPoints.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Total Distance:</span>
              <span className="font-bold text-[#D1A34A]">
                {formatDist(
                  drawingPoints.reduce((acc, curr, idx) => {
                    if (idx === 0) return 0;
                    return acc + calculateDistanceKm(drawingPoints[idx - 1].lat, drawingPoints[idx - 1].lon, curr.lat, curr.lon);
                  }, 0)
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            toggleDrawing();
            setActiveModal(null);
          }}
          className={`flex-1 py-2 rounded border font-bold uppercase text-[10px] flex items-center justify-center gap-1.5 ${
            isDrawingActive ? 'bg-amber-600/30 border-amber-500 text-amber-300' : 'bg-[#1b2a1f] border-[#2b3d2f] text-[#9DBB72]'
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>{isDrawingActive ? 'Drawing Mode Active' : 'Start Drawing on Map'}</span>
        </button>
        {selectedTarget && (
          <button
            onClick={() => setSelectedTarget(null)}
            className="px-3 py-2 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] uppercase font-bold"
          >
            Clear Target
          </button>
        )}
      </div>
    </div>
  );
};

export const SosModal: React.FC = () => {
  const { callsign, lat, lon, triggerSOS, setActiveModal } = useTacticalStore();
  const [confirming, setConfirming] = useState(false);

  const handleSOSConfirm = () => {
    setConfirming(true);
    triggerSOS(true);
    setActiveModal(null);
  };

  return (
    <div className="p-2 space-y-3 text-center">
      <div className="w-14 h-14 mx-auto rounded-full bg-red-950 border-2 border-red-600 flex items-center justify-center animate-pulse">
        <AlertOctagon className="w-7 h-7 text-red-500" />
      </div>
      <h3 className="text-base font-black text-red-500 tracking-wider uppercase">EMERGENCY DISTRESS BEACON</h3>
      <p className="text-xs text-slate-300 leading-relaxed">
        Activating SOS transmits your exact GPS coordinates and distress beacon to all connected squad members over the offline mesh radio.
      </p>
      <div className="p-2.5 rounded bg-red-950/40 border border-red-800/60 font-mono-tactical text-left text-[11px] text-red-300 space-y-1">
        <div>
          CALLSIGN: <span className="text-white font-bold">{callsign}</span>
        </div>
        <div>
          POSITION: <span className="text-white font-bold">{getMGRS(lat, lon)}</span>
        </div>
        <div>
          COORDINATES:{' '}
          <span className="text-white font-bold">
            {lat.toFixed(6)}, {lon.toFixed(6)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => setActiveModal(null)}
          className="flex-1 py-2 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase font-bold"
        >
          CANCEL
        </button>
        <button
          onClick={handleSOSConfirm}
          disabled={confirming}
          className="flex-1 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-black tracking-wider uppercase shadow-[0_0_15px_#ef4444]"
        >
          BROADCAST SOS
        </button>
      </div>
    </div>
  );
};
