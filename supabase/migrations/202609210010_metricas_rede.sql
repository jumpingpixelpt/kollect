-- Números por rede pré-calculados para o card do briefing (feedback rodada 2, F1.7 — set/2026).
--
-- O card expandido de /campanha/[id] passa a mostrar big numbers por rede (Instagram,
-- TikTok), «Só publis» e «Todas as redes», como os Resultados da ficha. A página do briefing
-- não carrega `videos` (150 creators × 30 peças por pedido é caro), por isso o retrato de 90
-- dias fica gravado por creator neste JSON, calculado por lib/metricas-rede.js a partir das
-- peças da pessoa (todas as contas com o mesmo person_key). Escrito por
-- scripts/metricas-rede.mjs (backfill) e pelo /api/import-videos depois de gravar as peças.
--
-- Só acrescenta uma coluna anulável: nada lê nem escreve nela fora destes três sítios.
alter table public.creators add column if not exists metricas_rede jsonb;

comment on column public.creators.metricas_rede is
  'Retrato de 90 dias por rede, publi/orgânico e total da pessoa (lib/metricas-rede.js). Pré-cálculo para o card do briefing.';
