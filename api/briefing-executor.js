import { hasValidWireGeekAuth } from './auth.js';
import { collectBriefingResearch } from '../lib/briefing-executor.mjs';
import { buildCodexResearchPackage } from '../lib/codex-research-export.mjs';
import { createOpenAIResponse } from '../lib/openai-responses.mjs';

// One research call, external writing, canonical import; no scheduled generation.
export function createResearchExportHandler({ collect = collectBriefingResearch, createResponse = createOpenAIResponse, authenticate = hasValidWireGeekAuth } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Apuracao economica exige execucao manual.', code: 'MANUAL_RESEARCH_REQUIRED' });
    if (!authenticate(req)) return res.status(401).json({ error: 'Acesso nao autorizado.' });
    const calls = [];
    try {
      const research = await collect({ createResponse: async request => {
        const call = { purpose: request.purpose, model: request.model, status: 'started' };
        calls.push(call);
        const generated = await createResponse(request);
        call.status = 'completed';
        call.usage = generated.response?.usage || null;
        return generated;
      } });
      return res.status(200).json({ success: true, mode: 'codex_export', persisted: false,
        researchPackage: buildCodexResearchPackage(research), api_usage: { calls: calls.length, requests: calls } });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({ error: 'Nao foi possivel exportar a apuracao.', details: error.message,
        api_usage: { calls: calls.length, requests: calls } });
    }
  };
}
export default createResearchExportHandler();
