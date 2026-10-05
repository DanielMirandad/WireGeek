import { readFile } from 'node:fs/promises';
import { serializeCodexResearch } from '../lib/codex-research-export.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Usage: node scripts/export-codex-research.mjs collected-research.json');
  const research = JSON.parse(await readFile(args[0], 'utf8'));
  process.stdout.write(serializeCodexResearch(research));
} catch (error) {
  process.stderr.write(`Export failed: ${error.message}\n`);
  process.exitCode = 1;
}
