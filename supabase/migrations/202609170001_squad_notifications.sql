-- Criador da squad, baseline por membro e fila privada de alertas de crescimento.
-- Inspecionado no projeto rpwkwulugrwxkzqudkeu em 17/09/2026. Não infere dono
-- de squads antigas avulsas; o vínculo explícito da campanha permite o backfill.
alter table public.lists add column user_id uuid references auth.users(id) on delete set null;
update public.lists l set user_id = c.user_id from public.campaigns c
where l.campaign_id = c.id and l.user_id is null;
create index lists_user_id_idx on public.lists(user_id);

-- Mesma regra de lib/casting.js:tagDaFicha, sempre no ramo geral.
create function public.squad_creator_tag(p_score jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_score->'geral' is null or p_score->'geral' = 'null'::jsonb then null
    when (p_score #> '{geral,elegivel}') is distinct from 'true'::jsonb then 'pool'
    when p_score #>> '{geral,classe}' = 'kol' then 'kol'
    when p_score #>> '{geral,classe}' = 'rising_star' then 'rising_star'
    else 'pool' end;
$$;

alter table public.list_creators add column squad_alert_tag text
  check (squad_alert_tag in ('kol', 'rising_star', 'pool'));
alter table public.list_creators add column squad_alert_checked_at timestamptz not null default now();
update public.list_creators m set squad_alert_tag = public.squad_creator_tag(c.kol_score)
from public.creators c where c.id = m.creator_id;

create function public.squad_member_baseline() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.creator_id is not distinct from old.creator_id
    and new.list_id is not distinct from old.list_id then return new; end if;
  new.squad_alert_tag := (select public.squad_creator_tag(c.kol_score)
    from public.creators c where c.id = new.creator_id);
  new.squad_alert_checked_at := now();
  return new;
end;
$$;
create trigger squad_member_baseline before insert or update of creator_id, list_id
on public.list_creators for each row execute function public.squad_member_baseline();

create table public.squad_alerts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.list_creators(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  list_name text not null,
  creator_name text not null,
  creator_handle text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'needs_review')),
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  attempts integer not null default 0,
  request_body jsonb,
  provider_id text,
  sent_at timestamptz,
  last_error text,
  unique(list_id, creator_id)
);
alter table public.squad_alerts enable row level security;
revoke all on public.squad_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.squad_alerts to service_role;
create index squad_alerts_pending_idx on public.squad_alerts(available_at, created_at)
where status in ('pending', 'processing');

-- Um alerta por creator/squad. Não notifica Rising Stars já existentes no baseline,
-- nem uma descida KOL -> Rising Star. Primeira análise após a inclusão pode alertar.
create function public.squad_collect_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('kollect:squad-alerts', 0)) then return 0; end if;
  -- O lock mantém baseline e evento atômicos perante duas execuções concorrentes.
  perform 1 from public.list_creators for update;
  -- Evento e baseline usam a mesma leitura: um rescore concorrente não pode
  -- avançar o baseline sem que a transição correspondente tenha sido avaliada.
  with observed as materialized (
    select m.id, m.list_id, m.creator_id, m.squad_alert_tag as previous_tag,
      public.squad_creator_tag(c.kol_score) as current_tag, m.created_at,
      l.user_id, u.email, l.name as list_name, c.name as creator_name, c.handle
    from public.list_creators m
    join public.lists l on l.id = m.list_id
    join public.creators c on c.id = m.creator_id
    left join auth.users u on u.id = l.user_id
  ), inserted as (
    insert into public.squad_alerts(membership_id, list_id, creator_id, user_id,
      recipient_email, list_name, creator_name, creator_handle)
    select id, list_id, creator_id, user_id, email, list_name, creator_name, handle
    from observed where current_tag = 'rising_star'
      and (previous_tag is null or previous_tag = 'pool')
      and coalesce(email, '') <> ''
    order by created_at, id
    on conflict (list_id, creator_id) do nothing
    returning id
  ), advanced as (
    update public.list_creators m set
      -- Ausência temporária de score não apaga uma classificação conhecida.
      squad_alert_tag = coalesce(o.current_tag, o.previous_tag), squad_alert_checked_at = now()
    from observed o where o.id = m.id returning m.id
  )
  select count(*)::integer into queued from inserted;
  return queued;
end;
$$;

-- Claims vencem em 10 min. A janela automática fica abaixo das 24 h garantidas
-- pela Resend; envios de resultado incerto mais antigos exigem reconciliação.
create function public.squad_claim_alert(p_limit integer default 1)
returns setof public.squad_alerts
language plpgsql security definer set search_path = '' as $$
begin
  update public.squad_alerts set status = 'needs_review', claim_token = null,
    last_error = 'Janela de reenvio encerrada; conferir entrega no provedor antes de nova tentativa'
  where status in ('pending', 'processing')
    and first_attempt_at <= now() - interval '23 hours';
  return query
  with picked as (
    select a.id from public.squad_alerts a
    join public.list_creators m on m.id = a.membership_id and m.creator_id = a.creator_id and m.list_id = a.list_id
    join public.lists l on l.id = a.list_id and l.user_id = a.user_id
    where (a.status = 'pending' and a.available_at <= now())
      or (a.status = 'processing' and a.claimed_at < now() - interval '10 minutes')
    order by a.created_at, a.id
    limit least(greatest(coalesce(p_limit, 1), 1), 20)
    for update of a skip locked
  )
  update public.squad_alerts a set status = 'processing', claimed_at = now(),
    first_attempt_at = coalesce(a.first_attempt_at, now()),
    claim_token = gen_random_uuid(), attempts = a.attempts + 1
  from picked p where a.id = p.id returning a.*;
end;
$$;

create function public.squad_finish_alert(p_id uuid, p_token uuid, p_status text,
  p_error text default null, p_provider_id text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare updated integer;
begin
  if p_status not in ('pending', 'sent', 'failed') then raise exception 'Status inválido'; end if;
  if p_status = 'sent' and coalesce(p_provider_id, '') = '' then raise exception 'Confirmação do provedor ausente'; end if;
  update public.squad_alerts set status = p_status,
    last_error = left(p_error, 300), provider_id = coalesce(p_provider_id, provider_id),
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    available_at = now() + interval '15 minutes', claim_token = null
  where id = p_id and claim_token = p_token and status = 'processing';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function public.squad_creator_tag(jsonb) from public, anon, authenticated;
revoke all on function public.squad_member_baseline() from public, anon, authenticated;
revoke all on function public.squad_collect_alerts() from public, anon, authenticated;
revoke all on function public.squad_claim_alert(integer) from public, anon, authenticated;
revoke all on function public.squad_finish_alert(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.squad_creator_tag(jsonb) to service_role;
grant execute on function public.squad_collect_alerts() to service_role;
grant execute on function public.squad_claim_alert(integer) to service_role;
grant execute on function public.squad_finish_alert(uuid, uuid, text, text, text) to service_role;
