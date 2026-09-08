export interface DetectedTicker {
  symbol: string;
  isCrypto: boolean;
  tradingViewUrl: string;
  yahooFinanceUrl: string;
}

const COMMON_CRYPTO = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "MATIC"]);

const STOP_WORDS = new Set([
  "A", "I", "AN", "THE", "AND", "FOR", "ARE", "BUT", "NOT", "OR", "ON", "AT",
  "TO", "IN", "SO", "IF", "IT", "BY", "AS", "BE", "DO", "HE", "WE", "ME",
  "MY", "UP", "NO", "GO", "US", "AM", "IS", "ALL", "NEW", "NOW", "OFF", "OUT",
  "SEE", "SET", "TOP", "WAR", "CAN", "GET", "HAS", "HAD", "HER", "HIM", "HIS",
  "HOW", "ITS", "LET", "MAY", "OUR", "SAY", "SHE", "TOO", "USE", "WHO", "WHY"
]);

/**
 * Extracts stock and crypto tickers from text.
 * Matches explicit cashtags ($NVDA) and exchange-prefixed or bare tickers.
 */
export function extractTickers(text: string): DetectedTicker[] {
  if (!text) return [];

  // Match $SYMBOL or NASDAQ:SYMBOL or standalone capitalized 2-5 letter tickers
  const regex = /(?:\$([A-Z0-9]{2,6})\b)|(?:\b(?:NASDAQ|NYSE|AMEX):([A-Z]{1,5})\b)/g;
  const found = new Map<string, DetectedTicker>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawSymbol = match[1] || match[2];
    if (!rawSymbol) continue;
    const cleanSymbol = rawSymbol.toUpperCase();

    if (STOP_WORDS.has(cleanSymbol)) continue;

    if (!found.has(cleanSymbol)) {
      const isCrypto = COMMON_CRYPTO.has(cleanSymbol);
      const tvSymbol = isCrypto ? `${cleanSymbol}USD` : cleanSymbol;
      const yfSymbol = isCrypto ? `${cleanSymbol}-USD` : cleanSymbol;

      found.set(cleanSymbol, {
        symbol: cleanSymbol,
        isCrypto,
        tradingViewUrl: `https://www.tradingview.com/symbols/${tvSymbol}/`,
        yahooFinanceUrl: `https://finance.yahoo.com/quote/${yfSymbol}`,
      });
    }
  }

  return Array.from(found.values());
}
