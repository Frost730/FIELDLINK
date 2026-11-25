import React from 'react';
import { Menu, Settings } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const TacticalHeader: React.FC = () => {
  const { setDrawerOpen, setActiveModal, isNightMode } = useTacticalStore();

  return (
    <header
      className={`h-11 px-3 flex items-center justify-between border-b transition-colors select-none z-30 safe-top ${
        isNightMode
          ? 'bg-[#180505] border-[#4a1212]'
          : 'bg-[#050606] border-[#1b241e]'
      }`}
    >
      {/* Left: Tactical Hamburger Button */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-9 h-9 flex items-center justify-center rounded text-slate-300 hover:text-white active:scale-95 transition-transform"
        aria-label="Open Tactical Menu"
      >
        <Menu className="w-5 h-5 stroke-[2.2]" />
      </button>

      {/* Center: FIELDLINK Tactical Wordmark */}
      <div className="flex items-center tracking-[0.25em] font-extrabold text-base">
        <span className={isNightMode ? 'text-red-500' : 'text-[#9DBB72]'}>FIELD</span>
        <span className={isNightMode ? 'text-red-300' : 'text-[#D1A34A]'}>LINK</span>
      </div>

      {/* Right: Settings Icon */}
      <button
        onClick={() => setActiveModal('settings')}
        className="w-9 h-9 flex items-center justify-center rounded text-slate-300 hover:text-white active:scale-95 transition-transform"
        aria-label="Tactical Settings"
      >
        <Settings className="w-5 h-5 stroke-[2]" />
      </button>
    </header>
  );
};
