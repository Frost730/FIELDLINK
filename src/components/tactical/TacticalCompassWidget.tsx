import React, { useEffect, useRef } from 'react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { SlidersHorizontal } from 'lucide-react';
import { getShortestRotation } from '../../utils/coordinates';

interface TacticalCompassWidgetProps {
  onResetNorth: () => void;
}

export const TacticalCompassWidget: React.FC<TacticalCompassWidgetProps> = ({ onResetNorth }) => {
  const {
    compassHeading,
    compassAccuracy,
    compassNorthMode,
    isNightMode,
    setActiveModal,
  } = useTacticalStore();

  // Smooth unwrapped rotation to prevent 360-degree spin across 0°/North
  const dialElRef = useRef<HTMLDivElement>(null);
  const cumulativeDialRef = useRef(-compassHeading);
  useEffect(() => {
    cumulativeDialRef.current = getShortestRotation(cumulativeDialRef.current, -compassHeading);
    if (dialElRef.current) {
      dialElRef.current.style.transform = `rotate(${cumulativeDialRef.current}deg)`;
    }
  }, [compassHeading]);

  const roundedHeading = Math.round(compassHeading);
  const getCardinal = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(deg / 45) % 8];
  };

  const cardinal = getCardinal(roundedHeading);

  const getAccuracyBadge = () => {
    if (compassAccuracy >= 3) {
      return <span className="text-emerald-400 font-bold" title="High Sensor Accuracy">●</span>;
    } else if (compassAccuracy === 2) {
      return <span className="text-amber-400 font-bold" title="Medium Sensor Accuracy">◐</span>;
    } else {
      return <span className="text-red-400 font-bold animate-pulse" title="Calibration Required: Tap to Calibrate">⚠️ CAL</span>;
    }
  };

  return (
    <div
      className={`absolute right-3 top-14 w-[100px] h-[116px] rounded-lg border flex flex-col items-center justify-between p-1.5 shadow-2xl select-none z-20 backdrop-blur-md transition-all ${
        isNightMode
          ? 'bg-[#150505]/95 border-[#5c1616] text-red-400'
          : 'bg-[#080d0a]/95 border-[#28382c] text-slate-200'
      }`}
    >
      {/* Top Fixed Heading Index / Lubber Line & Accuracy Dot */}
      <div className="w-full flex items-center justify-between px-1 text-[9.5px] font-mono-tactical font-black leading-none">
        <div className="flex items-center gap-1">
          <span className={isNightMode ? 'text-red-400' : 'text-[#35D5D9]'}>{cardinal}</span>
          <span className="text-[8px] px-1 py-0.2 rounded bg-black/60 text-slate-300 font-semibold">
            {compassNorthMode === 'TRUE' ? 'TRUE' : 'MAG'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-white font-bold">{roundedHeading.toString().padStart(3, '0')}°</span>
          {getAccuracyBadge()}
        </div>
      </div>

      {/* Main Rotating Compass Dial */}
      <div
        onClick={onResetNorth}
        className="relative w-[64px] h-[64px] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
        title="Tap to Reset North & Align Map"
      >
        {/* Fixed Outer Frame Indicator (Top Lubber Arrow) */}
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[5px] border-t-amber-400 z-20" />

        {/* Rotating Dial Face */}
        <div
          ref={dialElRef}
          className="w-full h-full rounded-full border border-black/60 shadow-inner relative flex items-center justify-center transition-transform duration-100 ease-out"
          style={{
            backgroundColor: isNightMode ? '#220808' : '#111913',
          }}
        >
          {/* SVG Dial with Degree Ticks & Cardinal Labels */}
          <svg className="w-full h-full absolute inset-0" viewBox="0 0 64 64">
            {/* Outer graduated bezel ring */}
            <circle cx="32" cy="32" r="30" fill="none" stroke={isNightMode ? '#471414' : '#27382b'} strokeWidth="1" />
            <circle cx="32" cy="32" r="27.5" fill="none" stroke={isNightMode ? '#330e0e' : '#1b271e'} strokeWidth="0.5" />

            {/* Ticks every 30 degrees */}
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
              const rad = ((deg - 90) * Math.PI) / 180;
              const isMajor = deg % 90 === 0;
              const rInner = isMajor ? 23 : 26;
              const rOuter = 29.5;
              const x1 = 32 + rInner * Math.cos(rad);
              const y1 = 32 + rInner * Math.sin(rad);
              const x2 = 32 + rOuter * Math.cos(rad);
              const y2 = 32 + rOuter * Math.sin(rad);

              return (
                <line
                  key={deg}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={deg === 0 ? '#ef4444' : isMajor ? '#9DBB72' : '#4b5f4f'}
                  strokeWidth={isMajor ? 1.5 : 0.75}
                />
              );
            })}

            {/* Cardinal Letters */}
            <text x="32" y="14" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="900" fontFamily="monospace">
              N
            </text>
            <text x="32" y="56" textAnchor="middle" fill={isNightMode ? '#ff7777' : '#94a3b8'} fontSize="7" fontWeight="800" fontFamily="monospace">
              S
            </text>
            <text x="52.5" y="34.5" textAnchor="middle" fill={isNightMode ? '#ff7777' : '#94a3b8'} fontSize="7" fontWeight="800" fontFamily="monospace">
              E
            </text>
            <text x="11.5" y="34.5" textAnchor="middle" fill={isNightMode ? '#ff7777' : '#94a3b8'} fontSize="7" fontWeight="800" fontFamily="monospace">
              W
            </text>
          </svg>

          {/* Central 3D Military Needle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* North Point (Red Wedge) */}
            <div className="absolute top-[15px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[15px] border-b-red-500 drop-shadow-[0_0_2px_#ef4444]" />
            {/* South Point (White/Slate Wedge) */}
            <div className="absolute bottom-[15px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[15px] border-t-slate-400" />
            {/* Center Pivot Bezel */}
            <div className="w-2.5 h-2.5 rounded-full bg-[#1b251e] border border-amber-400 z-10 shadow-sm flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sub-readout & Calibration Quick Access */}
      <button
        onClick={() => setActiveModal('compass_cal')}
        className="w-full flex items-center justify-between px-1 py-0.5 rounded bg-black/40 hover:bg-[#1a281e] text-[8px] font-mono-tactical text-slate-300 font-bold border border-[#233125] transition-colors"
        title="Open Compass Calibration & Sensor Alignment"
      >
        <span>ALIGN / TRIM</span>
        <SlidersHorizontal className="w-2.5 h-2.5 text-[#9DBB72]" />
      </button>
    </div>
  );
};
