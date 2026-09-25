import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMaangServer } from '../lib/maangMcpServer.js';

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
  const server = createMaangServer();

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
