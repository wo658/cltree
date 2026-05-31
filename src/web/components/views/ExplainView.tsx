import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ExplainViewData } from '@shared/types';
import { MarkdownRenderer } from '@web/components/common/MarkdownRenderer';
import { ExplainStepper } from './explain/ExplainStepper';
import { ExplainCodeViewer } from './explain/ExplainCodeViewer';
import { MermaidDiagram } from './explain/MermaidDiagram';

interface ExplainViewProps {
  data: ExplainViewData;
}

/** Custom hook to auto-follow when the step count changes */
function useAutoFollow(stepsLength: number) {
  const [currentStep, setCurrentStep] = useState(0);
  const [prevLen, setPrevLen] = useState(stepsLength);

  if (stepsLength > prevLen && stepsLength > 0) {
    if (currentStep >= prevLen - 1) {
      setPrevLen(stepsLength);
      setCurrentStep(stepsLength - 1);
    } else {
      setPrevLen(stepsLength);
    }
  } else if (stepsLength !== prevLen) {
    setPrevLen(stepsLength);
  }

  return [currentStep, setCurrentStep] as const;
}

/** Step-by-step code explanation view */
export function ExplainView({ data: raw }: ExplainViewProps) {
  const data: ExplainViewData = {
    title: raw?.title || 'Explanation',
    currentStep: raw?.currentStep ?? 0,
    steps: raw?.steps || [],
    completed: raw?.completed ?? false,
  };
  const [currentStep, setCurrentStep] = useAutoFollow(data.steps.length);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentStep > 0) {
        setCurrentStep((s) => s - 1);
      } else if (e.key === 'ArrowRight' && currentStep < data.steps.length - 1) {
        setCurrentStep((s) => s + 1);
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [currentStep, data.steps.length, setCurrentStep]);

  const step = data.steps[currentStep];
  const hasMermaid = !!step?.mermaid;
  const hasCode = !hasMermaid && !!step?.codeSnippet;
  const hasContent = hasMermaid || hasCode;
  const hasDesc = !!step?.markdown;

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-zinc-900 outline-none"
      tabIndex={0}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-100 truncate">{data.title}</h3>
        <div className="flex items-center gap-2">
          {data.steps.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
                disabled={currentStep === 0}
                className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-not-allowed transition-colors rounded hover:bg-zinc-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-500 tabular-nums min-w-[3ch] text-center">
                {currentStep + 1}/{data.steps.length}
              </span>
              <button
                onClick={() => setCurrentStep((s) => Math.min(data.steps.length - 1, s + 1))}
                disabled={currentStep >= data.steps.length - 1}
                className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-not-allowed transition-colors rounded hover:bg-zinc-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
          {!data.completed && (
            <span className="flex items-center gap-1 text-blue-400 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </span>
          )}
        </div>
      </div>

      {/* Stepper bar */}
      <ExplainStepper
        steps={data.steps}
        current={currentStep}
        completed={data.completed}
        onSelect={setCurrentStep}
      />

      {/* Step body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {step ? (
          <>
            {/* ── content: fits to content size (max 60vh) ── */}
            {hasContent && (
              <div className="min-h-0">
                {hasMermaid && <MermaidDiagram source={step.mermaid!} />}
                {hasCode && (
                  <ExplainCodeViewer
                    code={step.codeSnippet!}
                    language={step.language}
                    codeRef={step.codeRef}
                    highlightLines={step.highlightLines}
                    annotations={step.annotations}
                  />
                )}
              </div>
            )}

            {/* ── description: flows naturally, scrolled by parent overflow-auto ── */}
            {hasDesc && (
              <div className={`px-4 py-3 ${hasContent ? 'border-t border-zinc-800' : ''}`}>
                <MarkdownRenderer content={step.markdown} />
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {data.completed ? 'Explanation is empty' : 'Agent is adding steps…'}
          </div>
        )}
      </div>
    </div>
  );
}
