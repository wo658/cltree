import { useRef, useEffect, useCallback, useMemo } from 'react';
import Editor, { type OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { CodeAnnotation } from '@shared/types';

/** Configure to use the local monaco-editor instance (instead of CDN) */
loader.config({ monaco });

interface ExplainCodeViewerProps {
  code: string;
  language?: string;
  codeRef?: string;
  highlightLines?: number[];
  annotations?: CodeAnnotation[];
}

/** Language alias mapping */
const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', yml: 'yaml', yaml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php',
  json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', md: 'markdown', graphql: 'graphql',
};

/** Infer language from file extension in codeRef (e.g. "src/auth.ts:10-25") */
function inferLangFromRef(ref?: string): string | undefined {
  if (!ref) return undefined;
  const filePart = ref.split(':')[0];
  const ext = filePart.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return LANG_MAP[ext] || ext;
}

/** Monaco-based read-only code viewer */
export function ExplainCodeViewer({
  code,
  language,
  codeRef,
  highlightLines = [],
  annotations = [],
}: ExplainCodeViewerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decorationsRef = useRef<any>(null);

  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // Remove previous decorations
    if (decorationsRef.current) {
      decorationsRef.current.clear();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = [];

    // Line highlight
    for (const line of highlightLines) {
      items.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'explain-highlight-line',
          glyphMarginClassName: 'explain-highlight-glyph',
        },
      });
    }

    // annotation: inline text
    for (const ann of annotations) {
      const endLine = ann.endLine ?? ann.line;
      items.push({
        range: new monaco.Range(ann.line, 1, endLine, 1),
        options: {
          isWholeLine: true,
          className: 'explain-annotation-line',
          after: {
            content: `  // ${ann.text}`,
            inlineClassName: 'explain-annotation-text',
          },
        },
      });
    }

    decorationsRef.current = editor.createDecorationsCollection(items);
  }, [highlightLines, annotations]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyDecorations();
  };

  // Re-apply when highlight/annotation changes
  useEffect(() => {
    applyDecorations();
  }, [applyDecorations]);

  const monacoLang = language
    ? (LANG_MAP[language] || language)
    : (inferLangFromRef(codeRef) || 'plaintext');

  // Height based on line count: lineHeight(20) * lines + padding(8+8) + codeRef header(30)
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const codeRefHeight = codeRef ? 30 : 0;
  const editorHeight = lineCount * 20 + 16;
  const totalHeight = editorHeight + codeRefHeight;

  return (
    <div className="flex flex-col" style={{ height: totalHeight }}>
      {codeRef && (
        <div className="flex-shrink-0 px-3 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-800 font-mono bg-zinc-900/50">
          {codeRef}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Editor
          value={code}
          language={monacoLang}
          theme="vs-dark"
          onMount={handleMount}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderLineHighlight: 'none',
            fontSize: 12,
            lineHeight: 20,
            padding: { top: 8, bottom: 8 },
            folding: false,
            glyphMargin: highlightLines.length > 0,
            overviewRulerLanes: 0,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            wordWrap: 'off',
            contextmenu: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
