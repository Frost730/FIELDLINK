import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { NativeNearby, type DiscoveredPeer } from '../../services/native/FieldlinkNearby';
import { WaypointsModal } from './modals/WaypointsModal';
import { OfflineMapsModal } from './modals/OfflineMapsModal';
import { SquadNearbyModal } from './modals/SquadNearbyModal';
import { MeasureModal, SosModal } from './modals/MeasureSosModal';
import { CompassCalModal } from './modals/CompassCalModal';
import { SettingsModal } from './modals/SettingsModal';

interface TacticalModalsProps {
  onCenterMap?: (targetLat?: number, targetLon?: number) => void;
}

export const TacticalModals: React.FC<TacticalModalsProps> = ({ onCenterMap }) => {
  const { activeModal, setActiveModal, callsign, squadMembers, isNightMode, distanceUnit } = useTacticalStore();

  const [isScanningPeers, setIsScanningPeers] = useState(false);
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  const [pendingEndpoints, setPendingEndpoints] = useState<string[]>([]);
  const [connectedEndpoints, setConnectedEndpoints] = useState<
    Array<{ endpointId: string; callsign: string; nodeId?: string; keyMismatch?: boolean }>
  >([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [mismatchedCount, setMismatchedCount] = useState(0);
  const [isDefaultKey, setIsDefaultKey] = useState(true);
  const [deviceNodeId, setDeviceNodeId] = useState('');
  const [activeMissionKeyMasked, setActiveMissionKeyMasked] = useState('DEFAULT (Alpha 2026)');

  const handleRefreshMeshPeers = useCallback(async () => {
    setIsScanningPeers(true);
    try {
      try {
        await NativeNearby.requestMeshPermissions();
        await NativeNearby.startDiscovery();
      } catch {
        // Ignore on web runtime
      }

      const status = await NativeNearby.checkMeshStatus();
      if (status) {
        if (status.discoveredPeers) setDiscoveredPeers(status.discoveredPeers);
        setPendingEndpoints(status.pendingEndpoints ?? []);
        setConnectedEndpoints(status.connectedEndpoints ?? []);
        setConnectedCount(status.connectedCount ?? 0);
        setMismatchedCount(status.mismatchedCount ?? 0);
      }
    } catch (e) {
      console.warn('Mesh peers query:', e);
    } finally {
      setTimeout(() => setIsScanningPeers(false), 500);
    }
  }, []);

  useEffect(() => {
    if (activeModal === 'settings' || activeModal === 'squad' || activeModal === 'nearby') {
      NativeNearby.checkMeshStatus()
        .then((status) => {
          if (status) {
            setIsDefaultKey(status.isDefaultMissionKey ?? false);
            if (status.nodeId) setDeviceNodeId(status.nodeId);
            if (status.missionKey) setActiveMissionKeyMasked(status.missionKey);
            setPendingEndpoints(status.pendingEndpoints ?? []);
            setConnectedEndpoints(status.connectedEndpoints ?? []);
            setConnectedCount(status.connectedCount ?? 0);
            setMismatchedCount(status.mismatchedCount ?? 0);
          }
        })
        .catch(() => {});
    }
  }, [activeModal]);

  useEffect(() => {
    if (activeModal === 'squad' || activeModal === 'nearby') {
      const scanTimer = setTimeout(() => {
        void handleRefreshMeshPeers();
      }, 0);

      let discHandle: { remove: () => void } | null = null;
      let lostHandle: { remove: () => void } | null = null;
      let connHandle: { remove: () => void } | null = null;
      let disconnHandle: { remove: () => void } | null = null;
      let failHandle: { remove: () => void } | null = null;
      let cryptoHandle: { remove: () => void } | null = null;
      let keyHandle: { remove: () => void } | null = null;

      const refreshStatusCounts = () => {
        NativeNearby.checkMeshStatus()
          .then((s) => {
            if (!s) return;
            setDiscoveredPeers(s.discoveredPeers ?? []);
            setPendingEndpoints(s.pendingEndpoints ?? []);
            setConnectedEndpoints(s.connectedEndpoints ?? []);
            setConnectedCount(s.connectedCount ?? 0);
            setMismatchedCount(s.mismatchedCount ?? 0);
          })
          .catch(() => {});
      };

      NativeNearby.addListener('peerDiscovered', (peer: DiscoveredPeer) => {
        setDiscoveredPeers((prev) => {
          const existingIdx = prev.findIndex((p) => p.endpointId === peer.endpointId);
          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = peer;
            return updated;
          }
          return [...prev, peer];
        });
      })
        .then((h) => {
          discHandle = h;
        })
        .catch(() => {});

      NativeNearby.addListener('peerLost', ({ endpointId }: { endpointId: string }) => {
        setDiscoveredPeers((prev) => prev.filter((p) => p.endpointId !== endpointId));
      })
        .then((h) => {
          lostHandle = h;
        })
        .catch(() => {});

      NativeNearby.addListener('peerConnected', refreshStatusCounts).then((h) => { connHandle = h; }).catch(() => {});
      NativeNearby.addListener('peerDisconnected', refreshStatusCounts).then((h) => { disconnHandle = h; }).catch(() => {});
      NativeNearby.addListener('peerConnectionFailed', refreshStatusCounts).then((h) => { failHandle = h; }).catch(() => {});
      NativeNearby.addListener('cryptoError', refreshStatusCounts).then((h) => { cryptoHandle = h; }).catch(() => {});
      NativeNearby.addListener('missionKeyRotated', refreshStatusCounts).then((h) => { keyHandle = h; }).catch(() => {});

      return () => {
        clearTimeout(scanTimer);
        if (discHandle) discHandle.remove();
        if (lostHandle) lostHandle.remove();
        if (connHandle) connHandle.remove();
        if (disconnHandle) disconnHandle.remove();
        if (failHandle) failHandle.remove();
        if (cryptoHandle) cryptoHandle.remove();
        if (keyHandle) keyHandle.remove();
      };
    }
  }, [activeModal, handleRefreshMeshPeers]);

  if (!activeModal) return null;

  const unlinkedDiscoveredPeers = discoveredPeers.filter((peer) => {
    if (peer.callsign === callsign) return false;
    return !squadMembers.some(
      (m) => m.id === peer.endpointId || (peer.nodeId && m.id === peer.nodeId) || m.callsign === peer.callsign
    );
  });

  const modalBg = isNightMode ? 'bg-[#120505] border-[#4a1212] text-red-200' : 'bg-[#101512] border-[#222e25] text-slate-200';

  const formatDist = (km = 0) => {
    if (distanceUnit === 'MI') {
      const mi = km * 0.621371;
      return mi < 0.1 ? `${Math.round(km * 3280.84)} FT` : `${mi.toFixed(2)} MI`;
    }
    return km < 1 ? `${Math.round(km * 1000)} M` : `${km.toFixed(2)} KM`;
  };

  const handleKeyUpdated = (maskedPreview: string) => {
    setIsDefaultKey(false);
    setActiveMissionKeyMasked(maskedPreview);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm select-none safe-top safe-bottom">
      <div className="absolute inset-0" onClick={() => setActiveModal(null)} />

      <div className={`relative w-full max-w-md max-h-[88vh] flex flex-col rounded-lg border shadow-2xl z-10 overflow-hidden ${modalBg}`}>
        {/* Modal Header */}
        <div className="p-3 border-b border-[#1b261d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono-tactical font-black tracking-widest text-[#9DBB72] uppercase">
              {activeModal.replace('_', ' ')}
            </span>
          </div>
          <button onClick={() => setActiveModal(null)} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3 overflow-y-auto space-y-3 text-xs font-mono-tactical">
          {activeModal === 'waypoints' && <WaypointsModal onCenterMap={onCenterMap} formatDist={formatDist} />}
          {activeModal === 'offline_maps' && <OfflineMapsModal />}
          {(activeModal === 'squad' || activeModal === 'nearby') && (
            <SquadNearbyModal
              mode={activeModal}
              isScanningPeers={isScanningPeers}
              unlinkedDiscoveredPeers={unlinkedDiscoveredPeers}
              pendingEndpoints={pendingEndpoints}
              connectedEndpoints={connectedEndpoints}
              connectedCount={connectedCount}
              mismatchedCount={mismatchedCount}
              isDefaultKey={isDefaultKey}
              activeMissionKeyMasked={activeMissionKeyMasked}
              onRefreshPeers={handleRefreshMeshPeers}
              onKeyUpdated={handleKeyUpdated}
              onCenterMap={onCenterMap}
              formatDist={formatDist}
            />
          )}
          {activeModal === 'measure' && <MeasureModal formatDist={formatDist} />}
          {activeModal === 'sos' && <SosModal />}
          {activeModal === 'compass_cal' && <CompassCalModal />}
          {activeModal === 'settings' && (
            <SettingsModal isDefaultKey={isDefaultKey} deviceNodeId={deviceNodeId} onKeyUpdated={handleKeyUpdated} />
          )}
        </div>
      </div>
    </div>
  );
};
