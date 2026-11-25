import React, { useEffect, useRef, useState } from 'react';
import { Shield } from 'lucide-react';
import { useTacticalStore } from '../../../store/useTacticalStore';
import { NativeNearby, FieldlinkMeshService } from '../../../services/native/FieldlinkNearby';

interface SettingsModalProps {
  isDefaultKey: boolean;
  deviceNodeId: string;
  onKeyUpdated: (maskedPreview: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isDefaultKey, deviceNodeId, onKeyUpdated }) => {
  const {
    callsign,
    setCallsign,
    mapStyle,
    setMapStyle,
    isGridVisible,
    toggleGrid,
    isLocationSharing,
    toggleLocationSharing,
    distanceUnit,
    setDistanceUnit,
    coordFormat,
    setCoordFormat,
    gpsIntervalMs,
    setGpsIntervalMs,
    clearLocalData,
  } = useTacticalStore();

  const [settingsTab, setSettingsTab] = useState<'GPS' | 'MAP' | 'NETWORK' | 'PRIVACY' | 'GENERAL'>('GPS');
  const [tempCallsign, setTempCallsign] = useState(callsign);
  const [missionKeyInput, setMissionKeyInput] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'ok' | 'warn'; msg: string } | null>(null);
  const [confirmClearData, setConfirmClearData] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showSettingsFeedback = (type: 'ok' | 'warn', msg: string) => {
    setSettingsFeedback({ type, msg });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setSettingsFeedback(null);
      feedbackTimerRef.current = null;
    }, 3500);
  };

  const handleSaveMissionKey = async () => {
    const trimmed = missionKeyInput.trim();
    if (!trimmed) {
      showSettingsFeedback('warn', 'Mission key cannot be empty');
      return;
    }
    try {
      await NativeNearby.setMissionKey({ key: trimmed });
      const masked = trimmed.length <= 3 ? '••••••' : `${trimmed.substring(0, 3)}••••••`;
      onKeyUpdated(masked);
      showSettingsFeedback('ok', '✓ Mission Key Keystore-secured & cluster re-sync triggered');
      setMissionKeyInput('');
    } catch (e: unknown) {
      showSettingsFeedback('warn', 'Failed to set mission key: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSaveCallsign = async () => {
    const next = tempCallsign.trim().toUpperCase();
    if (!next) {
      showSettingsFeedback('warn', 'Callsign cannot be empty');
      return;
    }
    setCallsign(next);
    await FieldlinkMeshService.updateCallsign(next);
    showSettingsFeedback('ok', `✓ Callsign updated & broadcast as ${next}`);
  };

  return (
    <div className="space-y-3">
      {settingsFeedback && (
        <div
          className={`p-2 rounded text-[9.5px] font-bold border ${
            settingsFeedback.type === 'ok'
              ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300'
              : 'bg-amber-950/70 border-amber-600 text-amber-300'
          }`}
        >
          {settingsFeedback.msg}
        </div>
      )}
      {/* Category Navigation Pills */}
      <div className="flex rounded bg-[#070b08] p-1 border border-[#1b251e] gap-1 overflow-x-auto text-[9px] font-bold">
        {(['GPS', 'MAP', 'NETWORK', 'PRIVACY', 'GENERAL'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSettingsTab(tab)}
            className={`flex-1 py-1 px-1.5 rounded transition-colors whitespace-nowrap ${
              settingsTab === tab ? 'bg-[#203423] text-[#9DBB72] border border-[#3e5e43]' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* A. GPS Settings */}
      {settingsTab === 'GPS' && (
        <div className="space-y-2.5">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
              <span>Update Rate</span>
              <span className="text-[#9DBB72] font-mono">{gpsIntervalMs / 1000}s</span>
            </div>
            <div className="flex gap-2 text-[10px]">
              {[500, 1000, 2000, 5000].map((ms) => (
                <button
                  key={ms}
                  onClick={() => setGpsIntervalMs(ms)}
                  className={`flex-1 py-1 rounded border font-bold ${
                    gpsIntervalMs === ms ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                  }`}
                >
                  {ms < 1000 ? '0.5s' : `${ms / 1000}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="text-[11px] font-bold text-white uppercase">Location Sharing</div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Broadcast coordinates to squad:</span>
              <button
                onClick={toggleLocationSharing}
                className={`px-2.5 py-1 rounded font-bold text-[9px] ${
                  isLocationSharing ? 'bg-emerald-950 border border-emerald-700 text-emerald-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isLocationSharing ? 'ENABLED' : 'MUTED'}
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1">
            <div className="text-[11px] font-bold text-white uppercase">Hardware Sensors</div>
            <div className="text-[10px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>GNSS Receiver:</span>
                <span className="text-emerald-400 font-bold">Dual-Freq L1/L5 Direct</span>
              </div>
              <div className="flex justify-between">
                <span>Compass Fusion:</span>
                <span className="text-emerald-400 font-bold">Rotation Vector Sensor</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* B. MAP Settings */}
      {settingsTab === 'MAP' && (
        <div className="space-y-2.5">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase">Base Map Layer</div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <button
                onClick={() => setMapStyle('satellite')}
                className={`py-1.5 rounded border font-bold ${
                  mapStyle === 'satellite' ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                }`}
              >
                Google Satellite Hybrid
              </button>
              <button
                onClick={() => setMapStyle('topo')}
                className={`py-1.5 rounded border font-bold ${
                  mapStyle === 'topo' ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                }`}
              >
                Google Topo / Contours
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="text-[11px] font-bold text-white uppercase">Coordinate Grid</div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Military MGRS Blue Overlay:</span>
              <button
                onClick={toggleGrid}
                className={`px-2.5 py-1 rounded font-bold text-[9px] ${
                  isGridVisible ? 'bg-emerald-950 border border-emerald-700 text-emerald-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isGridVisible ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
              <span>Coordinate Format</span>
              <span className="text-[#35D5D9] font-mono text-[10px]">{coordFormat}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              {(['MGRS', 'DMS', 'DECIMAL'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setCoordFormat(fmt)}
                  className={`py-1.5 rounded border font-bold transition-all ${
                    coordFormat === fmt
                      ? 'bg-[#0e3b43] text-[#35D5D9] border-[#1b7382] shadow-[0_0_8px_rgba(53,213,217,0.3)]'
                      : 'bg-[#101712] text-slate-400 border-[#233125] hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
              <span>Distance Units</span>
              <span className="text-[#9DBB72] font-mono text-[10px]">
                {distanceUnit === 'KM' ? 'METRIC (KM / M)' : 'IMPERIAL (MI / FT)'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {(['KM', 'MI'] as const).map((unit) => (
                <button
                  key={unit}
                  onClick={() => setDistanceUnit(unit)}
                  className={`py-1.5 rounded border font-bold transition-all ${
                    distanceUnit === unit
                      ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43] shadow-[0_0_8px_rgba(157,187,114,0.3)]'
                      : 'bg-[#101712] text-slate-400 border-[#233125] hover:text-white'
                  }`}
                >
                  {unit === 'KM' ? 'METRIC (KM/M)' : 'IMPERIAL (MI/FT)'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* C. NETWORK Settings */}
      {settingsTab === 'NETWORK' && (
        <div className="space-y-2.5">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="text-[11px] font-bold text-white uppercase">Peer-to-Peer Transport</div>
            <div className="text-[10px] text-slate-400 space-y-1.5">
              <div className="flex justify-between items-center">
                <span>Nearby Connections:</span>
                <span className="text-emerald-400 font-bold">P2P_CLUSTER (Active)</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Wi-Fi Direct P2P:</span>
                <span className="text-cyan-400 font-bold">Socket Ready</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Auto-Reconnection:</span>
                <span className="text-emerald-400 font-bold">Continuous Loop</span>
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
              <span>Mesh Cryptography & Keyphrase</span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  isDefaultKey ? 'bg-amber-950 border border-amber-600 text-amber-300' : 'bg-emerald-950 border border-emerald-600 text-emerald-300'
                }`}
              >
                {isDefaultKey ? '⚠ DEFAULT KEY' : '✓ SECURE KEY'}
              </span>
            </div>

            <div className="text-[10px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Cipher / Auth:</span>
                <span className="text-[#35D5D9] font-mono">AES-256-GCM / HMAC-SHA256</span>
              </div>
              <div className="flex justify-between">
                <span>Hardware Node ID:</span>
                <span className="text-slate-200 font-mono">{deviceNodeId || 'GENERATING...'}</span>
              </div>
              {isDefaultKey && (
                <div className="p-1.5 rounded bg-amber-950/40 border border-amber-800/80 text-amber-200 text-[9px] leading-tight">
                  Default mission passphrase in use. In contested operations, define a shared mission key below.
                </div>
              )}
            </div>

            <div className="flex gap-1.5 mt-1">
              <input
                type="password"
                placeholder="ENTER MISSION PASSPHRASE"
                value={missionKeyInput}
                onChange={(e) => setMissionKeyInput(e.target.value)}
                className="flex-1 px-2 py-1 rounded bg-[#101712] border border-[#233125] text-white text-[10px] font-mono focus:outline-none focus:border-[#9DBB72]"
              />
              <button
                onClick={handleSaveMissionKey}
                className="px-2.5 py-1 rounded bg-[#203423] text-[#9DBB72] border border-[#3e5e43] font-bold text-[10px] hover:bg-[#2c4730]"
              >
                SET KEY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* D. PRIVACY Settings */}
      {settingsTab === 'PRIVACY' && (
        <div className="space-y-2.5">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1">
            <div className="text-[11px] font-bold text-white uppercase flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Zero Cloud Privacy</span>
            </div>
            <div className="text-[10px] text-slate-400 leading-relaxed">
              Local P2P radio only. No remote cloud or external telemetry.
            </div>
          </div>

          {!confirmClearData ? (
            <button
              onClick={() => setConfirmClearData(true)}
              className="w-full py-2 rounded bg-red-950/60 border border-red-800 text-red-300 font-bold uppercase text-[10px] hover:bg-red-900/60"
            >
              Clear Stored Waypoints, Drawings & Targets
            </button>
          ) : (
            <div className="p-2.5 rounded bg-red-950/60 border border-red-700/80 space-y-2">
              <div className="text-[10px] text-red-200 font-bold">
                Clear all local waypoints, drawings, and targets?
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    clearLocalData();
                    setConfirmClearData(false);
                    showSettingsFeedback('ok', '✓ Local tactical data cleared');
                  }}
                  className="flex-1 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white text-[9.5px] font-black uppercase"
                >
                  CONFIRM CLEAR
                </button>
                <button
                  onClick={() => setConfirmClearData(false)}
                  className="flex-1 py-1.5 rounded bg-[#101712] border border-[#233125] text-slate-300 text-[9.5px] font-bold uppercase"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* E. GENERAL Settings */}
      {settingsTab === 'GENERAL' && (
        <div className="space-y-2.5">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <label className="text-[11px] font-bold text-white uppercase block">Operator Callsign</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tempCallsign}
                onChange={(e) => setTempCallsign(e.target.value.toUpperCase())}
                className="flex-1 px-2.5 py-1.5 rounded bg-[#101712] border border-[#233125] text-white focus:outline-none focus:border-[#9DBB72]"
              />
              <button
                onClick={handleSaveCallsign}
                className="px-3 py-1.5 rounded bg-[#203423] text-[#9DBB72] border border-[#3e5e43] font-bold"
              >
                SAVE
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="text-[11px] font-bold text-white uppercase">Distance & Elevation Standard</div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <button
                onClick={() => setDistanceUnit('KM')}
                className={`py-2 px-1.5 rounded border font-bold text-center leading-tight ${
                  distanceUnit === 'KM' ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Indian Standard (Metric)</span>
                  {distanceUnit === 'KM' && (
                    <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">DEFAULT</span>
                  )}
                </div>
                <div className="text-[9px] opacity-75 font-normal mt-0.5">Kilometers, Meters, km/h</div>
              </button>
              <button
                onClick={() => setDistanceUnit('MI')}
                className={`py-2 px-1.5 rounded border font-bold text-center leading-tight ${
                  distanceUnit === 'MI' ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                }`}
              >
                <div>Imperial (US Customary)</div>
                <div className="text-[9px] opacity-75 font-normal mt-0.5">Miles, Feet, mph</div>
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="text-[11px] font-bold text-white uppercase">Coordinate Format</div>
            <div className="grid grid-cols-3 gap-1.5 text-[9px]">
              {(['MGRS', 'DMS', 'DECIMAL'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setCoordFormat(fmt)}
                  className={`py-1 rounded border font-bold ${
                    coordFormat === fmt ? 'bg-[#203423] text-[#9DBB72] border-[#3e5e43]' : 'bg-[#101712] text-slate-400 border-[#233125]'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
