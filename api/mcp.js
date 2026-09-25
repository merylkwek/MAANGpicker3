import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getMaangPrices, getMaangIndicators, getMaangBacktest } from '../lib/market.js';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, mcp-session-id');
    return res.status(204).end();
  }

  // Handle browser/HTTP GET discovery
  if (req.method === 'GET' && !req.headers.accept?.includes('text/event-stream')) {
    return res.status(200).json({
      name: '[MAANGpicker]-server',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      status: 'online',
      transport: 'Streamable HTTP (JSON-RPC 2.0)',
      tools: [
        {
          name: '[MAANGpicker]_maang_prices',
          description: 'Returns live and historical price data for a given MAANG stock (Meta, Apple, Amazon, Netflix, Google).',
          parameters: { symbol: 'string (META, AAPL, AMZN, NFLX, GOOGL)' }
        },
        {
          name: '[MAANGpicker]_maang_indicators',
          description: 'Calculates technical indicators (RSI, MACD, SMA50, SMA200) for a given MAANG stock.',
          parameters: { symbol: 'string', indicator: 'RSI | MACD | SMA50 | SMA200' }
        },
        {
          name: '[MAANGpicker]_maang_backtest',
          description: 'Runs a rule-based backtest over the 20-day price history for a given MAANG stock.',
          parameters: { symbol: 'string', strategy: 'sma_crossover | rsi_thresholds | macd_crossover' }
        }
      ]
    });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed'
      },
      id: null
    });
    return;
  }

  // Create new McpServer fresh on every request
  const server = new McpServer({
    name: '[MAANGpicker]-server',
    version: '1.0.0'
  });

  // Tool 1: prices
  server.registerTool(
    '[MAANGpicker]_maang_prices',
    {
      description: 'Returns live and historical price data for a given MAANG stock (Meta, Apple, Amazon, Netflix, Google). The result comes from upstream market APIs (Yahoo Finance, Alpha Vantage, Polygon). Use this tool when an agent needs raw OHLC data for analysis. It does not cover non‑MAANG stocks or crypto.',
      inputSchema: {
        symbol: z.string().describe('MAANG stock ticker symbol: META, AAPL, AMZN, NFLX, GOOGL, or GOOG')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    },
    async ({ symbol }) => {
      try {
        const data = await getMaangPrices(symbol);
        const result = {
          symbol: data.symbol,
          source: data.source,
          fetched_at: data.fetched_at,
          current_price: data.current_price,
          change: data.change,
          change_percent: data.change_percent,
          items: data.items.slice(-20)
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message.endsWith('.') ? message : `${message}.`
            }
          ]
        };
      }
    }
  );

  // Tool 2: indicators
  server.registerTool(
    '[MAANGpicker]_maang_indicators',
    {
      description: 'Returns calculated technical indicators (RSI, MACD, SMA50, SMA200) for a given MAANG stock. The result is computed from upstream market data. Use this tool when an agent needs to detect overbought/oversold conditions or trend shifts. It does not cover fundamental metrics like earnings or revenue.',
      inputSchema: {
        symbol: z.string().describe('MAANG stock ticker symbol: META, AAPL, AMZN, NFLX, GOOGL, or GOOG'),
        indicator: z.string().describe('Technical indicator to compute: RSI, MACD, SMA50, or SMA200')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    },
    async ({ symbol, indicator }) => {
      try {
        const data = await getMaangIndicators(symbol, indicator);
        const result = {
          symbol: data.symbol,
          indicator: data.indicator,
          source: data.source,
          fetched_at: data.fetched_at,
          latest: data.latest,
          items: data.items.slice(-20)
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message.endsWith('.') ? message : `${message}.`
            }
          ]
        };
      }
    }
  );

  // Tool 3: backtest
  server.registerTool(
    '[MAANGpicker]_maang_backtest',
    {
      description: 'Returns backtest results on historical MAANG stock data using a chosen strategy (e.g., SMA crossover, RSI thresholds, MACD crossover). The result is simulated locally from upstream market data. Use this tool when an agent needs to validate signals historically. It does not cover live trading or execution.',
      inputSchema: {
        symbol: z.string().describe('MAANG stock ticker symbol: META, AAPL, AMZN, NFLX, GOOGL, or GOOG'),
        strategy: z.string().describe('Trading strategy to backtest: sma_crossover, rsi_thresholds, or macd_crossover')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    },
    async ({ symbol, strategy }) => {
      try {
        const data = await getMaangBacktest(symbol, strategy);
        const result = {
          symbol: data.symbol,
          strategy: data.strategy,
          source: data.source,
          fetched_at: data.fetched_at,
          summary: data.summary,
          items: data.items.slice(-20)
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message.endsWith('.') ? message : `${message}.`
            }
          ]
        };
      }
    }
  );

  // Support invocation under normalized lowercase names as well
  if (req.body && req.body.method === 'tools/call' && req.body.params && req.body.params.name) {
    const rawName = req.body.params.name;
    if (rawName === 'maangpicker_maang_prices' || rawName === '[prefix]_maang_prices') {
      req.body.params.name = '[MAANGpicker]_maang_prices';
    } else if (rawName === 'maangpicker_maang_indicators' || rawName === '[prefix]_maang_indicators') {
      req.body.params.name = '[MAANGpicker]_maang_indicators';
    } else if (rawName === 'maangpicker_maang_backtest' || rawName === '[prefix]_maang_backtest') {
      req.body.params.name = '[MAANGpicker]_maang_backtest';
    }
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', async () => {
    try {
      await transport.close();
    } catch {}
    try {
      await server.close();
    } catch {}
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
