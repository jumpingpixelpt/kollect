-- Resumo leve comum ao Termômetro e às Descobertas. O Termômetro buscava as tags
-- como linhas sem paginação e só contava os primeiros 1.000 creators.
-- Um retorno JSON agrega a base inteira e evita várias viagens para contagens.
--
-- As regras existentes do funil foram mantidas literalmente: noFunil/deHoje
-- ainda não excluem ja_no_radar:* / duplicado_handle:*, embora a lista de
-- Descobertas já os exclua. Essa divergência de produto não é alterada aqui.
-- p_hoje permite ao servidor usar o dia UTC também na chave do cache de 60 s.
create or replace function public.painel_resumo(
  p_hoje date default ((now() at time zone 'UTC')::date)
)
returns json
language sql
stable
security invoker
set search_path = ''
as $function$
  with resumo_prospects as (
    select
      count(*) as universo,
      count(*) filter (where p.mini_score >= 50) as qualificadas,
      count(*) filter (where p.growth_30 is not null) as com_growth,
      count(*) filter (where p.status not like 'sem_handle:irrecuperavel%') as universo_funil,
      count(*) filter (
        where p.descoberto_em >= coalesce(p_hoje, (now() at time zone 'UTC')::date)
          and p.status <> 'substituida_ic' and p.status <> 'promovido'
          and p.status not like 'sem_handle:irrecuperavel%'
      ) as de_hoje,
      count(*) filter (
        where p.status <> 'substituida_ic' and p.status <> 'promovido'
          and p.status not like 'sem_handle:irrecuperavel%'
      ) as no_funil
    from public.prospects p
  ), classes as materialized (
    select
      case
        when k.classe = 'kol' then 'kol'
        when k.classe = 'rising_star' then 'rising_star'
        when k.classe in ('hidden_gem', 'brand_safe_performer', 'elegivel') then 'pool'
        when k.elegivel is null then 'sem_calculo'
        else 'inelegivel'
      end as tag,
      count(*) as n
    from public.creators c
    left join lateral jsonb_to_record(
      case when jsonb_typeof(c.kol_score -> 'geral') = 'object'
        then c.kol_score -> 'geral' else '{}'::jsonb end
    ) as k(classe text, elegivel text) on true
    group by 1
  ), resumo_creators as (
    select
      coalesce(sum(n), 0) as n,
      coalesce(json_object_agg(tag, n), '{}'::json) as tags
    from classes
  )
  select json_build_object(
    'termometro', json_build_object(
      'universo', p.universo,
      'qualificadas', p.qualificadas,
      'comGrowth', p.com_growth,
      'noRadar', c.n,
      'classes', c.tags,
      'fontes', (
        select coalesce(json_agg(f order by f.n desc, f.fonte), '[]'::json)
        from (
          select fonte, n, ultima_descoberta
          from public.prospect_fontes
        ) f
      )
    ),
    'funil', json_build_object(
      'universo', p.universo_funil,
      'comAnalise', c.n,
      'deHoje', p.de_hoje,
      'noFunil', p.no_funil
    ),
    'termos', (
      select coalesce(json_agg(t order by t.n desc, t.termo), '[]'::json)
      from (
        select termo, n
        from public.prospect_termos
      ) t
    )
  )
  from resumo_prospects p
  cross join resumo_creators c;
$function$;

revoke all on function public.painel_resumo(date) from public, anon, authenticated;
grant execute on function public.painel_resumo(date) to service_role;

comment on function public.painel_resumo(date) is
  'Contagens completas, tags, fontes e termos do painel; acesso apenas pelo servidor. Dia do funil em UTC.';

