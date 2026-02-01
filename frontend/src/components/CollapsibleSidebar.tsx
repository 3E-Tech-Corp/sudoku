import { useState } from 'react';

interface CollapsibleSidebarProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSidebar({ title, badge, defaultOpen = false, children }: CollapsibleSidebarProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="lg:contents">
      {/* Mobile toggle bar — hidden on desktop */}
      <button
        onClick={() => setOpen(!open)}
        className="lg:hidden w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-sm font-medium text-gray-300 hover:bg-gray-700/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {badge && (
            <span className="font-mono text-xs text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">{badge}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content — always visible on desktop, toggle on mobile */}
      <div className={`lg:block ${open ? 'block' : 'hidden'}`}>
        {children}
      </div>
    </div>
  );
}
