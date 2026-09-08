import React from "react";
import { ExternalLink, LineChart, TrendingUp } from "lucide-react";
import { DetectedTicker } from "../../utils/tickerDetector";
import { DetectedLink } from "../../utils/linkDetector";

export interface SmartMarketLauncherProps {
  tickers: DetectedTicker[];
  links?: DetectedLink[];
}

export const SmartMarketLauncher: React.FC<SmartMarketLauncherProps> = ({ tickers, links = [] }) => {
  if (tickers.length === 0 && links.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 select-none" onClick={(e) => e.stopPropagation()}>
      {/* Tickers */}
      {tickers.map((t) => (
        <div
          key={t.symbol}
          className="inline-flex items-center rounded-md bg-vault-bg border border-vault-border p-0.5 text-xs shadow-xs hover:border-vault-border-active transition-colors"
        >
          <span className="font-mono font-bold text-vault-success px-2 py-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-vault-success" />
            <span>${t.symbol}</span>
          </span>

          <div className="flex items-center border-l border-vault-border/60 pl-0.5">
            <a
              href={t.tradingViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded text-[11px] font-medium text-vault-accent hover:bg-vault-card transition-colors flex items-center gap-0.5"
              title={`Launch ${t.symbol} on TradingView`}
            >
              <span>TV</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>

            <a
              href={t.yahooFinanceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded text-[11px] font-medium text-vault-secondary hover:text-vault-primary hover:bg-vault-card transition-colors flex items-center gap-0.5"
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
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-secondary hover:text-vault-primary hover:border-vault-border-active transition-colors"
          title={l.url}
        >
          <LineChart className="w-3 h-3 text-vault-pending" />
          <span className="truncate max-w-[140px] font-mono text-[11px]">{l.domain}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
        </a>
      ))}
    </div>
  );
};
