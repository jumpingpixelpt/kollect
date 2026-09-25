-- Busca do Creators Hub na base de descoberta (feedback rodada 2, F3.2 — set/2026).
--
-- O Hub passa a procurar também em `prospects` (~68,5 mil linhas) a cada tecla, por nome
-- (`name_norm`, coluna gerada e dobrada — ver lib/text.js) e por @. Sem índice, um
-- `ilike '%termo%'` que não acha nada varre a tabela toda: medido a 21/09, 189 ms por
-- consulta. Os índices trigram tornam a busca por substring indexável a partir de 3
-- caracteres (com 2 o Postgres volta ao seq scan, que continua correcto).
--
-- Só aditivo: a extensão vive no schema `extensions` (convenção do Supabase) e os índices
-- são novos. A 68 mil linhas a criação leva segundos; não se usa CONCURRENTLY porque a
-- migração corre dentro de uma transacção.
create extension if not exists pg_trgm with schema extensions;

create index if not exists prospects_name_norm_trgm_idx
  on public.prospects using gin (name_norm extensions.gin_trgm_ops);

create index if not exists prospects_handle_trgm_idx
  on public.prospects using gin (handle extensions.gin_trgm_ops);
