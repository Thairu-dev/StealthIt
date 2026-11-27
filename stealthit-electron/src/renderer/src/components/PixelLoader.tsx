import React, { useEffect, useState } from 'react';

interface PixelLoaderProps {
  label?: string;
}

const DELAYS = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.98, 1.12];

export function PixelLoader({ label = 'Thinking' }: PixelLoaderProps): React.JSX.Element {
  const [tenths, setTenths] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      setTenths(Math.floor((Date.now() - start) / 100));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="inline-flex items-center gap-2.5 py-1">
      <div className="grid grid-cols-3 gap-[2.5px]" aria-hidden="true">
        {DELAYS.map((delay, i) => (
          <span
            key={i}
            className="pixel-dot h-[4px] w-[4px] rounded-[1px]"
            style={{ background: 'var(--accent)', animationDelay: `${delay}s` }}
          />
        ))}
      </div>
      <span className="shimmer-label text-[12.5px] font-medium">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--ink-3)]">
        {(tenths / 10).toFixed(1)}s
      </span>
    </div>
  );
}
