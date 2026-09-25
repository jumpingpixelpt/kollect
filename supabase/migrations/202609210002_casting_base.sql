-- Geração da lista de nomes do briefing mais rápida (feedback rodada 2, B3.1 — set/2026).
--
-- /api/campaign carregava TODOS os creators com os JSONs inteiros (brand_history,
-- kol_screen, kol_score, audience — ~47 MB), TODA a história de `scores` (~50k linhas,
-- 5,4 MB, 50 páginas de 1000) e TODO o `brand_fit` (~13k linhas) antes de filtrar em JS:
-- ~10–11 s só de leitura, a cada confirmação. Estas funções devolvem o mesmo universo de
-- creators (o pré-filtro e o campaignEval continuam em JS, intactos — regras aprovadas pelo
-- cliente), mas só com os campos que o casting usa, a ÚLTIMA nota de cada creator e o
-- brand_fit da marca pedida, numa única ida à base.

-- casting_base(p_marca): um json com um objeto por creator, já na forma que o route lê
-- (brand_history/kol_screen/kol_score/audience recortados). Devolver um único valor json
-- evita o limite de 1000 linhas do PostgREST e a paginação.
--  · score_total: última linha de `scores` por creator — mesma regra do overwrite antigo
--    (computed_at mais recente; empate pelo id maior).
--  · fit_marca: brand_fit.fit_score da marca com esse nome exacto (brands.name é único);
--    null quando a marca não existe ou o creator não tem medição.
--  · marcas: só as 6 primeiras e só o nome (o route só usa isso).
--  · comercial: só o item "bets", e só id/resultado (é o único que o campaignEval lê).
create or replace function public.casting_base(p_marca text default null)
returns json
language sql
stable
set search_path = public
as $$
  with sc as (
    select distinct on (creator_id) creator_id, total
    from scores
    order by creator_id, computed_at desc, id desc
  ),
  bf as (
    select f.creator_id, f.fit_score
    from brand_fit f
    join brands b on b.id = f.brand_id
    where p_marca is not null and b.name = p_marca
  )
  -- json (texto) e não jsonb na saída: montar 5k objetos em jsonb custava ~200 ms a mais
  -- no servidor, e o resultado só é lido uma vez pelo route.
  -- Os JSONs grandes (brand_history, kol_screen) estão em TOAST: cada `->` sobre a coluna
  -- volta a descomprimi-la inteira. jsonb_to_record abre cada coluna UMA vez e o resto lê
  -- das fatias pequenas (1,3 s → ver docs/desempenho-rodada2.md). O case protege contra
  -- um valor que não seja objeto (jsonb_to_record daria erro e partia o casting).
  select coalesce(json_agg(json_build_object(
    'id', c.id, 'name', c.name, 'handle', c.handle, 'platform', c.platform,
    'followers', c.followers, 'niche', c.niche, 'category', c.category,
    'score_total', sc.total,
    'fit_marca', bf.fit_score,
    'brand_history', case when c.brand_history is null then null else json_build_object(
      'nichos', bh.nichos,
      'sub_nichos', bh.sub_nichos,
      'marcas', case when jsonb_typeof(bh.marcas) = 'array' then (
        select coalesce(json_agg(json_build_object('marca', e->'marca') order by o), '[]'::json)
        from jsonb_array_elements(bh.marcas) with ordinality t(e, o)
        where o <= 6
      ) else bh.marcas::json end
    ) end,
    'kol_screen', case when c.kol_screen is null then null else json_build_object(
      'classe', ks.classe,
      'metricas', case when ks.metricas is null then null else json_build_object(
        'niche_bucket', ks.metricas->'niche_bucket',
        'niche_density', ks.metricas->'niche_density',
        'eng_index', ks.metricas->'eng_index',
        'consistency_pct', ks.metricas->'consistency_pct',
        'reach_eff', ks.metricas->'reach_eff',
        'follower_pct', ks.metricas->'follower_pct',
        'pt_adj', ks.metricas->'pt_adj'
      ) end,
      'comercial', case when jsonb_typeof(ks.comercial) = 'array' then (
        select coalesce(json_agg(json_build_object('id', e->'id', 'resultado', e->'resultado')), '[]'::json)
        from jsonb_array_elements(ks.comercial) e
        where e->>'id' = 'bets'
      ) else ks.comercial::json end,
      'disaster', case when ks.disaster is null then null else json_build_object(
        'nivel', ks.disaster->'nivel',
        'sinais', ks.disaster->'sinais'
      ) end
    ) end,
    'kol_score', case when c.kol_score is null then null else json_build_object(
      'geral', case when c.kol_score->'geral' is null then null else json_build_object(
        'elegivel', c.kol_score->'geral'->'elegivel',
        'score', c.kol_score->'geral'->'score'
      ) end
    ) end,
    'audience', case when c.audience is null then null else json_build_object(
      'generos', c.audience->'generos',
      'mulheres_pct', c.audience->'mulheres_pct',
      'credibilidade_pct', c.audience->'credibilidade_pct'
    ) end
  ) order by c.id), '[]'::json)
  from creators c
  left join lateral jsonb_to_record(case when jsonb_typeof(c.brand_history) = 'object' then c.brand_history end)
    as bh(nichos jsonb, sub_nichos jsonb, marcas jsonb) on true
  left join lateral jsonb_to_record(case when jsonb_typeof(c.kol_screen) = 'object' then c.kol_screen end)
    as ks(classe jsonb, metricas jsonb, comercial jsonb, disaster jsonb) on true
  left join sc on sc.creator_id = c.id
  left join bf on bf.creator_id = c.id;
$$;

-- Reprocessamento: as linhas preservadas (decisões humanas e adições manuais) recebiam um
-- UPDATE por linha, em série. Agora vai tudo numa chamada. Cada item traz o id e só os
-- campos a mudar — campaign_role só vem nas linhas de creator (as do funil não o têm, e o
-- papel delas não pode ser apagado). O status nunca é tocado.
create or replace function public.casting_refresh(p_campaign_id uuid, p_rows jsonb)
returns integer
language sql
set search_path = public
as $$
  with x as (
    select (e->>'id')::uuid as id, e as patch
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
  ),
  u as (
    update campaign_creators cc set
      campaign_role = case when x.patch ? 'campaign_role' then x.patch->>'campaign_role' else cc.campaign_role end,
      match_score = case when x.patch ? 'match_score' then (x.patch->>'match_score')::numeric else cc.match_score end,
      rationale = case when x.patch ? 'rationale' then x.patch->>'rationale' else cc.rationale end
    from x
    where cc.id = x.id and cc.campaign_id = p_campaign_id
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Só o servidor (service role) chama: o casting lê a base inteira e o refresh escreve.
revoke all on function public.casting_base(text) from public, anon, authenticated;
revoke all on function public.casting_refresh(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.casting_base(text) to service_role;
grant execute on function public.casting_refresh(uuid, jsonb) to service_role;
