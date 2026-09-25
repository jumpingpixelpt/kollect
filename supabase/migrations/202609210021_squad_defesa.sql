-- Última defesa gerada do squad (feedback rodada 2, F2.3 — set/2026).
--
-- /api/squad-defesa grava aqui { texto, fonte: 'ia' | 'modelo', gerada_em, por } para o
-- squad reabrir com a defesa já feita, sem pagar outra chamada ao modelo. `por` é o uuid
-- de quem gerou; a página só mostra as iniciais. Coluna anulável: nada mais a lê.
alter table public.lists add column if not exists defesa jsonb;

comment on column public.lists.defesa is
  'Última defesa do squad (F2.3): { texto, fonte: ia|modelo, gerada_em, por }. Escrita por /api/squad-defesa.';
