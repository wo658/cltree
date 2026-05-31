import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { MermaidDiagram } from '@web/components/views/explain/MermaidDiagram';

interface MarkdownRendererProps {
  content: string;
  /** Additional CSS classes */
  className?: string;
}

/** Shared Markdown renderer. GitHub-style dark theme. */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-zinc-100 border-b border-zinc-700 pb-2 mb-3 mt-4 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-zinc-100 border-b border-zinc-800 pb-1.5 mb-2.5 mt-3.5 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-zinc-200 mb-2 mt-3 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[13px] text-zinc-300 leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1 text-[13px] text-zinc-300">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-3 space-y-1 text-[13px] text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-600 pl-3 my-3 text-zinc-400 italic">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');

    // mermaid code block → render as diagram
    if (className?.includes('language-mermaid')) {
      const source = String(children).replace(/\n$/, '');
      return (
        <div className="my-3 max-h-[400px] rounded-md border border-zinc-800 overflow-hidden">
          <MermaidDiagram source={source} />
        </div>
      );
    }

    // fenced code block → <pre><code> style
    if (isBlock) {
      const lang = className?.replace('language-', '') || '';
      const text = String(children).replace(/\n$/, '');
      return (
        <code
          className="block whitespace-pre overflow-x-auto rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2.5 my-3 text-xs text-zinc-300 font-mono leading-relaxed"
          data-lang={lang}
        >
          {text}
        </code>
      );
    }

    // inline code
    return (
      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 font-mono">{children}</code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-3">
      <table className="min-w-full text-xs text-zinc-300 border border-zinc-800">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-zinc-800/80 px-3 py-1.5 text-left font-medium text-zinc-200 border-b border-zinc-700">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-1.5 border-b border-zinc-800/50">{children}</td>,
  hr: () => <hr className="border-zinc-800 my-4" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} className="max-w-full rounded-md my-3 border border-zinc-800" />
  ),
  input: ({ checked, ...rest }) => (
    <input
      {...rest}
      checked={checked}
      disabled
      className="mr-1.5 accent-green-500"
    />
  ),
};
