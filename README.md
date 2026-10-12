# WireGeek
Notícias Bagaça Studios

## Publicação automática no site Bagaça

A rota `api/site-autopublish.js` publica no site as matérias recentes que já têm banner editorial aprovado.
Ela roda uma vez por dia pelo cron da Vercel (`vercel.json`, `0 13 * * *`, 13:00 UTC; no plano Hobby a
precisão é de hora) e encadeia as ações do handler de site: `generate-editorial` → `approve-editorial` → `publish`.
Nenhum portão é contornado: a verificação contra as fontes, o recibo assinado e a aprovação gravada no banco
continuam obrigatórios.

Está **desligada por padrão**. Variáveis de ambiente:

| Variável | Padrão | Função |
|---|---|---|
| `SITE_AUTOPUBLISH` | desligada | `on` liga a publicação automática |
| `SITE_AUTOPUBLISH_DAILY_LIMIT` | 3 (1 a 10) | máximo de publicações por janela de 24h, contando as manuais |
| `SITE_AUTOPUBLISH_WINDOW_HOURS` | 48 (6 a 168) | idade máxima das notícias candidatas |

Também exige `CRON_SECRET` (cron), `WIREGEEK_AUTOMATION_KEY` e `WIREGEEK_ACCESS_KEY` (execução manual e
handler de site), `BAGACA_SITE_PUBLISH_URL`, `BAGACA_SITE_PUBLISH_KEY` e as chaves do Supabase e da OpenAI.

### Teste sem publicar

`dry_run` lista as candidatas sem gerar texto nem publicar, mesmo com a rota desligada:

```
POST /api/site-autopublish
x-wiregeek-automation-key: <WIREGEEK_AUTOMATION_KEY>
{"dry_run": true}
```

Cada execução devolve `published` e `skipped` (com etapa e motivo de cada falha). No máximo 6 tentativas por
execução. O cron só roda em Produção; teste em Preview com `dry_run` antes de definir `SITE_AUTOPUBLISH=on`.
