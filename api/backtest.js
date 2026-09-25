import { getMaangBacktest } from '../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { symbol, strategy } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query parameter: symbol' });
  }
  if (!strategy) {
    return res.status(400).json({ error: 'Missing required query parameter: strategy (sma_crossover, rsi_thresholds, macd_crossover)' });
  }

  try {
    const data = await getMaangBacktest(symbol, strategy);
    return res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isClientError = message.includes('not supported') || message.includes('not a supported') || message.includes('required');
    return res.status(isClientError ? 400 : 502).json({ error: message });
  }
}
