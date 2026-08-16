import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import newsHandler from "./api/news.js";

dotenv.config({ path: ".env.local" });

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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