import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { getBridge } from '../lib/bridge';

interface MarkdownRendererProps {
  content: string;
  streaming?: boolean;
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

function CodeBlock({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    const raw = extractText(children).replace(/\n$/, '');
    void navigator.clipboard.writeText(raw);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="relative group my-2">
      <button
        type="button"
        onClick={handleCopy}
        className="no-drag absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-zinc-200 opacity-0 backdrop-blur transition hover:bg-white/20 group-hover:opacity-100"
        title="Copy code"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-400" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>Copy</span>
          </>
        )}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function StealthLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyHref = (): void => {
    if (!href) return;
    void navigator.clipboard.writeText(href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (!href) return;
    if (e.ctrlKey || e.metaKey) {
      void getBridge().openExternal(href);
    } else {
      copyHref();
    }
  };

  return (
    <span className="group/link inline-flex max-w-full items-baseline gap-0.5 align-baseline">
      <a
        href={href}
        onClick={handleClick}
        title={
          href
            ? `${href}\nClick to copy · Ctrl+Click to open in browser`
            : undefined
        }
        className="no-drag inline-flex max-w-full cursor-pointer items-center gap-1 rounded-[5px] bg-[var(--accent-tint)] px-1.5 py-px font-medium text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2 transition hover:bg-[var(--accent)]/20 hover:decoration-[var(--accent)]"
      >
        <span className="break-all">{children}</span>
        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-75" />
      </a>
      {href && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            copyHref();
          }}
          title={copied ? 'Copied URL' : 'Copy URL'}
          aria-label={copied ? 'Copied URL' : 'Copy URL'}
          className="no-drag inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          {copied ? (
            <Check className="h-2.5 w-2.5 text-[var(--green)]" />
          ) : (
            <Copy className="h-2.5 w-2.5 opacity-60 group-hover/link:opacity-100" />
          )}
        </button>
      )}
    </span>
  );
}

export function MarkdownRenderer({
  content,
  streaming = false,
}: MarkdownRendererProps): React.JSX.Element {
  return (
    <div className="stealth-prose break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => <StealthLink href={href}>{children}</StealthLink>,
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="streaming-caret" aria-hidden="true" />}
    </div>
  );
}
