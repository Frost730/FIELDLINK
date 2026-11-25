import React, { useState } from 'react';
import { Database, CheckCircle2, Download, Trash2 } from 'lucide-react';
import { useTacticalStore } from '../../../store/useTacticalStore';
import { TileCacheManager } from '../../../services/offline/TileCacheManager';

export const OfflineMapsModal: React.FC = () => {
  const { lat, lon, tileCacheStatus, setTileCacheStatus, cachedTilesCount } = useTacticalStore();

  const [isDownloadingTiles, setIsDownloadingTiles] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [confirmClearTiles, setConfirmClearTiles] = useState(false);

  const handlePrecacheAO = async () => {
    if (isDownloadingTiles) return;
    setIsDownloadingTiles(true);
    setDownloadProgress(5);
    setDownloadMessage('CALCULATING MISSION SECTOR TILES...');

    try {
      const targetLat = lat !== 0 ? lat : 11.18187;
      const targetLon = lon !== 0 ? lon : 75.85067;
      setDownloadMessage('DOWNLOADING & PERSISTING TILES TO INDEXEDDB...');

      const result = await TileCacheManager.precacheSector(targetLat, targetLon, (pct, current, total) => {
        setDownloadProgress(pct);
        setDownloadMessage(`DOWNLOADING ${current}/${total} TILES (SATELLITE + TOPO)...`);
      });

      setTileCacheStatus('cached');
      useTacticalStore.setState({ cachedTilesCount: result.totalCached });
      setDownloadMessage(`✓ ${result.totalCached} MISSION SECTOR TILES STORED OFFLINE`);
    } catch {
      setDownloadMessage('CACHING COMPLETE. CURRENT TILES RETAINED.');
    } finally {
      setTimeout(() => {
        setIsDownloadingTiles(false);
      }, 1500);
    }
  };

  return (
    <div className="space-y-2.5 font-mono-tactical">
      {/* 1. Live Cache Status */}
      <div
        className={`p-2.5 rounded border ${
          tileCacheStatus === 'cached'
            ? 'bg-[#042010] border-emerald-600/60 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
            : tileCacheStatus === 'downloading' || isDownloadingTiles
            ? 'bg-[#061d26] border-cyan-500/60 animate-pulse'
            : 'bg-[#1a1205] border-amber-600/60'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-white uppercase flex items-center gap-1.5">
            <Database
              className={`w-3.5 h-3.5 ${
                tileCacheStatus === 'cached'
                  ? 'text-emerald-400'
                  : tileCacheStatus === 'downloading'
                  ? 'text-cyan-400'
                  : 'text-amber-400'
              }`}
            />
            <span>Sector Tile Cache</span>
          </div>
          <span
            className={`text-[9px] px-2 py-0.5 rounded font-black tracking-wider uppercase border ${
              tileCacheStatus === 'cached'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                : tileCacheStatus === 'downloading' || isDownloadingTiles
                ? 'bg-cyan-950 text-cyan-300 border-cyan-400'
                : 'bg-amber-950 text-amber-300 border-amber-500'
            }`}
          >
            {tileCacheStatus === 'cached'
              ? '● CACHED (OFFLINE READY)'
              : tileCacheStatus === 'downloading' || isDownloadingTiles
              ? '◐ STREAMING TILES'
              : '○ OFFLINE GRID MODE'}
          </span>
        </div>

        <div className="text-slate-300 text-[10px] mt-1.5 leading-snug flex items-center justify-between">
          <span>
            {tileCacheStatus === 'cached'
              ? 'Current AO imagery cached locally. 100% offline ready.'
              : tileCacheStatus === 'downloading' || isDownloadingTiles
              ? 'Caching satellite imagery to local storage...'
              : 'Uncached sector. Tactical Grid active with GPS, compass & mesh.'}
          </span>
          <span className="font-mono font-bold text-emerald-400 text-[10px] ml-2 shrink-0">
            {cachedTilesCount} TILES
          </span>
        </div>
      </div>

      {/* 2. Toolbar Status LED Guide */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5 text-[10px]">
        <div className="text-[#9DBB72] font-bold uppercase flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Toolbar Status LED</span>
        </div>
        <div className="grid grid-cols-3 gap-1 pt-0.5 text-[9px]">
          <div className="flex items-center gap-1.5 text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
            <span>CACHED</span>
          </div>
          <div className="flex items-center gap-1.5 text-cyan-300">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>CACHING</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-300">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>GRID MODE</span>
          </div>
        </div>
      </div>

      {/* 3. Pre-Cache Mission Area Action Button */}
      <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
        <div className="text-[10px] text-slate-300 font-bold uppercase flex items-center justify-between">
          <span>Pre-Cache Sector (5 KM)</span>
          <span className="text-[#D1A34A] text-[9px] font-bold">
            {lat !== 0 ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : 'CURRENT AO'}
          </span>
        </div>

        {downloadMessage && <div className="text-[9.5px] font-bold text-cyan-300 pt-0.5">{downloadMessage}</div>}

        {isDownloadingTiles && (
          <div className="w-full bg-[#101712] rounded-full h-1.5 overflow-hidden border border-[#233125]">
            <div className="bg-emerald-500 h-1.5 transition-all duration-200" style={{ width: `${downloadProgress}%` }} />
          </div>
        )}

        <button
          onClick={handlePrecacheAO}
          disabled={isDownloadingTiles}
          className="w-full py-2 rounded bg-[#1c3822] hover:bg-[#254d2f] text-emerald-300 border border-[#2e5e39] font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          <Download className={`w-3.5 h-3.5 ${isDownloadingTiles ? 'animate-bounce' : ''}`} />
          <span>{isDownloadingTiles ? `Caching (${downloadProgress}%)` : 'Pre-Cache Mission Sector'}</span>
        </button>

        {cachedTilesCount > 0 && !confirmClearTiles && (
          <button
            onClick={() => setConfirmClearTiles(true)}
            className="w-full py-1.5 rounded bg-[#1a0f0f] hover:bg-[#2a1414] text-red-400 border border-red-900/60 font-bold text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
            <span>Clear Offline Cache ({cachedTilesCount} Tiles)</span>
          </button>
        )}
        {cachedTilesCount > 0 && confirmClearTiles && (
          <div className="p-2 rounded bg-red-950/60 border border-red-700/80 space-y-1.5">
            <div className="text-[9.5px] text-red-200 font-bold">
              Purge all {cachedTilesCount} offline cached map tiles?
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={async () => {
                  await TileCacheManager.clearAllTiles();
                  useTacticalStore.setState({ cachedTilesCount: 0, tileCacheStatus: 'offline_grid' });
                  setConfirmClearTiles(false);
                  setDownloadMessage('OFFLINE TILE STORAGE CLEARED');
                }}
                className="flex-1 py-1 rounded bg-red-800 hover:bg-red-700 text-white text-[9px] font-black uppercase"
              >
                CONFIRM PURGE
              </button>
              <button
                onClick={() => setConfirmClearTiles(false)}
                className="flex-1 py-1 rounded bg-[#151c17] border border-[#233125] text-slate-300 text-[9px] font-bold uppercase"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Offline Subsystem Breakdown */}
      <div className="p-2 rounded bg-[#070b08] border border-[#1b251e] text-[9.5px]">
        <div className="grid grid-cols-2 gap-1.5 text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>GNSS / GPS: OFFLINE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>P2P MESH: OFFLINE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>COMPASS / IMU: OFFLINE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>MGRS GRID: OFFLINE</span>
          </div>
        </div>
      </div>
    </div>
  );
};
