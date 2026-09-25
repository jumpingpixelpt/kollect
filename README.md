# Rising Stars · Beauty Radar (L'Oréal)

Plataforma de descoberta de rising stars de beauty no TikTok e Instagram, rankeados pelo **Radar Score** — um score proprietário desenhado pra capturar influência antes da escala (o "fator Cazé": achar o talento enquanto o cachê é barato).

## Radar Score (0–100)

| Pilar | Peso | O que mede |
|---|---|---|
| Momentum | 35 | Velocidade + aceleração de crescimento (seguidores e views) |
| Gravidade | 30 | Engajamento relativo ao tamanho, ponderado por saves e shares |
| Autoridade de Conteúdo | 25 | Transcrição (Groq Whisper) analisada por Claude: expertise, originalidade, didática, brand safety |
| Janela de Cachê | 10 | Bônus inverso ao tamanho quando os outros pilares são fortes |

**Janela Aberta** = score ≥ 75 e menos de 100k seguidores → contratar agora.

## Stack
Next.js 15 · Supabase (Postgres) · Vercel (+ Cron) · Apify (coleta) · Groq Whisper (transcrição) · Anthropic Claude (análise de conteúdo)

## Pipeline
1. `GET /api/cron/collect` (cron diário 06h) — Apify coleta perfis, vídeos, avatares e métricas → grava `snapshots`
2. `POST /api/pipeline/transcribe` `{video_id, media_url}` — Groq transcreve o vídeo
3. `POST /api/pipeline/analyze` `{video_id}` — Claude pontua a transcrição
4. `POST /api/score` — recalcula o Radar Score de todos

## Créditos do influencers.club (vendor pago)

**O plano é ANUAL, não mensal.** Confundir as duas coisas foi o que esvaziou ~12.000 créditos
em poucos meses (post-mortem de jul/2026). Regras em vigor desde então:

| camada | ferramenta | custo |
| --- | --- | --- |
| descoberta + dados públicos (perfil, posts, legenda, métricas) | Apify | barato — padrão para tudo |
| transcrição de vídeo | Groq whisper-turbo | centavos por creator |
| **demografia de audiência** | **influencers.club** | **~1 crédito/perfil — só aqui** |
| shares/saves de posts de Instagram | influencers.club | ~0,03 crédito/post — manual, dirigido |

- O IC é o **único** fornecedor da demografia de audiência, e é dela que saem a autoridade e a
  aderência do Score KOL (30% do peso). Por isso fica — mas só para isso.
- **Descoberta pelo IC está desligada** (`ic-sweep`, `ic-discover`). Revelou 37.815 perfis, 91%
  dos prospects da base, e foi a maior linha de custo. Reabre com `IC_DISCOVERY_ENABLED=1`.
- **`ic-shares` saiu da cadeia de `/api/enrich`** — corria em todo creator de Instagram. Continua
  disponível para corridas manuais dirigidas.
- Toda chamada paga passa por `lib/ic-budget.js`: saldo consultado **antes** da chamada (a consulta
  de saldo não gasta créditos), piso em `IC_CREDIT_FLOOR` (default 50), lote recusado se o saldo
  não puder ser determinado. O último saldo observado fica em `sweep_state.key = 'ic_credits'`.
- Antes de gastar: `GET /api/audience-refresh?dry=1` mostra fila, saldo e quantos créditos sairiam.
  `GET /api/ic-debug?credits=1` devolve o saldo cru (0 créditos).

## Setup
1. Copie `.env.example` → configure as env vars na Vercel
2. As chaves públicas do Supabase já têm fallback no código; as de escrita (`SUPABASE_SERVICE_ROLE_KEY`) e as APIs externas (`APIFY_TOKEN`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`) precisam ser adicionadas
3. `npm install && npm run dev`

O banco já vem com dados de demonstração (12 creators fictícios) pra interface nascer viva. A primeira coleta real do Apify substitui os números.
