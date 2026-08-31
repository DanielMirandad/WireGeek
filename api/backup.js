import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const DB_PATH = path.join(DATA_DIR, "wiregeek.db");

const RETENTION_COUNT = 30;

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export async function createDatabaseBackup() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Banco nao encontrado: ${DB_PATH}`);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = path.join(
    BACKUP_DIR,
    `wiregeek-${timestamp}.db`
  );

  const db = new Database(DB_PATH);

  try {
    await db.backup(backupPath);
  } finally {
    db.close();
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(
      "O SQLite informou que o backup terminou, mas o arquivo nao foi encontrado."
    );
  }

  const stats = fs.statSync(backupPath);

  if (stats.size === 0) {
    fs.unlinkSync(backupPath);

    throw new Error(
      "Backup criado com tamanho zero."
    );
  }

  cleanupOldBackups();

  console.log(
    "WIRE/GEEK: backup criado:",
    backupPath
  );

  console.log(
    "WIRE/GEEK: tamanho:",
    stats.size,
    "bytes"
  );

  return {
    path: backupPath,
    size: stats.size,
  };
}

function cleanupOldBackups() {
  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((file) =>
      /^wiregeek-.*\.db$/i.test(file)
    )
    .map((file) => {
      const fullPath =
        path.join(BACKUP_DIR, file);

      return {
        file,
        path: fullPath,
        mtime: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort(
      (a, b) => b.mtime - a.mtime
    );

  const obsolete =
    backups.slice(RETENTION_COUNT);

  for (const backup of obsolete) {
    fs.unlinkSync(backup.path);

    console.log(
      "WIRE/GEEK: backup antigo removido:",
      backup.file
    );
  }
}

try {
  await createDatabaseBackup();

  console.log(
    "WIRE/GEEK: backup concluido."
  );
} catch (error) {
  console.error(
    "WIRE/GEEK: erro ao criar backup:",
    error?.message || error
  );

  process.exitCode = 1;
}
