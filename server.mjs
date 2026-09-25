import express from "express";
import youtubeHandler from "./api/youtube.js";
import tiktokHandler from "./api/tiktok.js";
import cors from "cors";
import dotenv from "dotenv";
import newsHandler from "./api/news.js";
import authHandler from "./api/auth.js";
import edicoesHandler from "./api/edicoes.js";
import bannerHandler from "./api/banner.js";
import briefingBannerHandler from "./api/banner-briefing.js";
import publicacoesHandler from "./api/publicacoes.js";
import publicarHandler from "./api/publicar.js";
import briefingImportHandler from "./api/briefing-import.js";
import canvaAuthHandler from "./api/canva-auth.js";

dotenv.config({
  path: [
    ".env.local",
    ".env.development.local",
  ],
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.all("/api/youtube", youtubeHandler);
app.all("/api/tiktok", tiktokHandler);

app.all("/api/auth", async (req, res) => {
  console.log(`WIRE/GEEK: ${req.method} /api/auth recebido.`);

  try {
    await authHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro no auth:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de autenticacao.",
        details: error?.message || String(error),
      });
    }
  }
});

app.get("/api/edicoes", async (req, res) => {
  console.log("WIRE/GEEK: GET /api/edicoes recebido.");

  try {
    await edicoesHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro no edicoes:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de edicoes.",
        details: error?.message || String(error),
      });
    }
  }
});
app.all("/api/publicacoes", async (req, res) => {
  console.log(`WIRE/GEEK: ${req.method} /api/publicacoes recebido.`);
  try {
    await publicacoesHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro em publicacoes:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de publicacoes.",
        details: error?.message || String(error),
      });
    }
  }
});

app.post("/api/publicar", async (req, res) => {
  console.log("WIRE/GEEK: POST /api/publicar recebido.");
  try {
    await publicarHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro em publicar:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de publicacao.",
        details: error?.message || String(error),
      });
    }
  }
});

app.post("/api/briefing-import", async (req, res) => {
  console.log("WIRE/GEEK: POST /api/briefing-import recebido.");

  try {
    await briefingImportHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro no briefing-import:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro ao importar Briefing Geek Diário.",
        details: error?.message || String(error),
      });
    }
  }
});
app.post("/api/banner-briefing", async (req, res) => {
  try {
    await briefingBannerHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro no banner briefing:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de banner briefing.",
      });
    }
  }
});

app.get("/api/canva/authorize", canvaAuthHandler);
app.get("/api/canva/callback", canvaAuthHandler);
app.get("/api/canva/dataset", (req, res) => {
  return canvaAuthHandler(req, res);
});
app.post("/api/canva/autofill", canvaAuthHandler);

app.post("/api/banner", async (req, res) => {
  console.log("WIRE/GEEK: POST /api/banner recebido.");

  try {
    await bannerHandler(req, res);
  } catch (error) {
    console.error("WIRE/GEEK: erro no banner:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend de banner.",
        details: error?.message || String(error),
      });
    }
  }
});

app.post("/api/news", async (req, res) => {
  console.log("WIRE/GEEK: POST /api/news recebido.");
  console.log("WIRE/GEEK: body:", req.body);

  try {
    await newsHandler(req, res);
    console.log("WIRE/GEEK: handler finalizado.");
  } catch (error) {
    console.error("WIRE/GEEK: erro no handler:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro no backend.",
        details: error?.message || String(error),
      });
    }
  }
});

const PORT = 3001;

app.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log(" WIRE/GEEK LOCAL BACKEND");
  console.log("=================================");
  console.log(`API: http://localhost:${PORT}/api/news`);
  console.log(`AUTH: http://localhost:${PORT}/api/auth`);
  console.log(
    "Gemini:",
    Boolean(
      process.env.GOOGLE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY
    )
      ? "CONFIGURADO"
      : "NAO CONFIGURADO"
  );
  console.log("=================================");
  console.log("");
});
