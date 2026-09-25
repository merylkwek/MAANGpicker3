/**
 * Shared market data, indicator computation, and backtesting functions for MAANG stocks.
 * MAANG stocks: META, AAPL, AMZN, NFLX, GOOGL, GOOG.
 */

const SUPPORTED_MAANG_SYMBOLS = ['META', 'AAPL', 'AMZN', 'NFLX', 'GOOGL', 'GOOG'];

export function validateMaangSymbol(rawSymbol) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    throw new Error('Symbol parameter is required.');
  }
  const clean = rawSymbol.trim().toUpperCase();
  if (!SUPPORTED_MAANG_SYMBOLS.includes(clean)) {
    throw new Error(`Symbol '${clean}' is not a supported MAANG stock (META, AAPL, AMZN, NFLX, GOOGL, GOOG).`);
  }
  return clean;
}

/**
 * Fetches historical OHLC daily bar data from Yahoo Finance, Polygon, or Alpha Vantage.
 * Never returns mock, seed, or sample data.
 */
export async function fetchMarketData(symbol, range = '1y') {
  const sym = validateMaangSymbol(symbol);

  // 1. If Polygon API key is available, attempt Polygon
  if (process.env.POLYGON_API_KEY) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const fromDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromDate}/${today}?adjusted=true&sort=asc&limit=500&apiKey=${process.env.POLYGON_API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.results && json.results.length > 0) {
          const items = json.results.map(r => ({
            date: new Date(r.t).toISOString().split('T')[0],
            open: +r.o.toFixed(2),
            high: +r.h.toFixed(2),
            low: +r.l.toFixed(2),
            close: +r.c.toFixed(2),
            volume: r.v
          }));
          return { source: 'Polygon', data: items };
        }
      }
    } catch {
      // Fall through to Yahoo Finance
    }
  }

  // 2. Default reliable upstream: Yahoo Finance public API
  const hosts = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}`
  ];

  let lastStatus = 500;
  let lastHost = 'Yahoo Finance';

  for (const url of hosts) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      lastStatus = res.status;
      if (!res.ok) {
        continue;
      }
      const json = await res.json();
      const chartResult = json?.chart?.result?.[0];
      if (!chartResult) {
        continue;
      }

      const timestamps = chartResult.timestamp || [];
      const quote = chartResult.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];

      const items = [];
      for (let i = 0; i < timestamps.length; i++) {
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];
        const v = volumes[i];
        if (c !== null && c !== undefined && !isNaN(c)) {
          items.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            open: +(o ?? c).toFixed(2),
            high: +(h ?? c).toFixed(2),
            low: +(l ?? c).toFixed(2),
            close: +c.toFixed(2),
            volume: v || 0
          });
        }
      }

      if (items.length > 0) {
        return { source: 'Yahoo Finance', data: items };
      }
    } catch {
      // try next host
    }
  }

  throw new Error(`Failed to fetch market data from ${lastHost}: upstream returned status ${lastStatus}.`);
}

/**
 * Live and historical prices for a given MAANG stock.
 * Returns at most 20 items, source, and fetched_at.
 */
export async function getMaangPrices(symbol) {
  const sym = validateMaangSymbol(symbol);
  const { source, data } = await fetchMarketData(sym, '1mo');

  if (!data || data.length === 0) {
    throw new Error(`Failed to fetch price data from ${source}: upstream returned no data.`);
  }

  const latest = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : latest;
  const change = +(latest.close - prev.close).toFixed(2);
  const changePercent = +(((latest.close - prev.close) / prev.close) * 100).toFixed(2);

  const items = data.slice(-20);

  return {
    symbol: sym,
    source,
    fetched_at: new Date().toISOString(),
    current_price: latest.close,
    change,
    change_percent: changePercent,
    items,
    data: items
  };
}

/**
 * Calculates technical indicators (RSI, MACD, SMA50, SMA200) for a given MAANG stock.
 */
export async function getMaangIndicators(symbol, rawIndicator) {
  const sym = validateMaangSymbol(symbol);
  if (!rawIndicator || typeof rawIndicator !== 'string') {
    throw new Error('Indicator parameter is required (RSI, MACD, SMA50, or SMA200).');
  }

  const indicator = rawIndicator.trim().toUpperCase();
  const validIndicators = ['RSI', 'MACD', 'SMA50', 'SMA200'];
  if (!validIndicators.includes(indicator)) {
    throw new Error(`Indicator '${rawIndicator}' is not supported. Choose from RSI, MACD, SMA50, SMA200.`);
  }

  // Need at least 250 bars for SMA200
  const range = indicator === 'SMA200' ? '2y' : '1y';
  const { source, data } = await fetchMarketData(sym, range);

  if (!data || data.length === 0) {
    throw new Error(`Failed to calculate indicators from ${source}: upstream returned no data.`);
  }

  let calculatedPoints = [];

  if (indicator === 'SMA50') {
    const period = 50;
    if (data.length < period) {
      throw new Error(`Not enough market data from ${source} for SMA50 calculation (need at least 50 points).`);
    }
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].close;
      }
      const sma = +(sum / period).toFixed(2);
      calculatedPoints.push({
        date: data[i].date,
        close: data[i].close,
        sma50: sma,
        trend: data[i].close >= sma ? 'BULLISH' : 'BEARISH'
      });
    }
  } else if (indicator === 'SMA200') {
    const period = 200;
    if (data.length < period) {
      throw new Error(`Not enough market data from ${source} for SMA200 calculation (need at least 200 points).`);
    }
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].close;
      }
      const sma = +(sum / period).toFixed(2);
      calculatedPoints.push({
        date: data[i].date,
        close: data[i].close,
        sma200: sma,
        trend: data[i].close >= sma ? 'BULLISH' : 'BEARISH'
      });
    }
  } else if (indicator === 'RSI') {
    const period = 14;
    if (data.length < period + 1) {
      throw new Error(`Not enough market data from ${source} for RSI calculation.`);
    }

    let gains = [];
    let losses = [];
    for (let i = 1; i < data.length; i++) {
      const diff = data[i].close - data[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = +(100 - (100 / (1 + rs))).toFixed(2);
      const dataIdx = i + 1;
      calculatedPoints.push({
        date: data[dataIdx].date,
        close: data[dataIdx].close,
        rsi,
        condition: rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'
      });
    }
  } else if (indicator === 'MACD') {
    // 12-day EMA, 26-day EMA, 9-day signal EMA
    if (data.length < 35) {
      throw new Error(`Not enough market data from ${source} for MACD calculation.`);
    }

    const calcEMA = (prices, period) => {
      const k = 2 / (period + 1);
      const emaArray = [];
      let sum = 0;
      for (let i = 0; i < period; i++) sum += prices[i];
      let ema = sum / period;
      emaArray.push({ idx: period - 1, val: ema });
      for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        emaArray.push({ idx: i, val: ema });
      }
      return emaArray;
    };

    const closes = data.map(d => d.close);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);

    const macdLine = [];
    const ema12Map = new Map(ema12.map(e => [e.idx, e.val]));
    for (const e26 of ema26) {
      const e12Val = ema12Map.get(e26.idx);
      if (e12Val !== undefined) {
        macdLine.push({ idx: e26.idx, val: +(e12Val - e26.val).toFixed(2) });
      }
    }

    // 9-day EMA of MACD Line
    const macdValues = macdLine.map(m => m.val);
    const signalEMA = calcEMA(macdValues, 9);
    const signalMap = new Map(signalEMA.map(s => [s.idx, s.val]));

    for (let i = 0; i < macdLine.length; i++) {
      if (signalMap.has(i)) {
        const macdVal = macdLine[i].val;
        const sigVal = +signalMap.get(i).toFixed(2);
        const histVal = +(macdVal - sigVal).toFixed(2);
        const dataIdx = macdLine[i].idx;
        calculatedPoints.push({
          date: data[dataIdx].date,
          close: data[dataIdx].close,
          macd: macdVal,
          signal: sigVal,
          histogram: histVal,
          condition: histVal > 0 ? 'BULLISH' : 'BEARISH'
        });
      }
    }
  }

  const items = calculatedPoints.slice(-20);

  return {
    symbol: sym,
    indicator,
    source,
    fetched_at: new Date().toISOString(),
    items,
    values: items,
    latest: items[items.length - 1] || null
  };
}

/**
 * Backtest simulation on historical MAANG stock data.
 * Supported strategies: sma_crossover, rsi_thresholds, macd_crossover
 */
export async function getMaangBacktest(symbol, rawStrategy) {
  const sym = validateMaangSymbol(symbol);
  if (!rawStrategy || typeof rawStrategy !== 'string') {
    throw new Error('Strategy parameter is required (sma_crossover, rsi_thresholds, macd_crossover).');
  }

  const strategy = rawStrategy.trim().toLowerCase();
  const validStrategies = ['sma_crossover', 'rsi_thresholds', 'macd_crossover'];
  if (!validStrategies.includes(strategy)) {
    throw new Error(`Strategy '${rawStrategy}' is not supported. Choose from sma_crossover, rsi_thresholds, macd_crossover.`);
  }

  const { source, data } = await fetchMarketData(sym, '1y');
  if (!data || data.length < 60) {
    throw new Error(`Not enough market data from ${source} to execute backtest.`);
  }

  let capital = 10000;
  let shares = 0;
  let buyPrice = 0;
  const trades = [];

  if (strategy === 'sma_crossover') {
    // Fast SMA (10), Slow SMA (30)
    for (let i = 30; i < data.length; i++) {
      const fastSum = data.slice(i - 10, i).reduce((acc, d) => acc + d.close, 0) / 10;
      const slowSum = data.slice(i - 30, i).reduce((acc, d) => acc + d.close, 0) / 30;
      const prevFast = data.slice(i - 11, i - 1).reduce((acc, d) => acc + d.close, 0) / 10;
      const prevSlow = data.slice(i - 31, i - 1).reduce((acc, d) => acc + d.close, 0) / 30;

      // Golden cross: fast crosses above slow -> BUY
      if (prevFast <= prevSlow && fastSum > slowSum && shares === 0) {
        buyPrice = data[i].close;
        shares = +(capital / buyPrice).toFixed(4);
        capital = 0;
        trades.push({
          date: data[i].date,
          type: 'BUY',
          price: buyPrice,
          shares,
          reason: 'SMA10 crossed above SMA30'
        });
      }
      // Death cross: fast crosses below slow -> SELL
      else if (prevFast >= prevSlow && fastSum < slowSum && shares > 0) {
        const sellPrice = data[i].close;
        capital = +(shares * sellPrice).toFixed(2);
        const pnl = +((sellPrice - buyPrice) * shares).toFixed(2);
        const returnPct = +(((sellPrice - buyPrice) / buyPrice) * 100).toFixed(2);
        trades.push({
          date: data[i].date,
          type: 'SELL',
          price: sellPrice,
          shares,
          pnl,
          return_pct: returnPct,
          balance: capital,
          reason: 'SMA10 crossed below SMA30'
        });
        shares = 0;
        buyPrice = 0;
      }
    }
  } else if (strategy === 'rsi_thresholds') {
    // Buy when RSI < 30, Sell when RSI > 70
    const period = 14;
    let gains = [];
    let losses = [];
    for (let i = 1; i < data.length; i++) {
      const diff = data[i].close - data[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = +(100 - (100 / (1 + rs))).toFixed(2);
      const cur = data[i + 1];
      if (!cur) continue;

      if (rsi < 30 && shares === 0) {
        buyPrice = cur.close;
        shares = +(capital / buyPrice).toFixed(4);
        capital = 0;
        trades.push({
          date: cur.date,
          type: 'BUY',
          price: buyPrice,
          shares,
          reason: `RSI oversold at ${rsi}`
        });
      } else if (rsi > 70 && shares > 0) {
        const sellPrice = cur.close;
        capital = +(shares * sellPrice).toFixed(2);
        const pnl = +((sellPrice - buyPrice) * shares).toFixed(2);
        const returnPct = +(((sellPrice - buyPrice) / buyPrice) * 100).toFixed(2);
        trades.push({
          date: cur.date,
          type: 'SELL',
          price: sellPrice,
          shares,
          pnl,
          return_pct: returnPct,
          balance: capital,
          reason: `RSI overbought at ${rsi}`
        });
        shares = 0;
        buyPrice = 0;
      }
    }
  } else if (strategy === 'macd_crossover') {
    // Buy when MACD crosses above signal, sell when crosses below
    const closes = data.map(d => d.close);
    const calcEMA = (prices, period) => {
      const k = 2 / (period + 1);
      const emaArray = [];
      let sum = 0;
      for (let i = 0; i < period; i++) sum += prices[i];
      let ema = sum / period;
      emaArray.push({ idx: period - 1, val: ema });
      for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        emaArray.push({ idx: i, val: ema });
      }
      return emaArray;
    };

    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const ema12Map = new Map(ema12.map(e => [e.idx, e.val]));
    const macdLine = [];
    for (const e26 of ema26) {
      const e12Val = ema12Map.get(e26.idx);
      if (e12Val !== undefined) {
        macdLine.push({ idx: e26.idx, val: +(e12Val - e26.val).toFixed(2) });
      }
    }
    const signalEMA = calcEMA(macdLine.map(m => m.val), 9);
    const signalMap = new Map(signalEMA.map(s => [s.idx, s.val]));

    for (let i = 1; i < macdLine.length; i++) {
      if (signalMap.has(i) && signalMap.has(i - 1)) {
        const curMACD = macdLine[i].val;
        const curSig = signalMap.get(i);
        const prevMACD = macdLine[i - 1].val;
        const prevSig = signalMap.get(i - 1);
        const curPoint = data[macdLine[i].idx];

        if (prevMACD <= prevSig && curMACD > curSig && shares === 0) {
          buyPrice = curPoint.close;
          shares = +(capital / buyPrice).toFixed(4);
          capital = 0;
          trades.push({
            date: curPoint.date,
            type: 'BUY',
            price: buyPrice,
            shares,
            reason: 'MACD bullish crossover'
          });
        } else if (prevMACD >= prevSig && curMACD < curSig && shares > 0) {
          const sellPrice = curPoint.close;
          capital = +(shares * sellPrice).toFixed(2);
          const pnl = +((sellPrice - buyPrice) * shares).toFixed(2);
          const returnPct = +(((sellPrice - buyPrice) / buyPrice) * 100).toFixed(2);
          trades.push({
            date: curPoint.date,
            type: 'SELL',
            price: sellPrice,
            shares,
            pnl,
            return_pct: returnPct,
            balance: capital,
            reason: 'MACD bearish crossover'
          });
          shares = 0;
          buyPrice = 0;
        }
      }
    }
  }

  // Calculate final value
  const lastClose = data[data.length - 1].close;
  const finalBalance = shares > 0 ? +(shares * lastClose).toFixed(2) : capital;
  const completedTrades = trades.filter(t => t.type === 'SELL');
  const winningTrades = completedTrades.filter(t => (t.pnl || 0) > 0);
  const winRate = completedTrades.length > 0 ? +((winningTrades.length / completedTrades.length) * 100).toFixed(1) : 0;
  const totalReturnPct = +(((finalBalance - 10000) / 10000) * 100).toFixed(2);

  const items = trades.slice(-20);

  return {
    symbol: sym,
    strategy,
    source,
    fetched_at: new Date().toISOString(),
    summary: {
      initial_capital: 10000,
      final_balance: finalBalance,
      total_trades: trades.length,
      completed_trades: completedTrades.length,
      win_rate_pct: winRate,
      total_return_pct: totalReturnPct
    },
    items,
    trades: items
  };
}
