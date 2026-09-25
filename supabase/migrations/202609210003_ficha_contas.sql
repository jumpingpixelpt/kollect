-- Ficha do creator mais leve (feedback rodada 2, B3.2 — set/2026).
--
-- A ficha lia a vista `leaderboard` duas vezes em série: primeiro a conta aberta (por id),
-- depois as contas irmãs (por person_key, que só se sabe depois da primeira leitura). Esta
-- função faz as duas numa ida só e devolve o perfil + irmãs com os campos da ficha.
-- Cada ramo filtra por coluna indexada, e o filtro desce para dentro da vista (o EXPLAIN
-- mostra os LATERAL de scores/snapshots só para as linhas pedidas, não para a base toda).
--
-- Mesma regra de antes: só contas presentes na leaderboard (com score). A ordem por id é a
-- da consulta antiga, para o desempate por seguidores na ficha continuar igual.

-- person_key não tinha índice: a leitura das irmãs era um seq scan em creators (usada
-- também pelo detalhe do briefing, lib/campaign-detail.js).
create index if not exists creators_person_key_idx on public.creators (person_key) where person_key is not null;

create or replace function public.ficha_contas(p_id uuid)
returns json
language sql
stable
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(x) order by x.id), '[]'::json) from (
    select l.id, l.name, l.handle, l.platform, l.followers, l.avatar_url, l.bio, l.niche,
           l.category, l.person_key, l.janela_aberta, l.discovered_at
    from leaderboard l
    where l.id = p_id
    union all
    select l.id, l.name, l.handle, l.platform, l.followers, l.avatar_url, l.bio, l.niche,
           l.category, l.person_key, l.janela_aberta, l.discovered_at
    from leaderboard l
    where l.person_key = (select c.person_key from creators c where c.id = p_id)
      and l.id <> p_id
  ) x;
$$;

-- As páginas leem com a service role (lib/supabase.js); nada de anon.
revoke all on function public.ficha_contas(uuid) from public, anon, authenticated;
grant execute on function public.ficha_contas(uuid) to service_role;
