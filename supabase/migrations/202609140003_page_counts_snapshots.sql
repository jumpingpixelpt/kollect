-- Contagens dos cartões sem transportar todos os membros para o servidor.
-- IDs já filtrados por acesso no chamador; apenas service_role pode executar.
create or replace function public.page_counts(
  p_campaign_ids uuid[] default '{}'::uuid[],
  p_list_ids uuid[] default '{}'::uuid[],
  p_briefing_ids uuid[] default '{}'::uuid[]
)
returns json language sql stable security invoker set search_path = ''
as $function$
  select json_build_object(
    'campaigns', (
      select coalesce(json_agg(r), '[]'::json) from (
        select campaign_id as id, count(*) as total,
          count(*) filter (where kind = 'kol') as kol,
          count(*) filter (where kind = 'rising') as rising
        from public.campaign_creators
        where campaign_id = any(p_campaign_ids)
        group by campaign_id
      ) r
    ),
    'lists', (
      select coalesce(json_agg(r), '[]'::json) from (
        select list_id as id, count(*) as total,
          count(*) filter (where status = 'concluida') as concluida
        from public.list_creators
        where list_id = any(p_list_ids)
        group by list_id
      ) r
    ),
    'briefings', (
      select coalesce(json_agg(r), '[]'::json) from (
        -- briefing_member_view preserva uma linha por bm.id (DISTINCT ON).
        -- Seus joins de creators/scores não alteram a inclusão nem p_oculto:
        -- basta consultar o prospect para reproduzir o filtro das abas.
        select bm.briefing_id as id, count(*) as total
        from public.briefing_members bm
        left join public.prospects p on p.tubular_id = bm.prospect_id
        where bm.briefing_id = any(p_briefing_ids)
          and not coalesce(p.status like 'sem_handle:irrecuperavel%', false)
        group by bm.briefing_id
      ) r
    )
  );
$function$;

revoke all on function public.page_counts(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.page_counts(uuid[], uuid[], uuid[]) to service_role;

-- A squad usa a última LINHA, mesmo com métricas nulas; o casting usa a última
-- observação não-nula de cada métrica. Não misturar as duas regras de produto.
create or replace function public.creator_latest_metrics(p_creator_ids uuid[])
returns json language sql stable security invoker set search_path = ''
as $function$
  select coalesce(json_agg(r order by r.creator_id), '[]'::json)
  from (
    select ids.creator_id, latest.captured_at, latest.avg_views, latest.eng_rate,
      av.avg_views as last_avg_views, er.eng_rate as last_eng_rate
    from (select distinct unnest(p_creator_ids) as creator_id) ids
    join lateral (
      select s.captured_at, s.avg_views, s.eng_rate from public.snapshots s
      where s.creator_id = ids.creator_id
      order by s.captured_at desc nulls last, s.id desc limit 1
    ) latest on true
    left join lateral (
      select s.avg_views from public.snapshots s
      where s.creator_id = ids.creator_id and s.avg_views is not null
      order by s.captured_at desc nulls last, s.id desc limit 1
    ) av on true
    left join lateral (
      select s.eng_rate from public.snapshots s
      where s.creator_id = ids.creator_id and s.eng_rate is not null
      order by s.captured_at desc nulls last, s.id desc limit 1
    ) er on true
  ) r;
$function$;

revoke all on function public.creator_latest_metrics(uuid[]) from public, anon, authenticated;
grant execute on function public.creator_latest_metrics(uuid[]) to service_role;

-- Cartões e castings precisam das classes, não dos fatores/evidências completos
-- do Score KOL. Preservar a existência do ramo: {} difere de null no classeDe.
create or replace function public.campaign_creator_classes(p_creator_ids uuid[])
returns json language sql stable security invoker set search_path = ''
as $function$
  select coalesce(json_agg(r order by r.id), '[]'::json)
  from (
    select c.id,
      json_build_object(
        'geral', case when jsonb_typeof(ks.geral) = 'object'
          then jsonb_build_object('classe', ks.geral -> 'classe', 'elegivel', ks.geral -> 'elegivel')
          else ks.geral end,
        'masculino', case when jsonb_typeof(ks.masculino) = 'object'
          then jsonb_build_object('classe', ks.masculino -> 'classe', 'elegivel', ks.masculino -> 'elegivel')
          else ks.masculino end
      ) as kol_score,
      json_build_object('classe', c.kol_screen -> 'classe',
        'disaster', json_build_object('nivel', c.kol_screen -> 'disaster' -> 'nivel')) as kol_screen
    from public.creators c
    left join lateral jsonb_to_record(
      case when jsonb_typeof(c.kol_score) = 'object' then c.kol_score else '{}'::jsonb end
    ) as ks(geral jsonb, masculino jsonb) on true
    where c.id = any(p_creator_ids)
  ) r;
$function$;

revoke all on function public.campaign_creator_classes(uuid[]) from public, anon, authenticated;
grant execute on function public.campaign_creator_classes(uuid[]) to service_role;
