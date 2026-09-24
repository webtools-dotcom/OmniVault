import { safeHref } from "../../utils/safeUrl";
import React from "react";
import { ExternalLink, LineChart, TrendingUp } from "lucide-react";
import { DetectedTicker } from "../../utils/tickerDetector";
import { DetectedLink } from "../../utils/linkDetector";

export interface SmartMarketLauncherProps {
  tickers: DetectedTicker[];
  links?: DetectedLink[];
}

export const SmartMarketLauncher: React.FC<SmartMarketLauncherProps> = ({
  tickers,
  links = [],
}) => {
  if (tickers.length === 0 && links.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-2 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tickers */}
      {tickers.map((t) => (
        <div
          key={t.symbol}
          className="inline-flex items-center rounded-lg bg-vault-elevated p-0.5 text-xs transition-colors"
        >
          <span className="font-semibold text-vault-primary px-2 py-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-vault-secondary" />
            <span>${t.symbol}</span>
          </span>

          <div className="flex items-center border-l border-vault-border pl-0.5 gap-0.5">
            <a
              href={safeHref(t.tradingViewUrl) ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded-md text-[0.741rem] font-semibold text-vault-secondary hover:text-vault-primary hover:bg-vault-accent/10 transition-colors flex items-center gap-0.5"
              title={`Launch ${t.symbol} on TradingView`}
            >
              <span>TV</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>

            <a
              href={safeHref(t.yahooFinanceUrl) ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded-md text-[0.741rem] font-semibold text-vault-secondary hover:text-vault-primary hover:bg-vault-accent/10 transition-colors flex items-center gap-0.5"
              title={`Launch ${t.symbol} on Yahoo Finance`}
            >
              <span>YF</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      ))}

      {/* Links */}
      {links.map((l) => (
        <a
          key={l.url}
          href={safeHref(l.url) ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-vault-primary/[0.03] border border-white/[0.08] text-xs text-vault-secondary hover:text-vault-primary hover:border-vault-border-active/40 hover:bg-vault-accent/[0.04] transition-all duration-150"
          title={l.url}
        >
          <LineChart className="w-3 h-3 text-vault-pending" />
          <span className="truncate max-w-[140px] text-[0.815rem]">{l.domain}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0 text-vault-muted" />
        </a>
      ))}
    </div>
  );
};
