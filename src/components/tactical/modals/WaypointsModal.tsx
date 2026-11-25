import React, { useState } from 'react';
import { Plus, Trash2, LocateFixed } from 'lucide-react';
import { useTacticalStore } from '../../../store/useTacticalStore';
import {
  getMGRS,
  formatDMS,
  formatCoordinateString,
  calculateDistanceKm,
  getCallsignColor,
} from '../../../utils/coordinates';
import { FieldlinkMeshService } from '../../../services/native/FieldlinkNearby';

interface WaypointsModalProps {
  onCenterMap?: (targetLat?: number, targetLon?: number) => void;
  formatDist: (km?: number) => string;
}

export const WaypointsModal: React.FC<WaypointsModalProps> = ({ onCenterMap, formatDist }) => {
  const {
    waypoints,
    addWaypoint,
    removeWaypoint,
    lat,
    lon,
    callsign,
    isLeader,
    selectedTarget,
    setSelectedTarget,
    setActiveModal,
    hasGpsFix,
    coordFormat,
  } = useTacticalStore();

  const [newWpName, setNewWpName] = useState('');
  const [newWpCategory, setNewWpCategory] = useState<
    'RP' | 'OBJ' | 'MP' | 'CAMP' | 'VEH' | 'H2O' | 'MED' | 'HAZARD' | 'SOS' | 'CUSTOM'
  >('RP');
  const [newWpDesc, setNewWpDesc] = useState('');
  const [wpTargetSource, setWpTargetSource] = useState<'GPS' | 'SELECTED'>('SELECTED');

  const handleAddWaypointSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWpName.trim()) return;

    const useSelected = wpTargetSource === 'SELECTED' && selectedTarget;
    const targetLat = useSelected ? selectedTarget.lat : lat;
    const targetLon = useSelected ? selectedTarget.lon : lon;

    const wpId = `wp-${callsign}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newWp = {
      id: wpId,
      name: newWpName.trim().toUpperCase(),
      category: newWpCategory,
      lat: targetLat,
      lon: targetLon,
      description: newWpDesc.trim(),
      createdBy: callsign,
    };

    addWaypoint(newWp);
    FieldlinkMeshService.broadcastWaypoint(newWp);

    setNewWpName('');
    setNewWpDesc('');
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleAddWaypointSubmit} className="p-2.5 rounded bg-[#070b08] border border-[#1b251e] space-y-2">
        <div className="text-[11px] font-bold text-white uppercase flex items-center justify-between">
          <span>Record Tactical Marker / Sign</span>
          <span className="text-[#9DBB72]">
            {getMGRS(
              wpTargetSource === 'SELECTED' && selectedTarget ? selectedTarget.lat : lat,
              wpTargetSource === 'SELECTED' && selectedTarget ? selectedTarget.lon : lon
            )}
          </span>
        </div>

        {selectedTarget && (
          <div className="flex gap-1.5 p-1 rounded bg-[#101712] border border-[#233125] text-[10px]">
            <button
              type="button"
              onClick={() => setWpTargetSource('SELECTED')}
              className={`flex-1 py-1 rounded font-bold transition-colors ${
                wpTargetSource === 'SELECTED'
                  ? 'bg-[#1b2d20] text-cyan-300 border border-cyan-800'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Selected Map Point
            </button>
            <button
              type="button"
              onClick={() => setWpTargetSource('GPS')}
              className={`flex-1 py-1 rounded font-bold transition-colors ${
                wpTargetSource === 'GPS'
                  ? 'bg-[#1b2d20] text-[#9DBB72] border border-[#2b3d2f]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              My Current GPS
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="POI NAME"
            value={newWpName}
            onChange={(e) => setNewWpName(e.target.value)}
            className="col-span-2 px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white placeholder-slate-500 focus:outline-none focus:border-[#9DBB72]"
          />
          <select
            value={newWpCategory}
            onChange={(e) => setNewWpCategory(e.target.value as typeof newWpCategory)}
            className="px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white focus:outline-none focus:border-[#9DBB72]"
          >
            <option value="RP">RP (Rally Point)</option>
            <option value="OBJ">OBJ (Objective)</option>
            <option value="MP">MP (Meeting Point)</option>
            <option value="CAMP">CAMP (Base Camp)</option>
            <option value="VEH">VEH (Vehicle)</option>
            <option value="H2O">H2O (Water Source)</option>
            <option value="MED">MED (Medical Point)</option>
            <option value="HAZARD">HAZARD (Danger Area)</option>
            <option value="SOS">SOS (Distress Site)</option>
            <option value="CUSTOM">CUSTOM (Target POI)</option>
          </select>
        </div>

        <input
          type="text"
          placeholder="Notes / Tactical Description"
          value={newWpDesc}
          onChange={(e) => setNewWpDesc(e.target.value)}
          className="w-full px-2 py-1.5 rounded bg-[#101712] border border-[#233125] text-white placeholder-slate-500 focus:outline-none focus:border-[#9DBB72]"
        />

        <button
          type="submit"
          className="w-full py-1.5 rounded bg-[#203423] hover:bg-[#2a452d] border border-[#3e5e43] text-[#9DBB72] font-bold flex items-center justify-center gap-1.5 transition-colors uppercase tracking-wider text-[10px]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Save Target Coordinate</span>
        </button>
      </form>

      <div className="space-y-2">
        <div className="text-[11px] text-slate-400 font-bold uppercase">
          Saved Waypoints ({waypoints.length})
        </div>
        {waypoints.length === 0 ? (
          <div className="p-4 text-center rounded bg-[#070b08] border border-[#1b251e] text-slate-500 text-[10px]">
            No waypoints recorded. Tap above to pin your current coordinates.
          </div>
        ) : (
          waypoints.map((wp) => {
            const canDelete = isLeader || !wp.createdBy || wp.createdBy === callsign;
            const creator = wp.createdBy || 'OPERATOR';
            const isMyWp = wp.createdBy === callsign;
            const userCol = getCallsignColor(creator);

            return (
              <div
                key={wp.id}
                className="p-2 rounded bg-[#070b08] border flex items-center justify-between"
                style={{ borderLeft: `3px solid ${userCol.hex}`, borderColor: '#1b251e', borderLeftColor: userCol.hex }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: userCol.hex }} />
                    <span className="font-bold text-white">{wp.name}</span>
                    <span
                      className="px-1.5 py-0.2 rounded text-[9px] border font-semibold"
                      style={{ backgroundColor: userCol.bgHex, borderColor: userCol.borderHex, color: userCol.hex }}
                    >
                      {wp.category}
                    </span>
                    <span
                      className="px-1.5 py-0.2 rounded text-[8px] font-mono border font-bold"
                      style={{ border: `1px solid ${userCol.hex}`, color: userCol.hex, backgroundColor: 'rgba(0,0,0,0.6)' }}
                    >
                      BY: {creator} {isMyWp ? '(YOU)' : ''}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {formatCoordinateString(wp.lat, wp.lon, coordFormat)} •{' '}
                    {hasGpsFix ? `${formatDist(calculateDistanceKm(lat, lon, wp.lat, wp.lon))} AWAY` : formatDMS(wp.lat, true)}
                  </div>
                  {wp.description && (
                    <div className="text-[10px] text-slate-500 italic mt-0.5">{wp.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setSelectedTarget({ lat: wp.lat, lon: wp.lon, name: wp.name });
                      if (onCenterMap) onCenterMap(wp.lat, wp.lon);
                      setActiveModal(null);
                    }}
                    className="px-2 py-1 rounded bg-[#101712] border border-[#233125] text-cyan-300 hover:text-white flex items-center gap-1 text-[10px]"
                    title="View on Map"
                  >
                    <LocateFixed className="w-3 h-3" />
                    <span>VIEW</span>
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => {
                        removeWaypoint(wp.id);
                        FieldlinkMeshService.broadcastDeleteWaypoint(wp.id);
                      }}
                      className={`w-7 h-7 flex items-center justify-center rounded ${
                        isLeader
                          ? 'bg-red-950/40 border border-red-800/60 text-amber-400 hover:text-red-300'
                          : 'text-slate-500 hover:text-red-400'
                      }`}
                      title={isLeader ? 'Leader Authority: Purge from all devices in cluster' : 'Delete Waypoint'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
