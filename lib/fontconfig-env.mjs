import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fontFile = fileURLToPath(
  new URL("../public/fonts/Archive-Regular.otf", import.meta.url)
);

if (!existsSync(fontFile)) {
  throw new Error(
    `Fonte Archive nao encontrada: ${fontFile}`
  );
}

const fontDir = dirname(fontFile);
const configDir = join(tmpdir(), "wiregeek-fontconfig");
const cacheDir = join(configDir, "cache");
const configFile = join(configDir, "fonts.conf");

mkdirSync(cacheDir, { recursive: true });

function xmlPath(value) {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

writeFileSync(
  configFile,
  `<?xml version="1.0"?>
<fontconfig>
  <dir>${xmlPath(fontDir)}</dir>
  <cachedir>${xmlPath(cacheDir)}</cachedir>
</fontconfig>
`,
  "utf8"
);

process.env.FONTCONFIG_PATH = configDir;
process.env.FONTCONFIG_FILE = configFile;
