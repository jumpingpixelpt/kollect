-- Base do Creators Hub pré-montada (22/09/2026).
--
-- Medido em produção: a primeira visita de cada instância da Vercel levava 6–7,8 s, porque a
-- instância fria montava a base inteira pela RPC radar_base(false) (~10 MB de JSON, ~0,9 s de
-- SQL) e o cache era só de processo. A montagem (regras em lib/radar-base.js) passa a correr
-- uma vez, fora do pedido — cron de 10 em 10 min, fim da coleta diária, fim do atualizar-lote,
-- e a pedido quando a cópia envelhece — e o resultado compacto (lib/radar-compacto.js) fica
-- numa linha desta tabela, que qualquer instância lê numa ida.
--
-- Só aditivo: tabela nova, sem tocar em views, funções ou dados existentes. Apagar a linha
-- (ou a tabela) volta ao comportamento anterior: a app remonta pela RPC.
create table if not exists public.radar_cache (
  chave text primary key,                 -- 'hub' (uma linha por montagem)
  versao integer not null,                -- RADAR_CACHE_VERSAO do código que a gravou
  payload json not null,                  -- json, não jsonb: devolvido tal como foi gravado
  bytes integer,
  linhas integer,
  duracao_ms integer,                     -- quanto custou a montagem (leitura + JS)
  gerado_em timestamptz not null default now(),
  refrescando_em timestamptz              -- trinco do refresh em segundo plano (uma instância de cada vez)
);

-- lz4 descomprime mais depressa do que o pglz por omissão: a leitura é o caminho quente.
alter table public.radar_cache alter column payload set compression lz4;

-- Só o servidor (service_role) lê e escreve; o acesso do utilizador continua no gate da app.
alter table public.radar_cache enable row level security;
revoke all on table public.radar_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.radar_cache to service_role;

comment on table public.radar_cache is
  'Base do Creators Hub já montada e compacta (lib/radar-compacto.js); refrescada por /api/cron/radar-cache. Cache: apagar é seguro.';
