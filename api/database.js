import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "wiregeek.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS edicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT,
    data_edicao TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'rascunho',
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS noticias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    categoria TEXT NOT NULL,
    resumo TEXT,
    artigo TEXT,
    publicado_em TEXT,
    url TEXT NOT NULL,
    fonte TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fontes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noticia_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    url TEXT NOT NULL,
    publicado_em TEXT,
    FOREIGN KEY (noticia_id)
      REFERENCES noticias(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS imagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noticia_id INTEGER,
    tipo TEXT NOT NULL DEFAULT 'url',
    url TEXT,
    caminho TEXT,
    alt_text TEXT,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (noticia_id)
      REFERENCES noticias(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noticia_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (noticia_id)
      REFERENCES noticias(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS hashtags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noticia_id INTEGER NOT NULL,
    hashtag TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (noticia_id)
      REFERENCES noticias(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS edicao_noticias (
    edicao_id INTEGER NOT NULL,
    noticia_id INTEGER NOT NULL,
    ordem INTEGER NOT NULL,
    PRIMARY KEY (edicao_id, noticia_id),
    FOREIGN KEY (edicao_id)
      REFERENCES edicoes(id)
      ON DELETE CASCADE,
    FOREIGN KEY (noticia_id)
      REFERENCES noticias(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS research_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    executado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    janela_horas INTEGER NOT NULL,
    candidatos_pesquisados INTEGER DEFAULT 0,
    candidatos_validos INTEGER DEFAULT 0,
    erro TEXT
  );

  CREATE TABLE IF NOT EXISTS research_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    research_run_id INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    categoria TEXT NOT NULL,
    publicado_em TEXT,
    resumo TEXT,
    url TEXT NOT NULL,
    fonte TEXT NOT NULL,
    dados_json TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (research_run_id)
      REFERENCES research_runs(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_noticias_url
    ON noticias(url);

  CREATE INDEX IF NOT EXISTS idx_noticias_publicado_em
    ON noticias(publicado_em);

  CREATE INDEX IF NOT EXISTS idx_noticias_categoria
    ON noticias(categoria);

  CREATE INDEX IF NOT EXISTS idx_noticias_fonte
    ON noticias(fonte);

  CREATE INDEX IF NOT EXISTS idx_research_candidates_url
    ON research_candidates(url);

  CREATE INDEX IF NOT EXISTS idx_research_candidates_publicado_em
    ON research_candidates(publicado_em);

  CREATE INDEX IF NOT EXISTS idx_hashtags_noticia
    ON hashtags(noticia_id);

  CREATE INDEX IF NOT EXISTS idx_highlights_noticia
    ON highlights(noticia_id);

  CREATE INDEX IF NOT EXISTS idx_imagens_noticia
    ON imagens(noticia_id);
`);

console.log(`SQLite inicializado: ${DB_PATH}`);

export {
  db,
  DB_PATH,
};

