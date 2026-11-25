import React from 'react';
import {
  X,
  Map,
  Users,
  Radio,
  FolderDown,
  Navigation,
  Pencil,
  AlertOctagon,
  Settings,
  Shield,
  ChevronRight,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const TacticalDrawer: React.FC = () => {
  const {
    isDrawerOpen,
    setDrawerOpen,
    setActiveModal,
    callsign,
    squadMembers,
    isNightMode,
  } = useTacticalStore();

  if (!isDrawerOpen) return null;

  const menuItems = [
    {
      id: 'map',
      label: 'TACTICAL MAP',
      sublabel: 'PRIMARY CANVAS & HUD',
      icon: Map,
      onClick: () => setDrawerOpen(false),
      active: true,
    },
    {
      id: 'squad',
      label: 'SQUAD MANAGEMENT',
      sublabel: `${squadMembers.length} ACTIVE NODES LINKED`,
      icon: Users,
      badge: squadMembers.length > 0 ? `${squadMembers.length} ACTIVE` : '0 NODES',
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('squad');
      },
    },
    {
      id: 'nearby',
      label: 'NEARBY DEVICES',
      sublabel: 'RF & MESH TRANSCEIVER',
      icon: Radio,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('nearby');
      },
    },
    {
      id: 'offline_maps',
      label: 'OFFLINE MAPS',
      sublabel: 'OFFLINE TILES',
      icon: FolderDown,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('offline_maps');
      },
    },
    {
      id: 'waypoints',
      label: 'WAYPOINTS',
      sublabel: 'SAVED TARGETS',
      icon: Navigation,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('waypoints');
      },
    },
    {
      id: 'measure',
      label: 'NAVIGATION & MEASURE',
      sublabel: 'BEARING & RANGEFINDING',
      icon: Pencil,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('measure');
      },
    },
    {
      id: 'sos',
      label: 'SOS EMERGENCY BEACON',
      sublabel: 'DISTRESS BEACON',
      icon: AlertOctagon,
      isEmergency: true,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('sos');
      },
    },
    {
      id: 'settings',
      label: 'SETTINGS',
      sublabel: 'CONFIGURATION',
      icon: Settings,
      onClick: () => {
        setDrawerOpen(false);
        setActiveModal('settings');
      },
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex select-none">
      {/* Backdrop */}
      <div
        onClick={() => setDrawerOpen(false)}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer Container */}
      <div
        className={`relative w-80 max-w-[85vw] h-full flex flex-col border-r shadow-2xl z-10 safe-top safe-bottom ${
          isNightMode
            ? 'bg-[#120404] border-[#4a1212] text-red-200'
            : 'bg-[#0a0f0c] border-[#1e2a20] text-slate-100'
        }`}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#1b261d] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#131c15] border border-[#2b3a2d] flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#9DBB72]" />
            </div>
            <div>
              <div className="text-xs font-mono-tactical font-bold text-white tracking-widest uppercase">
                {callsign}
              </div>
              <div className="text-[10px] font-mono-tactical text-[#9DBB72] tracking-wider">
                TACTICAL MESH • OPERATIONAL
              </div>
            </div>
          </div>

          <button
            onClick={() => setDrawerOpen(false)}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`w-full p-2.5 rounded flex items-center justify-between text-left transition-colors ${
                  item.isEmergency
                    ? 'bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-200'
                    : item.active
                    ? 'bg-[#18241b] border border-[#2e4233] text-white'
                    : 'hover:bg-[#121a14] border border-transparent text-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded flex items-center justify-center ${
                      item.isEmergency
                        ? 'bg-red-600/30 text-red-400'
                        : item.active
                        ? 'bg-[#9DBB72]/20 text-[#9DBB72]'
                        : 'bg-[#121a14] text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-mono-tactical font-bold tracking-wide">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono-tactical">
                      {item.sublabel}
                    </div>
                  </div>
                </div>

                {item.badge ? (
                  <span className="text-[9px] font-mono-tactical px-1.5 py-0.5 rounded bg-[#18241b] border border-[#2e4233] text-[#9DBB72]">
                    {item.badge}
                  </span>
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                )}
              </button>
            );
          })}
        </div>

        {/* Drawer Footer */}
        <div className="p-3 border-t border-[#1b261d] bg-[#070b08] text-[10px] font-mono-tactical text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[#9DBB72]" />
            <span>LOCAL RF MESH</span>
          </div>
          <span className="text-emerald-400">P2P_CLUSTER</span>
        </div>
      </div>
    </div>
  );
};
