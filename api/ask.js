import { GoogleGenAI, mcpToTool } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMaangServer } from '../lib/maangMcpServer.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      name: 'MAANGpicker Gemini Agent',
      endpoint: '/api/ask',
      method: 'POST',
      model: 'gemini-3.8-flash',
      instructions: 'Send a POST request with JSON body {"question": "your question here"}.',
      maxLength: 500
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'GET', 'OPTIONS']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // 1. Before anything else: check GEMINI_API_KEY
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.trim()) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not set. Add it in Vercel and redeploy.'
    });
  }

  // 2. Validate question
  const { question } = req.body || {};
  if (!question || typeof question !== 'string' || !question.trim() || question.length > 500) {
    return res.status(400).json({
      error: 'Question is missing or exceeds 500 characters.'
    });
  }

  // 3. Connect to MCP servers listed in MCP_SERVERS
  const rawServers = process.env.MCP_SERVERS || '';
  const addresses = rawServers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const connectedClients = [];
  const unavailable = [];
  const nameMap = new Map();

  function wrapClientForGemini(client) {
    const origListTools = client.listTools.bind(client);
    client.listTools = async (...args) => {
      const result = await origListTools(...args);
      if (result && Array.isArray(result.tools)) {
        result.tools = result.tools.map((t) => {
          // Gemini tool names must match ^[a-zA-Z_][a-zA-Z0-9_]*$
          const clean = t.name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
          const valid = /^[a-zA-Z_]/.test(clean) ? clean : `mcp_${clean}`;
          nameMap.set(valid, t.name);
          return {
            ...t,
            name: valid
          };
        });
      }
      return result;
    };

    const origCallTool = client.callTool.bind(client);
    client.callTool = async (params, ...rest) => {
      const originalName = nameMap.get(params.name) || params.name;
      return origCallTool({ ...params, name: originalName }, ...rest);
    };
  }

  for (const address of addresses) {
    let url;
    try {
      url = new URL(address);
    } catch (err) {
      unavailable.push({
        address,
        reason: err instanceof Error ? err.message : 'Invalid URL'
      });
      continue;
    }

    const client = new Client({
      name: '[MAANGpicker]-agent',
      version: '1.0.0'
    });

    try {
      const transport = new StreamableHTTPClientTransport(url);
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out after 6 seconds')), 6000)
      );
      await Promise.race([connectPromise, timeoutPromise]);
      wrapClientForGemini(client);
      connectedClients.push(client);
    } catch (err) {
      unavailable.push({
        address,
        reason: err instanceof Error ? err.message : 'Connection failed'
      });
      try {
        await client.close();
      } catch {}
    }
  }

  // Fallback: If no external MCP servers connected, use built-in MAANGpicker MCP server
  let localServer = null;
  if (connectedClients.length === 0) {
    try {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      localServer = createMaangServer();
      await localServer.connect(serverTransport);

      const localClient = new Client({
        name: '[MAANGpicker]-internal-agent',
        version: '1.0.0'
      });
      await localClient.connect(clientTransport);
      wrapClientForGemini(localClient);
      connectedClients.push(localClient);
    } catch (err) {
      console.error('Failed to initialize internal MCP server fallback:', err);
    }
  }

  try {
    const ai = new GoogleGenAI();
    const systemInstruction =
      'answer only from tool results; give the source and the fetched_at time for every figure; if a tool returns an error or nothing, say so in one sentence and do not guess; at most 120 words.';

    const config = {
      systemInstruction
    };

    if (connectedClients.length > 0) {
      config.tools = [mcpToTool(...connectedClients)];
      config.automaticFunctionCalling = { maximumRemoteCalls: 6 };
    }

    let response;
    let lastErr;
    let usedModel = 'gemini-3.8-flash';

    // Try gemini-3.8-flash first; if 503 (high demand) or 429 (quota), retry or fallback to gemini-3.1-flash-lite
    const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

    modelLoop: for (const model of candidateModels) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: question,
            config
          });
          usedModel = model;
          break modelLoop;
        } catch (err) {
          lastErr = err;
          const status = err?.status || (err?.message?.includes('503') ? 503 : err?.message?.includes('429') ? 429 : 0);
          if (status === 503 || status === 429) {
            // If attempt 0, wait briefly and try once more before moving to next candidate model
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 1200));
              continue;
            }
          } else {
            // Non-transient error, don't loop
            throw err;
          }
        }
      }
    }

    if (!response) {
      throw lastErr || new Error('No response from Gemini');
    }

    // Build tool_calls from response.automaticFunctionCallingHistory
    const tool_calls = [];
    const history = response.automaticFunctionCallingHistory || [];
    const calls = [];
    const responses = [];

    for (const turn of history) {
      if (Array.isArray(turn.parts)) {
        for (const part of turn.parts) {
          if (part.functionCall) {
            calls.push(part.functionCall);
          }
          if (part.functionResponse) {
            responses.push(part.functionResponse);
          }
        }
      }
    }

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const resp = responses[i] || responses.find((r) => r.name === call.name);

      let failed = false;
      if (resp && resp.response) {
        const r = resp.response;
        if (r.isError || r.error) {
          failed = true;
        } else if (Array.isArray(r.content)) {
          if (r.content.some((c) => c && c.isError)) {
            failed = true;
          }
        }
      }

      tool_calls.push({
        name: nameMap.get(call.name) || call.name,
        args: call.args || {},
        failed
      });
    }

    return res.status(200).json({
      answer: response.text || '',
      tool_calls,
      unavailable,
      model: usedModel,
      answered_at: new Date().toISOString()
    });
  } catch (err) {
    let reason = 'Gemini API call failed';
    let status = err?.status || 502;
    try {
      const raw = err?.message || (err instanceof Error ? err.message : String(err));
      const jsonStart = raw.indexOf('{');
      if (jsonStart !== -1) {
        const parsed = JSON.parse(raw.slice(jsonStart));
        if (parsed?.error?.message) {
          reason = parsed.error.message;
          if (parsed.error.code) status = parsed.error.code;
        } else {
          reason = raw.split('\n')[0].replace(/^ApiError:\s*/, '').trim();
        }
      } else {
        reason = raw.split('\n')[0].replace(/^ApiError:\s*/, '').trim();
      }
    } catch {
      reason = err instanceof Error ? err.message.split('\n')[0].trim() : String(err);
    }

    return res.status(502).json({
      error: reason,
      status
    });
  } finally {
    for (const client of connectedClients) {
      try {
        await client.close();
      } catch {}
    }
    if (localServer) {
      try {
        await localServer.close();
      } catch {}
    }
  }
}
