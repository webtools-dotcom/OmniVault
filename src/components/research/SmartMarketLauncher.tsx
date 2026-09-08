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
          className="inline-flex items-center rounded-lg bg-emerald-500/[0.06] border border-emerald-500/25 p-0.5 text-xs shadow-xs hover:border-emerald-500/40 transition-colors"
        >
          <span className="font-mono font-bold text-emerald-400 px-2 py-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span>${t.symbol}</span>
          </span>

          <div className="flex items-center border-l border-emerald-500/20 pl-0.5 gap-0.5">
            <a
              href={t.tradingViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors flex items-center gap-0.5"
              title={`Launch ${t.symbol} on TradingView`}
            >
              <span>TV</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>

            <a
              href={t.yahooFinanceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 transition-colors flex items-center gap-0.5"
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-vault-secondary hover:text-vault-primary hover:border-blue-500/40 hover:bg-blue-500/[0.04] transition-all duration-150"
          title={l.url}
        >
          <LineChart className="w-3 h-3 text-amber-400" />
          <span className="truncate max-w-[140px] font-mono text-[11px]">{l.domain}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0 text-vault-muted" />
        </a>
      ))}
    </div>
  );
};
