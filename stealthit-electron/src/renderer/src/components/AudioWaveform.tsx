import React from 'react';

interface AudioWaveformProps {
  level: number; // 0..1
  active: boolean;
}

const BAR_WEIGHTS = [0.45, 0.85, 1.0, 0.72, 0.5];

export function AudioWaveform({ level, active }: AudioWaveformProps): React.JSX.Element {
  return (
    <div className="flex h-3.5 items-center gap-[2px]" aria-hidden="true">
      {BAR_WEIGHTS.map((weight, idx) => {
        const heightPct = active
          ? Math.max(22, Math.min(100, Math.round((0.18 + level * 0.95) * weight * 100)))
          : 22;
        return (
          <span
            key={idx}
            className="w-[2.5px] rounded-full bg-current transition-all duration-75"
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}
