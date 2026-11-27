import React, { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { ThinkingStep } from '@shared/types';
import { PixelLoader } from './PixelLoader';

interface ThinkingTraceProps {
  steps: ThinkingStep[];
  isStreaming: boolean;
  hasContent: boolean;
  durationMs?: number;
}

export function ThinkingTrace({
  steps,
  isStreaming,
  hasContent,
  durationMs,
}: ThinkingTraceProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  if (steps.length === 0 && !isStreaming) return null;

  const isThinkingPhase = isStreaming && !hasContent;
  const elapsedSec =
    durationMs !== undefined ? Math.max(0.1, durationMs / 1000).toFixed(1) : null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      >
        {isThinkingPhase ? (
          <PixelLoader label="Thinking" />
        ) : (
          <>
            <ChevronRight
              className={`h-3.5 w-3.5 text-[var(--ink-3)] transition-transform duration-150 ${
                open ? 'rotate-90' : ''
              }`}
            />
            <span>
              {isStreaming
                ? 'Streaming answer'
                : elapsedSec
                  ? `Thought for ${elapsedSec}s`
                  : 'View steps'}
            </span>
            <span className="rounded-[5px] bg-[var(--field)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-3)]">
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
            </span>
          </>
        )}
      </button>

      {(open || isThinkingPhase) && steps.length > 0 && (
        <div className="mt-1.5 ml-2 border-l border-[var(--line)] pl-3 space-y-1.5 py-0.5">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 text-[11.5px]">
              <span
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                style={
                  step.status === 'done'
                    ? { background: 'var(--green-tint)', color: 'var(--green)' }
                    : { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
                }
              >
                {step.status === 'done' ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                )}
              </span>
              <div className="min-w-0 leading-snug">
                <span className="text-[var(--ink-2)]">{step.label}</span>
                {step.detail && (
                  <span className="ml-1.5 rounded bg-[var(--field)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-3)]">
                    {step.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
