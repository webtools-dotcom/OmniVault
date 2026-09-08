import React from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListTodo,
  Quote,
  TrendingUp,
} from "lucide-react";

export interface MarkdownToolbarProps {
  onInsertSyntax: (prefix: string, suffix?: string, defaultPlaceholder?: string) => void;
}

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ onInsertSyntax }) => {
  const tools = [
    {
      label: "Heading 1",
      icon: Heading1,
      action: () => onInsertSyntax("# ", "", "Heading 1"),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      action: () => onInsertSyntax("## ", "", "Heading 2"),
    },
    {
      label: "Bold",
      icon: Bold,
      action: () => onInsertSyntax("**", "**", "bold text"),
    },
    {
      label: "Italic",
      icon: Italic,
      action: () => onInsertSyntax("*", "*", "italic text"),
    },
    {
      label: "Bullet List",
      icon: List,
      action: () => onInsertSyntax("- ", "", "List item"),
    },
    {
      label: "Task Checklist",
      icon: ListTodo,
      action: () => onInsertSyntax("- [ ] ", "", "New task"),
    },
    {
      label: "Code Block",
      icon: Code,
      action: () => onInsertSyntax("```\n", "\n```", "console.log('hello');"),
    },
    {
      label: "Quote",
      icon: Quote,
      action: () => onInsertSyntax("> ", "", "Quoted thought"),
    },
    {
      label: "Web Link",
      icon: Link,
      action: () => onInsertSyntax("[", "](https://example.com)", "Link Title"),
    },
    {
      label: "Stock / Crypto Ticker",
      icon: TrendingUp,
      action: () => onInsertSyntax("$", "", "NVDA"),
    },
  ];

  return (
    <div className="flex items-center gap-1 p-1.5 bg-vault-bg border-b border-vault-border overflow-x-auto select-none">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.label}
            type="button"
            onClick={tool.action}
            title={tool.label}
            className="w-7 h-7 flex items-center justify-center rounded text-vault-secondary hover:text-vault-primary hover:bg-vault-card transition-colors shrink-0"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
};
