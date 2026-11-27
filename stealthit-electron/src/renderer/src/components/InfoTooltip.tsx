import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  align?: 'left' | 'center' | 'right';
}

export function InfoTooltip({ text, align = 'center' }: InfoTooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--accent-ink)] focus:text-[var(--accent-ink)] focus:outline-none"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute bottom-full z-50 mb-2 w-60 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-[11px] font-normal leading-relaxed text-[var(--ink)] shadow-[var(--shadow-overlay)] ${alignClass}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
