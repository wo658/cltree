import { Check, Loader2 } from 'lucide-react';
import type { ExplainStep } from '@shared/types';

interface ExplainStepperProps {
  steps: ExplainStep[];
  current: number;
  completed: boolean;
  onSelect: (index: number) => void;
}

/** shadcn-style horizontal stepper */
export function ExplainStepper({ steps, current, completed, onSelect }: ExplainStepperProps) {
  if (steps.length === 0 && !completed) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50">
        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
        <span className="text-xs text-zinc-500">Agent is adding steps…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 overflow-x-auto">
      {steps.map((step, i) => {
        const isActive = i === current;
        const isDone = i < current;
        const isLast = i === steps.length - 1;

        return (
          <div key={i} className="flex items-center flex-shrink-0">
            {/* Step circle */}
            <button
              onClick={() => onSelect(i)}
              className="flex items-center gap-2 group"
            >
              <div
                className={`
                  flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium
                  transition-all border-2
                  ${isActive
                    ? 'border-blue-500 bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                    : isDone
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-500 group-hover:border-zinc-600 group-hover:text-zinc-400'
                  }
                `}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              {/* Step label (shown only when active) */}
              {isActive && step.markdown && (
                <span className="text-[11px] text-zinc-400 max-w-[120px] truncate hidden sm:inline">
                  {step.markdown.replace(/^#+\s*/, '').slice(0, 30)}
                </span>
              )}
            </button>

            {/* Connector line */}
            {!isLast && (
              <div
                className={`w-6 h-0.5 mx-1 transition-colors ${
                  isDone ? 'bg-blue-500/40' : 'bg-zinc-700'
                }`}
              />
            )}
          </div>
        );
      })}

      {/* In-progress indicator */}
      {!completed && steps.length > 0 && (
        <>
          <div className="w-6 h-0.5 mx-1 bg-zinc-700" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Loader2 className="w-3.5 h-3.5 text-zinc-600 animate-spin" />
          </div>
        </>
      )}
    </div>
  );
}
