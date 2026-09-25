import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import mcpHandler from './api/mcp.js';
import askHandler from './api/ask.js';
import stocksHandler from './api/stocks.js';
import indicatorsHandler from './api/indicators.js';
import backtestHandler from './api/backtest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // MCP Server endpoint (POST for JSON-RPC, GET for SSE/info, OPTIONS for CORS)
  app.all('/api/mcp', mcpHandler);

  // Gemini Agent endpoint
  app.all('/api/ask', askHandler);

  // Existing Data API endpoints
  app.get('/api/stocks', stocksHandler);
  app.get('/api/indicators', indicatorsHandler);
  app.get('/api/backtest', backtestHandler);

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MAANGpicker server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
