import { hasValidWireGeekAuth } from './auth.js';
import { loadRecentPublishedNews } from './persistence.js';
import { buildCodexEditorialExportPackage } from '../lib/codex-research-export.mjs';

// Zero paid API calls: export editorial context for external Codex/ChatGPT research + writing.
export function createResearchExportHandler({
  loadHistory = loadRecentPublishedNews,
  authenticate = hasValidWireGeekAuth,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'A exportacao para Codex exige execucao manual.',
        code: 'MANUAL_CODEX_EXPORT_REQUIRED',
      });
    }

    if (!authenticate(req)) {
      return res.status(401).json({ error: 'Acesso nao autorizado.' });
    }

    try {
      const history = await loadHistory();
      const researchPackage = buildCodexEditorialExportPackage(history);

      return res.status(200).json({
        success: true,
        mode: 'codex_export',
        persisted: false,
        researchPackage,
        api_usage: { calls: 0, requests: [] },
      });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        error: 'Nao foi possivel preparar o pacote para Codex.',
        details: error.message,
        api_usage: { calls: 0, requests: [] },
      });
    }
  };
}

export default createResearchExportHandler();
