import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Play,
  Terminal,
  RefreshCw,
  AlertCircle,
  BarChart3,
  Sliders,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  ShieldAlert,
  ChevronRight,
  Sparkles
} from 'lucide-react';

interface StockMeta {
  symbol: string;
  name: string;
  tickerClass: string;
}

const MAANG_STOCKS: StockMeta[] = [
  { symbol: 'META', name: 'Meta Platforms', tickerClass: 'text-blue-400' },
  { symbol: 'AAPL', name: 'Apple Inc.', tickerClass: 'text-slate-300' },
  { symbol: 'AMZN', name: 'Amazon.com', tickerClass: 'text-amber-400' },
  { symbol: 'NFLX', name: 'Netflix Inc.', tickerClass: 'text-rose-400' },
  { symbol: 'GOOGL', name: 'Alphabet Google', tickerClass: 'text-emerald-400' }
];

interface StockAnalysis {
  symbol: string;
  name: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  high20: number;
  low20: number;
  avg20: number;
  action: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL';
  buyPrice: number;
  sellPrice: number;
  stopLoss: number;
  upsidePct: number;
  downsideRiskPct: number;
  rsi: number;
  smaTrend: 'BULLISH' | 'BEARISH';
  rationale: string;
  prices: any[];
}

export default function App() {
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [activeSubView, setActiveSubView] = useState<'chart' | 'indicators' | 'backtest' | 'mcp'>('chart');
  
  // All MAANG market data cache
  const [allStocksData, setAllStocksData] = useState<Record<string, any>>({});
  const [loadingAll, setLoadingAll] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  // Technical Indicator state
  const [selectedIndicator, setSelectedIndicator] = useState('RSI');
  const [indicatorData, setIndicatorData] = useState<any>(null);
  const [indicatorLoading, setIndicatorLoading] = useState(false);

  // Backtest state
  const [selectedStrategy, setSelectedStrategy] = useState('sma_crossover');
  const [backtestData, setBacktestData] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);

  // MCP Tester state
  const [mcpTool, setMcpTool] = useState('[MAANGpicker]_maang_prices');
  const [mcpParams, setMcpParams] = useState({ symbol: 'AAPL', indicator: 'RSI', strategy: 'sma_crossover' });
  const [mcpResponse, setMcpResponse] = useState<any>(null);
  const [mcpLoading, setMcpLoading] = useState(false);

  // Fetch all 5 MAANG stocks concurrently
  const fetchAllMarketData = async () => {
    setLoadingAll(true);
    setError(null);
    try {
      const results: Record<string, any> = {};
      await Promise.all(
        MAANG_STOCKS.map(async (stock) => {
          try {
            const res = await fetch(`/api/stocks?symbol=${stock.symbol}`);
            if (res.ok) {
              const data = await res.json();
              results[stock.symbol] = data;
            }
          } catch {
            // continue
          }
        })
      );
      setAllStocksData(results);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch MAANG market data.');
    } finally {
      setLoadingAll(false);
    }
  };

  useEffect(() => {
    fetchAllMarketData();
  }, []);

  // Fetch Indicator details when subView is 'indicators'
  useEffect(() => {
    if (activeSubView === 'indicators') {
      setIndicatorLoading(true);
      fetch(`/api/indicators?symbol=${selectedSymbol}&indicator=${selectedIndicator}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setIndicatorData(data))
        .catch(() => setIndicatorData(null))
        .finally(() => setIndicatorLoading(false));
    }
  }, [selectedSymbol, selectedIndicator, activeSubView]);

  // Fetch Backtest details when subView is 'backtest'
  useEffect(() => {
    if (activeSubView === 'backtest') {
      setBacktestLoading(true);
      fetch(`/api/backtest?symbol=${selectedSymbol}&strategy=${selectedStrategy}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setBacktestData(data))
        .catch(() => setBacktestData(null))
        .finally(() => setBacktestLoading(false));
    }
  }, [selectedSymbol, selectedStrategy, activeSubView]);

  // Compute decisions & exact Buy Price / Sell Price targets across all stocks
  const stockAnalyses: StockAnalysis[] = useMemo(() => {
    return MAANG_STOCKS.map((meta) => {
      const raw = allStocksData[meta.symbol];
      if (!raw || !raw.items || raw.items.length === 0) {
        return {
          symbol: meta.symbol,
          name: meta.name,
          currentPrice: 0,
          change: 0,
          changePercent: 0,
          high20: 0,
          low20: 0,
          avg20: 0,
          action: 'HOLD',
          buyPrice: 0,
          sellPrice: 0,
          stopLoss: 0,
          upsidePct: 0,
          downsideRiskPct: 0,
          rsi: 50,
          smaTrend: 'BULLISH',
          rationale: 'Loading market data...',
          prices: []
        };
      }

      const items = raw.items;
      const currentPrice = raw.current_price || items[items.length - 1].close;
      const change = raw.change || 0;
      const changePercent = raw.change_percent || 0;
      const closes = items.map((i: any) => i.close);
      const high20 = Math.max(...closes);
      const low20 = Math.min(...closes);
      const avg20 = +(closes.reduce((a: number, b: number) => a + b, 0) / closes.length).toFixed(2);

      // Estimate 14-day RSI from available prices
      let gains = 0, losses = 0;
      for (let i = 1; i < items.length; i++) {
        const diff = items[i].close - items[i - 1].close;
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
      }
      const avgG = gains / (items.length - 1 || 1);
      const avgL = losses / (items.length - 1 || 1);
      const rs = avgL === 0 ? 100 : avgG / avgL;
      const rsi = +(100 - (100 / (1 + rs))).toFixed(1);

      const smaTrend: 'BULLISH' | 'BEARISH' = currentPrice >= avg20 ? 'BULLISH' : 'BEARISH';
      const range = high20 - low20 || 1;
      const positionInRange = (currentPrice - low20) / range; // 0 (at low) to 1 (at high)

      let action: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL';
      let buyPrice: number;
      let sellPrice: number;
      let stopLoss: number;
      let rationale: string;

      if (rsi < 42 || (positionInRange < 0.25 && smaTrend === 'BULLISH')) {
        action = rsi < 35 ? 'STRONG BUY' : 'BUY';
        // Buy target near current or dip support; target sell at recent high or breakout
        buyPrice = +(currentPrice * 0.995).toFixed(2);
        sellPrice = +(Math.max(high20, currentPrice * 1.065)).toFixed(2);
        stopLoss = +(low20 * 0.985).toFixed(2);
        rationale = `RSI (${rsi}) indicates oversold rebound opportunity with support at $${low20.toFixed(2)}.`;
      } else if (rsi > 68 || positionInRange > 0.92) {
        action = 'SELL';
        // Overbought: take profit at sell price; target rebuy at support
        sellPrice = +(currentPrice * 0.998).toFixed(2);
        buyPrice = +(low20 + (range * 0.25)).toFixed(2);
        stopLoss = +(high20 * 1.02).toFixed(2);
        rationale = `RSI (${rsi}) overbought near 20-day peak of $${high20.toFixed(2)}; take profit / exit now.`;
      } else if (smaTrend === 'BULLISH' && positionInRange > 0.4 && positionInRange < 0.8) {
        action = 'BUY';
        buyPrice = +(currentPrice * 0.99).toFixed(2);
        sellPrice = +(high20 * 1.04).toFixed(2);
        stopLoss = +(avg20 * 0.97).toFixed(2);
        rationale = `Bullish momentum above 20-day avg ($${avg20}). Steady trend towards $${sellPrice}.`;
      } else {
        action = 'HOLD';
        buyPrice = +(low20 + (range * 0.15)).toFixed(2);
        sellPrice = +(high20 * 0.98).toFixed(2);
        stopLoss = +(low20 * 0.96).toFixed(2);
        rationale = `Neutral momentum (RSI ${rsi}). Hold existing positions; wait for breakout or dip to $${buyPrice}.`;
      }

      const upsidePct = +(((sellPrice - currentPrice) / currentPrice) * 100).toFixed(1);
      const downsideRiskPct = +(((currentPrice - stopLoss) / currentPrice) * 100).toFixed(1);

      return {
        symbol: meta.symbol,
        name: meta.name,
        currentPrice,
        change,
        changePercent,
        high20,
        low20,
        avg20,
        action,
        buyPrice,
        sellPrice,
        stopLoss,
        upsidePct,
        downsideRiskPct,
        rsi,
        smaTrend,
        rationale,
        prices: items
      };
    });
  }, [allStocksData]);

  // Identify the definitive TOP BUY and TOP SELL stock
  const topBuyStock = useMemo(() => {
    const buys = stockAnalyses
      .filter((s) => s.action === 'STRONG BUY' || s.action === 'BUY')
      .sort((a, b) => b.upsidePct - a.upsidePct);
    if (buys.length > 0) return buys[0];
    return stockAnalyses.slice().sort((a, b) => a.rsi - b.rsi)[0];
  }, [stockAnalyses]);

  const topSellStock = useMemo(() => {
    const sells = stockAnalyses
      .filter((s) => s.action === 'SELL')
      .sort((a, b) => b.rsi - a.rsi);
    if (sells.length > 0) return sells[0];
    return stockAnalyses.slice().sort((a, b) => b.rsi - a.rsi)[0];
  }, [stockAnalyses]);

  // Current selected stock analysis
  const selectedAnalysis = useMemo(() => {
    return stockAnalyses.find((s) => s.symbol === selectedSymbol) || stockAnalyses[0];
  }, [stockAnalyses, selectedSymbol]);

  // Chart data formatting
  const chartData = useMemo(() => {
    if (!selectedAnalysis?.prices || selectedAnalysis.prices.length === 0) return [];
    return selectedAnalysis.prices.map((p) => ({
      date: p.date.slice(5), // 'MM-DD'
      fullDate: p.date,
      close: p.close,
      open: p.open,
      high: p.high,
      low: p.low,
      volume: p.volume
    }));
  }, [selectedAnalysis]);

  const minClose = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.floor(Math.min(...chartData.map((d) => d.close)) * 0.985);
  }, [chartData]);

  const maxClose = useMemo(() => {
    if (chartData.length === 0) return 100;
    return Math.ceil(Math.max(...chartData.map((d) => d.close)) * 1.015);
  }, [chartData]);

  const isNetPositive = useMemo(() => {
    if (chartData.length < 2) return true;
    return chartData[chartData.length - 1].close >= chartData[0].close;
  }, [chartData]);

  // Run test call to /api/mcp
  const runMcpTest = async () => {
    setMcpLoading(true);
    setMcpResponse(null);
    try {
      const args: any = { symbol: mcpParams.symbol };
      if (mcpTool.includes('indicators')) {
        args.indicator = mcpParams.indicator;
      } else if (mcpTool.includes('backtest')) {
        args.strategy = mcpParams.strategy;
      }

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: mcpTool,
            arguments: args
          }
        })
      });
      const data = await res.json();
      setMcpResponse(data);
    } catch (err: any) {
      setMcpResponse({ error: err.message });
    } finally {
      setMcpLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-50 px-4 sm:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 text-sm">
              M
            </div>
            <div>
              <div className="font-semibold text-base text-white tracking-tight flex items-center gap-2">
                MAANGpicker
                <span className="text-xs text-slate-400 font-normal">| Stock Decision Engine & MCP Server</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="hidden md:flex items-center gap-2 text-slate-400">
              <span>Updated: {lastRefreshed.toLocaleTimeString()}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-mono">Streamable HTTP /api/mcp</span>
            </div>
            <button
              onClick={fetchAllMarketData}
              disabled={loadingAll}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAll ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container - Optimized for high-density single-page presence */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-5 space-y-5">
        {/* EXECUTIVE DECISION BANNER: WHICH STOCK TO BUY & WHICH TO SELL */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* TOP BUY CALLOUT */}
          {topBuyStock && (
            <div 
              onClick={() => setSelectedSymbol(topBuyStock.symbol)}
              className="cursor-pointer group p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/40 hover:border-emerald-400 transition-all shadow-lg shadow-emerald-950/20 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      TOP STOCK TO BUY
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-400 font-medium">Rank #1 Opportunity</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-white group-hover:text-emerald-300 transition-colors">
                      {topBuyStock.symbol}
                    </span>
                    <span className="text-sm text-slate-300 font-medium">{topBuyStock.name}</span>
                    <span className="text-sm font-mono font-semibold text-slate-400">
                      ${topBuyStock.currentPrice.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">Target Upside</div>
                  <div className="text-xl font-mono font-extrabold text-emerald-400 flex items-center justify-end gap-0.5">
                    <ArrowUpRight className="w-5 h-5" />
                    +{topBuyStock.upsidePct}%
                  </div>
                </div>
              </div>

              {/* Exact Buy Price and Sell Price Breakdown */}
              <div className="mt-3.5 pt-3 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20">
                  <span className="text-slate-400 text-[11px] block">Recommended Buy Price</span>
                  <span className="font-mono font-bold text-sm text-emerald-300">
                    ${topBuyStock.buyPrice.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-[11px] block">Target Sell Price</span>
                  <span className="font-mono font-bold text-sm text-white">
                    ${topBuyStock.sellPrice.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-[11px] block">Stop Loss Level</span>
                  <span className="font-mono font-semibold text-sm text-rose-400">
                    ${topBuyStock.stopLoss.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 text-xs text-slate-400 flex items-center justify-between">
                <p className="truncate mr-2"><strong className="text-slate-300">Signal:</strong> {topBuyStock.rationale}</p>
                <span className="text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center font-medium flex-shrink-0">
                  Inspect <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          )}

          {/* TOP SELL CALLOUT */}
          {topSellStock && (
            <div 
              onClick={() => setSelectedSymbol(topSellStock.symbol)}
              className="cursor-pointer group p-4 rounded-xl bg-gradient-to-r from-rose-950/40 via-slate-900 to-slate-900 border border-rose-500/40 hover:border-rose-400 transition-all shadow-lg shadow-rose-950/20 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5" />
                      TOP STOCK TO SELL / EXIT
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-400 font-medium">Protect Capital / Take Profit</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-white group-hover:text-rose-300 transition-colors">
                      {topSellStock.symbol}
                    </span>
                    <span className="text-sm text-slate-300 font-medium">{topSellStock.name}</span>
                    <span className="text-sm font-mono font-semibold text-slate-400">
                      ${topSellStock.currentPrice.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">RSI / Risk Level</div>
                  <div className="text-xl font-mono font-extrabold text-rose-400 flex items-center justify-end gap-0.5">
                    <ArrowDownRight className="w-5 h-5" />
                    RSI {topSellStock.rsi}
                  </div>
                </div>
              </div>

              {/* Exact Sell Price and Re-entry Buy Price Breakdown */}
              <div className="mt-3.5 pt-3 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-500/20">
                  <span className="text-slate-400 text-[11px] block">Execute Sell Price</span>
                  <span className="font-mono font-bold text-sm text-rose-300">
                    ${topSellStock.sellPrice.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-[11px] block">Dip Re-entry Buy Price</span>
                  <span className="font-mono font-bold text-sm text-emerald-400">
                    ${topSellStock.buyPrice.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 text-[11px] block">Resistance Cap</span>
                  <span className="font-mono font-semibold text-sm text-slate-300">
                    ${topSellStock.high20.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 text-xs text-slate-400 flex items-center justify-between">
                <p className="truncate mr-2"><strong className="text-slate-300">Signal:</strong> {topSellStock.rationale}</p>
                <span className="text-rose-400 group-hover:translate-x-0.5 transition-transform flex items-center font-medium flex-shrink-0">
                  Inspect <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          )}
        </section>

        {/* WORKSPACE GRID: LEFT MAIN CHART (60%) & RIGHT DECISION MATRIX / TOOLS (40%) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: STOCK SELECTOR & RECHARTS 20-DAY PRICE VISUALIZER */}
          <div className="lg:col-span-7 space-y-4">
            {/* Ticker Selector Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-900/60 rounded-xl border border-slate-800">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {MAANG_STOCKS.map((stock) => {
                  const active = selectedSymbol === stock.symbol;
                  const item = stockAnalyses.find((s) => s.symbol === stock.symbol);
                  return (
                    <button
                      key={stock.symbol}
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                        active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <span>{stock.symbol}</span>
                      {item && item.currentPrice > 0 && (
                        <span className={`text-[11px] font-mono ${
                          item.change >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}>
                          ${item.currentPrice.toFixed(0)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sub-view switcher for Left Panel */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setActiveSubView('chart')}
                  className={`px-2.5 py-1 rounded-md font-medium transition ${
                    activeSubView === 'chart' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Prices Chart
                </button>
                <button
                  onClick={() => setActiveSubView('indicators')}
                  className={`px-2.5 py-1 rounded-md font-medium transition ${
                    activeSubView === 'indicators' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Indicators
                </button>
                <button
                  onClick={() => setActiveSubView('backtest')}
                  className={`px-2.5 py-1 rounded-md font-medium transition ${
                    activeSubView === 'backtest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Backtest
                </button>
                <button
                  onClick={() => setActiveSubView('mcp')}
                  className={`px-2.5 py-1 rounded-md font-medium transition ${
                    activeSubView === 'mcp' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  MCP Tools
                </button>
              </div>
            </div>

            {/* CHART SUBVIEW: RECHARTS LINE CHART VISUALIZING LAST 20 CLOSING PRICES */}
            {activeSubView === 'chart' && (
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                {/* Stock Title & Live Metric Row */}
                <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white tracking-tight">{selectedAnalysis?.name}</h2>
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {selectedSymbol}
                      </span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        selectedAnalysis?.action === 'STRONG BUY' || selectedAnalysis?.action === 'BUY'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : selectedAnalysis?.action === 'SELL'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {selectedAnalysis?.action}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                        ${selectedAnalysis?.currentPrice.toFixed(2)}
                      </span>
                      <span className={`text-sm font-mono font-bold flex items-center ${
                        (selectedAnalysis?.change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {(selectedAnalysis?.change || 0) >= 0 ? '+' : ''}
                        {selectedAnalysis?.change?.toFixed(2)} ({(selectedAnalysis?.changePercent || 0) >= 0 ? '+' : ''}
                        {selectedAnalysis?.changePercent}%)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono text-slate-300">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">Buy Target</span>
                      <span className="text-emerald-400 font-bold">${selectedAnalysis?.buyPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">Sell Target</span>
                      <span className="text-rose-400 font-bold">${selectedAnalysis?.sellPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">20D Range</span>
                      <span>${selectedAnalysis?.low20.toFixed(2)} - ${selectedAnalysis?.high20.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Recharts Area/Line Chart of Last 20 Closing Prices */}
                <div className="w-full h-72 sm:h-80">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="priceGradientPositive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="priceGradientNegative" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis 
                          dataKey="date" 
                          stroke="#64748b" 
                          tick={{ fontSize: 11 }} 
                          tickLine={false}
                          axisLine={{ stroke: '#334155' }}
                        />
                        <YAxis 
                          domain={[minClose, maxClose]} 
                          stroke="#64748b" 
                          tick={{ fontSize: 11 }} 
                          tickLine={false}
                          axisLine={{ stroke: '#334155' }}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-xl text-xs space-y-1">
                                  <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1">
                                    {data.fullDate}
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pt-1 text-slate-300 font-mono">
                                    <span>Close:</span>
                                    <span className="font-bold text-white text-right">${data.close.toFixed(2)}</span>
                                    <span>Open:</span>
                                    <span className="text-right text-slate-400">${data.open.toFixed(2)}</span>
                                    <span>High:</span>
                                    <span className="text-right text-emerald-400">${data.high.toFixed(2)}</span>
                                    <span>Low:</span>
                                    <span className="text-right text-rose-400">${data.low.toFixed(2)}</span>
                                    <span>Volume:</span>
                                    <span className="text-right text-slate-400">{(data.volume / 1000000).toFixed(1)}M</span>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        {/* Reference lines for Buy and Sell targets */}
                        {selectedAnalysis?.buyPrice > 0 && (
                          <ReferenceLine 
                            y={selectedAnalysis.buyPrice} 
                            stroke="#10b981" 
                            strokeDasharray="4 4" 
                            label={{ value: 'Buy Target', fill: '#10b981', fontSize: 10, position: 'right' }} 
                          />
                        )}
                        {selectedAnalysis?.sellPrice > 0 && (
                          <ReferenceLine 
                            y={selectedAnalysis.sellPrice} 
                            stroke="#f43f5e" 
                            strokeDasharray="4 4" 
                            label={{ value: 'Sell Target', fill: '#f43f5e', fontSize: 10, position: 'right' }} 
                          />
                        )}
                        <Area
                          type="monotone"
                          dataKey="close"
                          stroke={isNetPositive ? '#10b981' : '#f43f5e'}
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill={isNetPositive ? 'url(#priceGradientPositive)' : 'url(#priceGradientNegative)'}
                          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                      Loading 20-day historical OHLC chart...
                    </div>
                  )}
                </div>

                {/* 20-Day OHLC Data Strip */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    <span>Green line: 20-day Buy Target (${selectedAnalysis?.buyPrice})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                    <span>Red line: 20-day Sell Target (${selectedAnalysis?.sellPrice})</span>
                  </div>
                  <div className="text-slate-500 font-mono">
                    Upstream: Yahoo Finance (20 items max)
                  </div>
                </div>
              </div>
            )}

            {/* INDICATORS SUBVIEW */}
            {activeSubView === 'indicators' && (
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {['RSI', 'MACD', 'SMA50', 'SMA200'].map((ind) => (
                      <button
                        key={ind}
                        onClick={() => setSelectedIndicator(ind)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          selectedIndicator === ind ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    GET /api/indicators?symbol={selectedSymbol}&indicator={selectedIndicator}
                  </span>
                </div>

                {indicatorData?.items ? (
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-2">Date</th>
                          <th className="px-4 py-2 text-right">Close</th>
                          <th className="px-4 py-2 text-right">Metric Value</th>
                          <th className="px-4 py-2 text-right">State</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-slate-300">
                        {indicatorData.items.slice().reverse().map((point: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            <td className="px-4 py-2 text-white font-semibold">{point.date}</td>
                            <td className="px-4 py-2 text-right">${point.close?.toFixed(2)}</td>
                            <td className="px-4 py-2 text-right text-indigo-400 font-bold">
                              {point.rsi !== undefined && `RSI: ${point.rsi}`}
                              {point.macd !== undefined && `MACD: ${point.macd}`}
                              {point.sma50 !== undefined && `$${point.sma50}`}
                              {point.sma200 !== undefined && `$${point.sma200}`}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                point.condition === 'OVERBOUGHT' || point.trend === 'BEARISH'
                                  ? 'text-rose-400 bg-rose-500/10'
                                  : 'text-emerald-400 bg-emerald-500/10'
                              }`}>
                                {point.condition || point.trend || 'NEUTRAL'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-500 text-sm">
                    {indicatorLoading ? 'Calculating indicator values...' : 'No indicator data available.'}
                  </div>
                )}
              </div>
            )}

            {/* BACKTEST SUBVIEW */}
            {activeSubView === 'backtest' && (
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'sma_crossover', label: 'SMA Crossover' },
                    { id: 'rsi_thresholds', label: 'RSI Thresholds' },
                    { id: 'macd_crossover', label: 'MACD Crossover' }
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStrategy(s.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        selectedStrategy === s.id ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {backtestData?.summary && (
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Final Balance</span>
                      <span className="font-mono font-bold text-white text-base">
                        ${backtestData.summary.final_balance?.toFixed(2)}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Total Return</span>
                      <span className={`font-mono font-bold text-base ${
                        backtestData.summary.total_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {backtestData.summary.total_return_pct > 0 ? '+' : ''}{backtestData.summary.total_return_pct}%
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Win Rate</span>
                      <span className="font-mono font-bold text-indigo-400 text-base">
                        {backtestData.summary.win_rate_pct}%
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">Signals Executed</span>
                      <span className="font-mono font-bold text-slate-300 text-base">
                        {backtestData.summary.total_trades}
                      </span>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto max-h-60">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">PnL</th>
                        <th className="px-3 py-2">Signal Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 text-slate-300">
                      {backtestData?.items?.map((t: any, idx: number) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-white">{t.date}</td>
                          <td className="px-3 py-2 font-bold text-indigo-300">{t.type}</td>
                          <td className="px-3 py-2 text-right">${t.price?.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            {t.pnl !== undefined ? (
                              <span className={t.pnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {t.pnl >= 0 ? '+' : ''}${t.pnl}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2 text-slate-400 truncate max-w-xs">{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* MCP PROTOCOL TOOLS SUBVIEW */}
            {activeSubView === 'mcp' && (
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5 font-mono">
                    <Terminal className="w-4 h-4" />
                    MCP JSON-RPC 2.0 Client Tester (/api/mcp)
                  </span>
                  <span className="text-[11px] text-slate-400">Streamable HTTP Transport</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Tool</label>
                    <select
                      value={mcpTool}
                      onChange={(e) => setMcpTool(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                    >
                      <option value="[MAANGpicker]_maang_prices">[MAANGpicker]_maang_prices</option>
                      <option value="[MAANGpicker]_maang_indicators">[MAANGpicker]_maang_indicators</option>
                      <option value="[MAANGpicker]_maang_backtest">[MAANGpicker]_maang_backtest</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Symbol</label>
                    <select
                      value={mcpParams.symbol}
                      onChange={(e) => setMcpParams({ ...mcpParams, symbol: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                    >
                      {MAANG_STOCKS.map((s) => (
                        <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={runMcpTest}
                      disabled={mcpLoading}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition disabled:opacity-50"
                    >
                      {mcpLoading ? 'Running...' : 'Call /api/mcp'}
                    </button>
                  </div>
                </div>

                {mcpResponse && (
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-48 overflow-auto">
                    {JSON.stringify(mcpResponse, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: COMPLETE MAANG DECISION MATRIX & ACTION GUIDE */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-400" />
                    MAANG Decision Matrix
                  </h3>
                  <p className="text-xs text-slate-400">
                    Live Buy / Sell targets calculated from 20-day OHLC & RSI
                  </p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  All 5 MAANG
                </span>
              </div>

              {/* Comprehensive Stock Decision Table */}
              <div className="space-y-2.5 pt-1">
                {stockAnalyses.map((stock) => {
                  const isSelected = selectedSymbol === stock.symbol;
                  const isBuy = stock.action === 'STRONG BUY' || stock.action === 'BUY';
                  const isSell = stock.action === 'SELL';

                  return (
                    <div
                      key={stock.symbol}
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      className={`p-3 rounded-xl border transition cursor-pointer ${
                        isSelected
                          ? 'bg-slate-800/90 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/30'
                          : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-white text-sm">{stock.symbol}</span>
                          <span className="text-xs text-slate-400 truncate max-w-[100px]">{stock.name}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-white">
                            ${stock.currentPrice > 0 ? stock.currentPrice.toFixed(2) : '...'}
                          </span>
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                            isBuy
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : isSell
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {stock.action}
                          </span>
                        </div>
                      </div>

                      {/* Buy Price and Sell Price explicitly highlighted */}
                      <div className="mt-2 pt-2 border-t border-slate-800/60 grid grid-cols-3 gap-2 text-[11px] font-mono">
                        <div>
                          <span className="text-slate-500 text-[10px] block">Buy Price</span>
                          <span className="font-bold text-emerald-400">
                            ${stock.buyPrice > 0 ? stock.buyPrice.toFixed(2) : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[10px] block">Sell Price</span>
                          <span className="font-bold text-rose-400">
                            ${stock.sellPrice > 0 ? stock.sellPrice.toFixed(2) : '-'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 text-[10px] block">Target Return</span>
                          <span className={`font-bold ${isBuy ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {stock.upsidePct > 0 ? `+${stock.upsidePct}%` : `${stock.upsidePct}%`}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 text-[10px] text-slate-400 truncate">
                        {stock.rationale}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Summary Card: Technical Setup Summary */}
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 text-xs space-y-2">
              <div className="font-semibold text-slate-200 flex items-center justify-between">
                <span>Trading Rules Applied</span>
                <span className="text-slate-500">20-Day Standard</span>
              </div>
              <ul className="text-slate-400 space-y-1 leading-relaxed text-[11px]">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400 font-bold">·</span>
                  <span><strong>Buy Price:</strong> Support confluence near 20-day low / discount entry.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-rose-400 font-bold">·</span>
                  <span><strong>Sell Price:</strong> Resistance take-profit target near 20-day high.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-indigo-400 font-bold">·</span>
                  <span><strong>MCP Integration:</strong> External agents call <code className="text-indigo-300 font-mono">/api/mcp</code> for live tools.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
