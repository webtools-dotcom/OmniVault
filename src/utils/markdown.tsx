import { safeHref } from "./safeUrl";
import React from "react";

/**
 * Lightweight, zero-dependency Markdown parser tailored for OmniVault notes.
 * Parses headers, bold, italics, code blocks, bullet/numbered lists, task checkboxes,
 * links, and automatically links stock/crypto tickers ($TICKER).
 */
export function renderMarkdown(content: string): React.ReactNode[] {
  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  lines.forEach((line, index) => {
    // Fenced code blocks
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${index}`}
            className="p-3 my-2 rounded-lg bg-vault-bg border border-vault-border font-mono text-xs text-vault-primary overflow-x-auto"
          >
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(
        <h1
          key={`h1-${index}`}
          className="text-lg font-bold text-vault-primary mt-3 mb-1 tracking-tight"
        >
          {parseInline(line.slice(2))}
        </h1>
      );
      return;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={`h2-${index}`}
          className="text-base font-semibold text-vault-primary mt-2.5 mb-1 tracking-tight"
        >
          {parseInline(line.slice(3))}
        </h2>
      );
      return;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={`h3-${index}`}
          className="text-sm font-semibold text-vault-primary mt-2 mb-0.5"
        >
          {parseInline(line.slice(4))}
        </h3>
      );
      return;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      elements.push(
        <blockquote
          key={`quote-${index}`}
          className="pl-3 py-1 my-1.5 border-l border-vault-border text-xs text-vault-secondary italic bg-vault-card/20 rounded-r"
        >
          {parseInline(line.slice(2))}
        </blockquote>
      );
      return;
    }

    // Task list checkbox: - [ ] or - [x]
    if (line.match(/^-\s+\[([ xX])\]\s+(.*)/)) {
      const match = line.match(/^-\s+\[([ xX])\]\s+(.*)/);
      if (match) {
        const isChecked = match[1].toLowerCase() === "x";
        const taskText = match[2];
        elements.push(
          <div key={`task-${index}`} className="flex items-start gap-2 my-1 text-xs">
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              className="mt-0.5 rounded border-vault-border text-vault-accent focus:ring-0"
            />
            <span
              className={
                isChecked
                  ? "line-through text-vault-muted"
                  : "text-vault-primary"
              }
            >
              {parseInline(taskText)}
            </span>
          </div>
        );
        return;
      }
    }

    // Bullet lists
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li
          key={`bullet-${index}`}
          className="list-disc list-inside text-xs text-vault-secondary my-0.5"
        >
          {parseInline(line.slice(2))}
        </li>
      );
      return;
    }

    // Empty lines
    if (!line.trim()) {
      elements.push(<div key={`blank-${index}`} className="h-2" />);
      return;
    }

    // Normal paragraph
    elements.push(
      <p key={`p-${index}`} className="text-xs text-vault-secondary leading-relaxed my-1">
        {parseInline(line)}
      </p>
    );
  });

  return elements;
}

/**
 * Parses inline elements: bold, italic, code, links, and $TICKER tags.
 */
function parseInline(text: string): React.ReactNode {
  // Regex to match $TICKERS, links [title](url), bold **bold**, code `code`, italic *italic*
  const tokenRegex = /(\$[A-Z0-9]{2,6}\b)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    // Ticker ($NVDA, $BTC)
    if (match[1]) {
      const ticker = match[1].substring(1);
      nodes.push(
        <a
          key={`inline-ticker-${match.index}`}
          href={`https://www.tradingview.com/symbols/${ticker}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-1.5 py-0.2 mx-0.5 rounded bg-vault-elevated text-vault-success font-mono font-medium text-[0.815rem] border border-vault-border hover:border-vault-success transition-colors"
          title={`View ${ticker} on TradingView`}
          onClick={(e) => e.stopPropagation()}
        >
          {match[1]}
        </a>
      );
    }
    // Link [title](url)
    else if (match[2]) {
      const linkTitle = match[3];
      const safeLinkUrl = safeHref(match[4]);
      nodes.push(
        safeLinkUrl === null ? (
          // Not a scheme we will link. Show the text so nothing is lost, but
          // give the reader nothing to click. See D-061.
          <span key={`inline-link-${match.index}`} title={`Blocked link: ${match[4]}`}>
            {linkTitle}
          </span>
        ) : (
        <a
          key={`inline-link-${match.index}`}
          href={safeLinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-vault-accent underline hover:text-vault-accent-hover transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {linkTitle}
        </a>
        )
      );
    }
    // Bold **text**
    else if (match[5]) {
      nodes.push(
        <strong key={`inline-bold-${match.index}`} className="font-semibold text-vault-primary">
          {match[6]}
        </strong>
      );
    }
    // Code `code`
    else if (match[7]) {
      nodes.push(
        <code
          key={`inline-code-${match.index}`}
          className="px-1 py-0.5 mx-0.5 rounded bg-vault-bg text-vault-primary font-mono text-[0.815rem] border border-vault-border"
        >
          {match[8]}
        </code>
      );
    }
    // Italic *text*
    else if (match[9]) {
      nodes.push(
        <em key={`inline-italic-${match.index}`} className="italic text-vault-secondary">
          {match[10]}
        </em>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex));
  }

  return nodes.length === 1 ? nodes[0] : nodes;
}
