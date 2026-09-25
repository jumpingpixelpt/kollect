-- "Mais nomes" (feedback rodada 2, F1.3 — set/2026): os nomes que o alargamento traz
-- entram no FIM da lista, sem reordenar o que já foi visto. `lote` 0 = geração original
-- do briefing; 1, 2, … = cada clique em "Mais nomes". A página ordena por lote antes do
-- match_score. Aditiva: default 0 preenche as linhas existentes sem reescrever a tabela.
alter table public.campaign_creators add column if not exists lote smallint not null default 0;
comment on column public.campaign_creators.lote is 'Lote de geração: 0 = casting original; n = n-ésimo clique em "Mais nomes" (entra no fim da lista).';
