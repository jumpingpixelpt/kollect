-- Base do radar em uma leitura: as páginas de OFFSET recalculavam a leaderboard
-- inteira, e brand_history/kol_screen completos transferiam 23 MB por montagem.
-- Mantém as réguas da view existente e os agregados completos de snapshots/vídeos.
-- O retorno escalar JSON não sofre o limite de 1.000 linhas do PostgREST.
-- json (em vez de jsonb) evita converter/desduplicar novamente toda a resposta;
-- o cliente Supabase continua recebendo o mesmo objeto JavaScript.
create or replace function public.radar_base(p_light boolean default false)
returns json
language sql
stable
security invoker
set search_path = ''
as $function$
  select json_build_object(
    'creators', (
      select coalesce(json_agg(r order by r.total desc, r.id), '[]'::json)
      from (
        select
          id, name, handle, platform, avatar_url, bio, niche, category,
          followers, person_key, total, kol_nota, kol_estado, kol_classe,
          janela_aberta, growth_30d, cache_per_video
        from public.leaderboard
      ) r
    ),
    'bhRows', (
      select coalesce(json_agg(r order by r.id), '[]'::json)
      from (
        select
          c.id,
          case when c.brand_history is null then null else json_build_object(
            'nichos', bh.nichos,
            'sub_nichos', bh.sub_nichos,
            'formatos', bh.formatos,
            'marcas', (
              select coalesce(json_agg(
                json_build_object('marca', m.item -> 'marca', 'categoria', m.item -> 'categoria')
                order by m.ord
              ), '[]'::json)
              from jsonb_array_elements(
                case when jsonb_typeof(bh.marcas) = 'array' then bh.marcas else '[]'::jsonb end
              ) with ordinality as m(item, ord)
            )
          ) end as brand_history,
          json_build_object('metricas', json_build_object(
            'niche_bucket', c.kol_screen -> 'metricas' -> 'niche_bucket'
          )) as kol_screen,
          c.territorio,
          c.kol_score -> 'geral' ->> 'classe' as kol_classe
        from public.creators c
        -- Extrair as quatro propriedades juntas evita descomprimir o JSON grande
        -- uma vez por propriedade. Os arrays preservam a ordem gerada pela análise.
        left join lateral jsonb_to_record(
          case when jsonb_typeof(c.brand_history) = 'object'
            then c.brand_history else '{}'::jsonb end
        ) as bh(nichos jsonb, sub_nichos jsonb, formatos jsonb, marcas jsonb) on true
      ) r
    ),
    'seriesRows', case when p_light then '[]'::json else (
      select coalesce(json_agg(r order by r.creator_id), '[]'::json)
      from (
        select creator_id, snaps
        from public.creator_snapshot_series
      ) r
    ) end,
    'vstats', case when p_light then '[]'::json else (
      select coalesce(json_agg(r order by r.creator_id), '[]'::json)
      from (
        select creator_id, eng_per_post, views_per_post
        from public.creator_video_stats
      ) r
    ) end
  );
$function$;

-- A montagem inteira pertence ao servidor autenticado pela aplicação. Não abrir
-- uma RPC pública nem depender dos privilégios PUBLIC que funções ganham por padrão.
revoke all on function public.radar_base(boolean) from public, anon, authenticated;
grant execute on function public.radar_base(boolean) to service_role;

comment on function public.radar_base(boolean) is
  'Leitura compacta do radar para o servidor; preserva leaderboard, séries e médias, sem paginação repetida. p_light omite séries e vídeos.';
