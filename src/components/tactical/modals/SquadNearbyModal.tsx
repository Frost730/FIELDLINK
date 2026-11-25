import React, { useEffect, useRef, useState } from 'react';
import {
  Users,
  Radio,
  RefreshCw,
  LocateFixed,
  UserPlus,
  Trash2,
  Shield,
  Key,
  Lock,
  X,
} from 'lucide-react';
import { useTacticalStore, type SquadMember } from '../../../store/useTacticalStore';
import { formatCoordinateString, getCallsignColor } from '../../../utils/coordinates';
import { NativeNearby, FieldlinkMeshService, type DiscoveredPeer } from '../../../services/native/FieldlinkNearby';

interface SquadNearbyModalProps {
  mode: 'squad' | 'nearby';
  isScanningPeers: boolean;
  unlinkedDiscoveredPeers: DiscoveredPeer[];
  pendingEndpoints?: string[];
  connectedEndpoints?: Array<{ endpointId: string; callsign: string; nodeId?: string; keyMismatch?: boolean }>;
  connectedCount?: number;
  mismatchedCount?: number;
  isDefaultKey: boolean;
  activeMissionKeyMasked: string;
  onRefreshPeers: () => void;
  onKeyUpdated: (maskedPreview: string) => void;
  onCenterMap?: (targetLat?: number, targetLon?: number) => void;
  formatDist: (km?: number) => string;
}

export const SquadNearbyModal: React.FC<SquadNearbyModalProps> = ({
  mode,
  isScanningPeers,
  unlinkedDiscoveredPeers,
  pendingEndpoints = [],
  connectedEndpoints = [],
  connectedCount = 0,
  mismatchedCount = 0,
  isDefaultKey,
  activeMissionKeyMasked,
  onRefreshPeers,
  onKeyUpdated,
  onCenterMap,
  formatDist,
}) => {
  const {
    lat,
    lon,
    callsign,
    isLeader,
    clusterLeaderCallsign,
    claimLeadership,
    abdicateLeadership,
    squadMembers,
    updateSquadMember,
    removeSquadMember,
    setSelectedTarget,
    setActiveModal,
    coordFormat,
  } = useTacticalStore();

  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const [manualCallsign, setManualCallsign] = useState('');
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [manualRole, setManualRole] = useState<'INFANTRY' | 'RECON' | 'SNIPER' | 'SUPPORT'>('INFANTRY');

  const [showSquadKeyPrompt, setShowSquadKeyPrompt] = useState(false);
  const [squadKeyEditInput, setSquadKeyEditInput] = useState('');
  const [linkingPeer, setLinkingPeer] = useState<DiscoveredPeer | null>(null);
  const [linkMissionKeyInput, setLinkMissionKeyInput] = useState('');
  const [localPendingIds, setLocalPendingIds] = useState<string[]>([]);
  const [linkFeedback, setLinkFeedback] = useState<{ type: 'ok' | 'warn'; msg: string } | null>(null);
  const [confirmStepDown, setConfirmStepDown] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = (type: 'ok' | 'warn', msg: string) => {
    setLinkFeedback({ type, msg });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setLinkFeedback(null);
      feedbackTimerRef.current = null;
    }, 4000);
  };

  const handleConnectPeer = async (endpointId: string) => {
    setLocalPendingIds((prev) => (prev.includes(endpointId) ? prev : [...prev, endpointId]));
    try {
      const res = await NativeNearby.connectToPeer({ endpointId });
      if (res?.status === 'connected') {
        showFeedback('ok', '✓ Peer already connected to cluster');
      } else {
        showFeedback('ok', '✓ Link handshake transmitted to squad peer');
      }
      onRefreshPeers();
    } catch (e: unknown) {
      showFeedback('warn', e instanceof Error ? e.message : String(e));
    } finally {
      setTimeout(() => {
        setLocalPendingIds((prev) => prev.filter((id) => id !== endpointId));
      }, 2500);
    }
  };

  const handleLinkAllDiscovered = async () => {
    const eligiblePeers = unlinkedDiscoveredPeers.filter((p) => !p.keyMismatch);
    if (eligiblePeers.length === 0) {
      showFeedback('warn', 'No discovered peers have a matching Mission Key to link.');
      return;
    }
    let requested = 0;
    for (const peer of eligiblePeers) {
      if (pendingEndpoints.includes(peer.endpointId)) continue;
      setLocalPendingIds((prev) => (prev.includes(peer.endpointId) ? prev : [...prev, peer.endpointId]));
      try {
        await NativeNearby.connectToPeer({ endpointId: peer.endpointId });
        requested++;
      } catch {
        // Reconciler handles multi-hop fallback when direct radio cap is reached
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    showFeedback('ok', `✓ Cluster link initiated for ${requested} peer${requested === 1 ? '' : 's'}`);
    onRefreshPeers();
  };

  const handleAddManualSquadMember = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCallsign = manualCallsign.trim() ? manualCallsign.trim().toUpperCase() : `SQUAD-${Math.floor(10 + Math.random() * 90)}`;
    const memberLat = manualLat.trim() ? parseFloat(manualLat) : lat + (Math.random() - 0.5) * 0.004;
    const memberLon = manualLon.trim() ? parseFloat(manualLon) : lon + (Math.random() - 0.5) * 0.004;

    if (isNaN(memberLat) || isNaN(memberLon)) {
      showFeedback('warn', 'Please enter valid decimal coordinates');
      return;
    }

    const newMember: SquadMember = {
      id: 'squad-' + Date.now(),
      callsign: `${finalCallsign} [${manualRole[0]}]`,
      lat: memberLat,
      lon: memberLon,
      alt: 12,
      heading: 45,
      status: 'CONNECTED',
      lastSeen: Date.now(),
    };

    updateSquadMember(newMember);
    setManualCallsign('');
    setManualLat('');
    setManualLon('');
    setShowAddMemberForm(false);
  };

  const openLinkDialog = (peer: DiscoveredPeer) => {
    setLinkingPeer(peer);
    // Keep empty by default so masked preview never leaks or overwrites a custom key
    setLinkMissionKeyInput('');
  };

  return (
    <>
      {mode === 'squad' ? (
        <div className="space-y-3">
          <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-white uppercase">My Operator Callsign</span>
              <span className="text-[#35D5D9] font-bold">{callsign}</span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center justify-between">
              <span>Transport: Offline Radio Mesh (Nearby P2P_CLUSTER)</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" />
                {connectedCount > 0 ? `${connectedCount} RF LINK${connectedCount > 1 ? 'S' : ''}` : 'ACTIVE'}
              </span>
            </div>
            {mismatchedCount > 0 && (
              <div className="p-1.5 rounded bg-red-950/70 border border-red-600/80 text-red-200 text-[9px] flex items-center justify-between gap-2">
                <span>Key mismatch on {mismatchedCount} link{mismatchedCount > 1 ? 's' : ''}. Align Mission Key &amp; resync.</span>
                <button
                  onClick={() => void FieldlinkMeshService.syncStateToCluster()}
                  className="px-2 py-0.5 rounded bg-red-900 text-white border border-red-400 font-bold shrink-0"
                >
                  RESYNC
                </button>
              </div>
            )}
            {linkFeedback && (
              <div
                className={`p-1.5 rounded text-[9px] font-bold border ${
                  linkFeedback.type === 'ok'
                    ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300'
                    : 'bg-amber-950/70 border-amber-600 text-amber-300'
                }`}
              >
                {linkFeedback.msg}
              </div>
            )}
            <div className="pt-1.5 border-t border-[#1b251e] flex items-center justify-between">
              <span className="text-[10px] text-slate-300 font-bold flex items-center gap-1">
                <Shield className={`w-3.5 h-3.5 ${isLeader ? 'text-amber-400' : 'text-slate-500'}`} />
                CLUSTER AUTHORITY:
              </span>
              {isLeader ? (
                !confirmStepDown ? (
                  <button
                    onClick={() => setConfirmStepDown(true)}
                    className="px-2.5 py-1 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 bg-amber-950/70 border-amber-500 text-amber-300 shadow-[0_0_10px_#f59e0b]"
                    title="Tap to relinquish leadership"
                  >
                    <span>★ SQUAD LEADER</span>
                    <span className="text-[8px] opacity-75 font-normal ml-0.5">(STEP DOWN)</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={async () => {
                        setConfirmStepDown(false);
                        abdicateLeadership();
                        await FieldlinkMeshService.broadcastLeaderClaim(false);
                        showFeedback('ok', '✓ Relinquished cluster leadership');
                      }}
                      className="px-2 py-1 rounded text-[9px] font-black bg-red-800 hover:bg-red-700 text-white uppercase"
                    >
                      CONFIRM
                    </button>
                    <button
                      onClick={() => setConfirmStepDown(false)}
                      className="px-2 py-1 rounded text-[9px] font-bold bg-[#101712] border border-[#233125] text-slate-300 uppercase"
                    >
                      CANCEL
                    </button>
                  </div>
                )
              ) : clusterLeaderCallsign && clusterLeaderCallsign !== callsign ? (
                <div
                  className="px-2 py-1 rounded text-[9.5px] font-bold border flex items-center gap-1.5 bg-[#14120a] border-amber-700/60 text-amber-400"
                  title={`Leadership locked by ${clusterLeaderCallsign}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                  <span>LEADER: {clusterLeaderCallsign}</span>
                  <span className="text-[8px] px-1 py-0.2 rounded bg-black/60 text-slate-400 border border-[#2b3d2f]">LOCKED</span>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    const res = claimLeadership();
                    if (!res.success) {
                      showFeedback('warn', res.reason || 'Leadership locked by active leader');
                    } else {
                      await FieldlinkMeshService.broadcastLeaderClaim(true);
                    }
                  }}
                  className="px-2.5 py-1 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 bg-[#101712] border-[#2b3d2f] text-slate-400 hover:text-white hover:border-amber-500"
                >
                  <span>OPERATOR / MEMBER</span>
                  <span className="text-[8px] px-1 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800 ml-1">
                    + CLAIM LEADER
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Mesh Security & Mission Key Card */}
          <div className="p-2.5 rounded bg-[#090e13] border border-[#1b2b3a] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-[#35D5D9]" />
                <span className="text-[10px] font-bold text-white uppercase">Mesh Security & Mission Key</span>
              </div>
              <span
                className={`text-[8.5px] px-1.5 py-0.2 rounded font-bold border ${
                  isDefaultKey
                    ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                    : 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                }`}
              >
                {isDefaultKey ? 'DEFAULT KEY' : 'AES-256 SECURED'}
              </span>
            </div>
            <div className="text-[9.5px] text-slate-300 flex items-center justify-between font-mono">
              <span className="text-slate-400">PASSPHRASE:</span>
              <span className="font-bold text-[#35D5D9]">
                {isDefaultKey ? 'FIELDLINK-MISSION-ALPHA-2026' : activeMissionKeyMasked || 'CUSTOM'}
              </span>
            </div>

            {!showSquadKeyPrompt ? (
              <button
                onClick={() => {
                  setShowSquadKeyPrompt(true);
                  setSquadKeyEditInput('');
                }}
                className="w-full py-1 rounded bg-[#10202b] text-[#35D5D9] border border-[#1b3d52] font-bold text-[9px] hover:bg-[#163042] flex items-center justify-center gap-1"
              >
                <Lock className="w-3 h-3" />
                <span>SET / CHANGE CLUSTER MISSION KEY</span>
              </button>
            ) : (
              <div className="space-y-1.5 p-2 rounded bg-[#05080c] border border-[#233b4d]">
                <div className="text-[9px] text-slate-300 font-sans">
                  All cluster devices must use the <strong>exact same Mission Key</strong>:
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    placeholder="ENTER NEW SHARED KEY"
                    value={squadKeyEditInput}
                    onChange={(e) => setSquadKeyEditInput(e.target.value)}
                    className="flex-1 px-2 py-1 rounded bg-[#101712] border border-[#233125] text-white text-[10px] font-mono focus:outline-none focus:border-[#35D5D9]"
                  />
                  <button
                    onClick={async () => {
                      const trimmed = squadKeyEditInput.trim();
                      if (!trimmed) {
                        showFeedback('warn', 'Mission Key cannot be empty');
                        return;
                      }
                      try {
                        await NativeNearby.setMissionKey({ key: trimmed });
                        const masked = trimmed.length <= 3 ? '••••••' : `${trimmed.substring(0, 3)}••••••`;
                        onKeyUpdated(masked);
                        setShowSquadKeyPrompt(false);
                        showFeedback('ok', '✓ Mission Key secured & cluster re-sync triggered');
                      } catch (err: unknown) {
                        showFeedback('warn', 'Error: ' + (err instanceof Error ? err.message : String(err)));
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-[#0c404a] text-[#35D5D9] border border-[#166c7d] text-[9px] font-bold"
                  >
                    SAVE
                  </button>
                  <button
                    onClick={() => setShowSquadKeyPrompt(false)}
                    className="px-2 py-1 rounded bg-[#151c17] text-slate-400 border border-[#233125] text-[9px] font-bold"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onRefreshPeers}
              disabled={isScanningPeers}
              className="flex-1 py-1.5 rounded bg-[#101712] border border-[#233125] text-slate-300 hover:text-white flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanningPeers ? 'animate-spin' : ''}`} />
              <span>{isScanningPeers ? 'Scanning Mesh...' : 'Scan Nearby'}</span>
            </button>
            <button
              onClick={() => setShowAddMemberForm(!showAddMemberForm)}
              className="flex-1 py-1.5 rounded bg-[#1c2e21] border border-[#2e4735] text-[#9DBB72] hover:text-white flex items-center justify-center gap-1.5 font-bold"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{showAddMemberForm ? 'Cancel' : '+ Add Member'}</span>
            </button>
          </div>

          {showAddMemberForm && (
            <form onSubmit={handleAddManualSquadMember} className="p-3 rounded bg-[#070b08] border border-[#2e4735] space-y-2 animate-fadeIn">
              <div className="text-[11px] font-bold text-[#9DBB72] uppercase">Add Squad Member to Common Map</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="CALLSIGN (e.g. VIPER-2)"
                  value={manualCallsign}
                  onChange={(e) => setManualCallsign(e.target.value.toUpperCase())}
                  className="px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white focus:outline-none focus:border-[#35D5D9]"
                />
                <select
                  value={manualRole}
                  onChange={(e) => setManualRole(e.target.value as typeof manualRole)}
                  className="px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white"
                >
                  <option value="INFANTRY">Infantry</option>
                  <option value="RECON">Recon</option>
                  <option value="SNIPER">Sniper</option>
                  <option value="SUPPORT">Support</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <input
                  type="text"
                  placeholder={`Lat (def: ${(lat + 0.0015).toFixed(4)})`}
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  className="px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white focus:outline-none focus:border-[#35D5D9]"
                />
                <input
                  type="text"
                  placeholder={`Lon (def: ${(lon + 0.0018).toFixed(4)})`}
                  value={manualLon}
                  onChange={(e) => setManualLon(e.target.value)}
                  className="px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white focus:outline-none focus:border-[#35D5D9]"
                />
              </div>
              <button
                type="submit"
                className="w-full py-1.5 rounded bg-[#1b3d24] text-[#9DBB72] border border-[#2b5a35] font-bold uppercase tracking-wider text-[10px]"
              >
                Deploy to Tactical Map
              </button>
            </form>
          )}

          {unlinkedDiscoveredPeers.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-amber-400 font-bold uppercase">
                  Discovered Nearby Operators ({unlinkedDiscoveredPeers.length})
                </span>
                {unlinkedDiscoveredPeers.filter((p) => !p.keyMismatch).length >= 2 && (
                  <button
                    onClick={() => void handleLinkAllDiscovered()}
                    className="px-2 py-0.5 rounded bg-[#0c404a] text-[#35D5D9] border border-[#166c7d] text-[9px] font-bold hover:bg-[#125866]"
                  >
                    LINK ALL ({unlinkedDiscoveredPeers.filter((p) => !p.keyMismatch).length})
                  </button>
                )}
              </div>
              {unlinkedDiscoveredPeers.map((peer) => {
                const isConnecting =
                  peer.isPending ||
                  pendingEndpoints.includes(peer.endpointId) ||
                  localPendingIds.includes(peer.endpointId);
                return (
                  <div
                    key={peer.endpointId}
                    className={`p-2 rounded bg-[#090d16] border flex items-center justify-between ${
                      peer.keyMismatch ? 'border-red-600/70' : 'border-[#35D5D9]/40'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-white text-[11px] flex items-center gap-1.5">
                        <span>{peer.callsign}</span>
                        {peer.keyMismatch && (
                          <span className="text-[8px] px-1.5 py-0.2 rounded bg-red-950 border border-red-600 text-red-300 font-black">
                            KEY BLOCKED
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-slate-400">
                        ID: {peer.endpointId}{peer.nodeId ? ` • ${peer.nodeId}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => openLinkDialog(peer)}
                      disabled={isConnecting}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1 border ${
                        peer.keyMismatch
                          ? 'bg-red-950/70 text-red-200 border-red-700 hover:bg-red-900/70'
                          : isConnecting
                          ? 'bg-amber-950/60 text-amber-300 border-amber-700 cursor-wait'
                          : 'bg-[#0c404a] text-[#35D5D9] border-[#166c7d] hover:bg-[#125866]'
                      }`}
                    >
                      <Radio className={`w-3 h-3 ${isConnecting ? 'animate-spin' : ''}`} />
                      <span>{peer.keyMismatch ? 'SET KEY' : isConnecting ? 'LINKING...' : 'LINK'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {connectedEndpoints.filter(
            (ep) => !squadMembers.some((m) => (ep.nodeId && m.id === ep.nodeId) || m.callsign === ep.callsign)
          ).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-cyan-300 font-bold uppercase">
                Connected RF Links (Awaiting Sync / Key Alignment)
              </div>
              {connectedEndpoints
                .filter((ep) => !squadMembers.some((m) => (ep.nodeId && m.id === ep.nodeId) || m.callsign === ep.callsign))
                .map((ep) => (
                  <div
                    key={ep.endpointId}
                    className={`p-2 rounded border flex items-center justify-between ${
                      ep.keyMismatch ? 'bg-red-950/40 border-red-600/60' : 'bg-[#090d16] border-[#1f3b4d]'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-white text-[11px]">{ep.callsign}</div>
                      <div className="text-[9px] text-slate-400">
                        RF ID: {ep.endpointId}{ep.nodeId ? ` • ${ep.nodeId}` : ''}
                      </div>
                    </div>
                    <span
                      className={`text-[8.5px] px-2 py-0.5 rounded font-bold border ${
                        ep.keyMismatch
                          ? 'bg-red-950 text-red-300 border-red-500'
                          : 'bg-cyan-950 text-cyan-300 border-cyan-700'
                      }`}
                    >
                      {ep.keyMismatch ? 'KEY MISMATCH' : 'SYNCING...'}
                    </span>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between">
              <span>Tactical Squad Nodes</span>
              <span>{squadMembers.length} ACTIVE</span>
            </div>
            {squadMembers.length === 0 ? (
              <div className="p-6 text-center rounded bg-[#070b08] border border-[#1b251e] text-slate-500">
                <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <div>No squad peers currently on map.</div>
                <div className="text-[10px] text-slate-600 mt-1">
                  Tap "+ Add Member" or link with surrounding operators running FIELDLINK.
                </div>
              </div>
            ) : (
              squadMembers.map((member) => {
                const memberCol = getCallsignColor(member.callsign);
                return (
                  <div
                    key={member.id}
                    className="p-2.5 rounded bg-[#070b08] border flex items-center justify-between"
                    style={{ borderLeft: `3px solid ${memberCol.hex}`, borderColor: '#1b251e', borderLeftColor: memberCol.hex }}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: memberCol.hex }} />
                        <span className="font-bold text-white text-[11px]">{member.callsign}</span>
                        {member.isLeader && (
                          <span className="text-[8px] px-1.5 py-0.2 rounded font-black bg-amber-950 border border-amber-600 text-amber-300 flex items-center gap-0.5 shadow-sm">
                            ★ LEADER
                          </span>
                        )}
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                            member.status === 'SOS'
                              ? 'bg-red-950 border border-red-800 text-red-400 animate-pulse'
                              : member.status === 'DISCONNECTED'
                              ? 'bg-slate-900 border border-slate-700 text-slate-400'
                              : 'bg-cyan-950 border border-cyan-800 text-[#35D5D9]'
                          }`}
                        >
                          {member.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {member.lat !== 0 || member.lon !== 0 ? (
                          <span>
                            {formatCoordinateString(member.lat, member.lon, coordFormat)}
                            {member.distanceKm !== undefined ? ` • ${formatDist(member.distanceKm)}` : ''}
                          </span>
                        ) : (
                          <span className="text-amber-400/90 font-mono">GPS ACQUIRING... • CONNECTED</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setSelectedTarget({
                            lat: member.lat,
                            lon: member.lon,
                            name: `SQUAD: ${member.callsign}`,
                          });
                          if (onCenterMap) onCenterMap(member.lat, member.lon);
                          setActiveModal(null);
                        }}
                        className="px-2 py-1 rounded bg-[#101712] border border-[#233125] text-cyan-300 hover:text-white flex items-center gap-1 text-[10px]"
                        title="View on Map"
                      >
                        <LocateFixed className="w-3 h-3" />
                        <span>VIEW</span>
                      </button>
                      <button
                        onClick={() => removeSquadMember(member.id)}
                        className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-red-400 rounded"
                        title="Remove Squad Member"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
            <div className="text-[11px] font-bold text-white uppercase flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#35D5D9]" />
              <span>Radio Transceiver Hardware</span>
            </div>
            <div className="text-[10px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Nearby Connections:</span>
                <span className="text-emerald-400 font-bold">P2P_CLUSTER (Armed)</span>
              </div>
              <div className="flex justify-between">
                <span>Wi-Fi Direct P2P:</span>
                <span className="text-emerald-400 font-bold">Socket Channel Ready</span>
              </div>
              <div className="flex justify-between">
                <span>Bluetooth Low Energy:</span>
                <span className="text-emerald-400 font-bold">Scanning & Advertising</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-slate-400 font-bold uppercase flex items-center justify-between">
              <span>Detected RF Endpoints</span>
              <button
                onClick={onRefreshPeers}
                disabled={isScanningPeers}
                className="px-2 py-0.5 rounded bg-[#102022] border border-[#35D5D9]/40 text-[10px] text-[#35D5D9] hover:bg-[#173033] flex items-center gap-1 font-bold"
              >
                <RefreshCw className={`w-3 h-3 ${isScanningPeers ? 'animate-spin' : ''}`} />
                <span>{isScanningPeers ? 'SCANNING...' : 'SCAN RF PEERS'}</span>
              </button>
            </div>

            {unlinkedDiscoveredPeers.length === 0 ? (
              <div className="p-4 text-center rounded bg-[#070b08] border border-[#1b251e] space-y-1">
                <div className="text-slate-400 text-[10px]">
                  {isScanningPeers
                    ? 'Scanning BLE and Wi-Fi Direct frequencies...'
                    : 'No unlinked FIELDLINK endpoints detected in immediate radio range.'}
                </div>
                <div className="text-[9px] text-[#9DBB72]">
                  Transceiver active. Any unlinked device using FIELDLINK within ~100m will appear here.
                </div>
              </div>
            ) : (
              unlinkedDiscoveredPeers.map((peer) => (
                <div
                  key={peer.endpointId}
                  className={`p-2.5 rounded bg-[#090d16] border flex items-center justify-between ${
                    peer.keyMismatch ? 'border-red-600/70' : 'border-[#35D5D9]/40'
                  }`}
                >
                  <div>
                    <div className="font-bold text-white text-[11px] flex items-center gap-1.5">
                      <span>{peer.callsign}</span>
                      {peer.keyMismatch && (
                        <span className="text-[8px] px-1.5 py-0.2 rounded bg-red-950 border border-red-600 text-red-300 font-black">
                          KEY BLOCKED
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-400">ID: {peer.endpointId}</div>
                  </div>
                  <button
                    onClick={() => openLinkDialog(peer)}
                    className={`px-3 py-1 rounded text-[10px] font-bold flex items-center gap-1 border ${
                      peer.keyMismatch
                        ? 'bg-red-950/70 text-red-200 border-red-700 hover:bg-red-900/70'
                        : 'bg-[#0c404a] text-[#35D5D9] border-[#166c7d] hover:bg-[#125866]'
                    }`}
                  >
                    <Radio className="w-3 h-3" />
                    <span>{peer.keyMismatch ? 'SET KEY' : 'PAIR'}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Link Operator & Mission Key Confirmation Dialog */}
      {linkingPeer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-md select-none">
          <div className="w-full max-w-sm rounded bg-[#0d1410] border border-[#35D5D9] p-3.5 space-y-3 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-[#1b2b20] pb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[#35D5D9]" />
                <span className="font-bold text-white text-xs">LINK WITH {linkingPeer.callsign}</span>
              </div>
              <button onClick={() => setLinkingPeer(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[10px] text-slate-300 space-y-2">
              <p className="leading-relaxed">
                FIELDLINK secures all mesh telemetry, waypoints, and drawings with hardware <strong className="text-[#35D5D9]">AES-256-GCM</strong> cipher.
              </p>
              <div className="p-2 rounded bg-amber-950/40 border border-amber-800/80 text-amber-200 text-[9px] leading-tight">
                <strong>CRITICAL:</strong> All connected devices must use the <strong>identical Mission Key</strong>. If keys differ, packets are rejected for security.
              </div>

              <div className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-1.5">
                <div className="flex justify-between items-center text-[9px]">
                  <span className="text-slate-400 uppercase font-bold">Mission Passphrase</span>
                  <span className={isDefaultKey && !linkMissionKeyInput.trim() ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {isDefaultKey && !linkMissionKeyInput.trim() ? 'DEFAULT' : activeMissionKeyMasked || 'CUSTOM KEY'}
                  </span>
                </div>
                <input
                  type="password"
                  placeholder={isDefaultKey ? 'LEAVE BLANK FOR DEFAULT OR ENTER KEY' : 'LEAVE BLANK TO KEEP CURRENT OR ENTER NEW KEY'}
                  value={linkMissionKeyInput}
                  onChange={(e) => setLinkMissionKeyInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#101712] border border-[#233125] text-white text-[10.5px] font-mono focus:outline-none focus:border-[#35D5D9]"
                />
                <div className="text-[8.5px] text-slate-400">
                  Ensure <strong>{linkingPeer.callsign}</strong> enters this exact same phrase.
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1 border-t border-[#1b251e]">
              <button
                onClick={() => setLinkingPeer(null)}
                className="flex-1 py-1.5 rounded bg-[#101712] border border-[#233125] text-slate-400 text-xs font-bold hover:text-white"
              >
                CANCEL
              </button>
              <button
                onClick={async () => {
                  const peerId = linkingPeer.endpointId;
                  setLinkingPeer(null);
                  const newKey = linkMissionKeyInput.trim();
                  if (newKey) {
                    try {
                      await NativeNearby.setMissionKey({ key: newKey });
                      const masked = newKey.length <= 3 ? '••••••' : `${newKey.substring(0, 3)}••••••`;
                      onKeyUpdated(masked);
                    } catch {
                      // Ignore error and proceed with existing key
                    }
                  }
                  await handleConnectPeer(peerId);
                }}
                className="flex-1 py-1.5 rounded bg-[#0c404a] text-[#35D5D9] border border-[#166c7d] text-xs font-bold hover:bg-[#125866] flex items-center justify-center gap-1.5"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>CONFIRM & LINK</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
