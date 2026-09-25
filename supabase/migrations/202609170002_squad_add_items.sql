-- Inclusões concorrentes na mesma squad não duplicam membros nem inflam os KPIs.
-- Mantém associações históricas intactas; não precisa apagar duplicados antigos.
create table if not exists public.squad_member_exclusions (
  list_id uuid not null references public.lists(id) on delete cascade,
  member_key text not null check (member_key ~ '^[cp]:.+'),
  removed_at timestamptz not null default now(),
  primary key (list_id, member_key)
);
alter table public.squad_member_exclusions enable row level security;
revoke all on table public.squad_member_exclusions from public, anon, authenticated;
grant select, insert, update, delete on table public.squad_member_exclusions to service_role;

create or replace function public.add_squad_items(p_list_id uuid, p_items jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  added integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Envie até 500 perfis por vez';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_list_id::text, 0));
  perform 1 from public.lists where id = p_list_id for key share;
  if not found then raise exception 'Squad não encontrado'; end if;

  -- Uma inclusão manual explícita pode desfazer a remoção anterior desse perfil.
  -- A sincronização automática filtra as exclusões antes de chegar aqui.
  delete from public.squad_member_exclusions e
  using jsonb_to_recordset(p_items) as r(creator_id uuid, prospect_id text)
  where e.list_id = p_list_id and e.member_key =
    case when r.creator_id is not null then 'c:' || r.creator_id::text else 'p:' || r.prospect_id end;

  insert into public.list_creators(list_id, creator_id, prospect_id, match_score, status)
  select p_list_id, x.creator_id, x.prospect_id, x.match_score,
    case when x.creator_id is not null then 'concluida' else 'aguardando' end
  from (
    select distinct on (r.creator_id, case when r.creator_id is null then r.prospect_id end)
      r.creator_id, case when r.creator_id is null then r.prospect_id end as prospect_id, r.match_score
    from jsonb_to_recordset(p_items) as r(creator_id uuid, prospect_id text, match_score numeric)
    where r.creator_id is not null or nullif(trim(r.prospect_id), '') is not null
  ) x
  where not exists (
    select 1 from public.list_creators lc where lc.list_id = p_list_id
      and ((x.creator_id is not null and lc.creator_id = x.creator_id)
        or (x.creator_id is null and lc.prospect_id = x.prospect_id))
  );
  get diagnostics added = row_count;
  return added;
end;
$$;
revoke all on function public.add_squad_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_squad_items(uuid, jsonb) to service_role;

-- Uma promoção pode terminar depois de o mesmo creator ter sido incluído por link
-- ou busca. Conserva a associação já existente, inclusive seu baseline de alertas,
-- e retira apenas o prospect redundante. Uma resposta tardia nunca recria removidos.
create or replace function public.update_squad_item(
  p_list_id uuid, p_prospect_id text, p_creator_id uuid, p_status text
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  member public.list_creators%rowtype;
  existing public.list_creators%rowtype;
  changed integer;
begin
  if p_status is null or p_status not in ('aguardando', 'processando', 'concluida', 'erro')
    or (p_prospect_id is not null and (nullif(trim(p_prospect_id), '') is null or length(p_prospect_id) > 200))
    or (p_prospect_id is null and p_creator_id is null) then
    raise exception 'Dados do membro inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_list_id::text, 0));
  perform 1 from public.lists where id = p_list_id for key share;
  if not found then return 0; end if;

  -- Sem promoção, mantém a atualização de status usada pelas chamadas existentes.
  if p_prospect_id is null or p_creator_id is null then
    update public.list_creators set status = p_status
    where list_id = p_list_id and case when p_prospect_id is not null
      then prospect_id = p_prospect_id else creator_id = p_creator_id end;
    get diagnostics changed = row_count;
    return changed;
  end if;

  select lc.* into member from public.list_creators lc
    where lc.list_id = p_list_id and lc.prospect_id = p_prospect_id
    order by lc.created_at, lc.id limit 1 for update;
  if not found then return 0; end if;
  if member.creator_id is not null and member.creator_id <> p_creator_id then
    raise exception 'O prospect já está associado a outro creator';
  end if;
  -- Se a equipe removeu o creator durante a análise deste prospect, a conclusão
  -- automática não desfaz essa decisão; só add_squad_items pode fazê-lo.
  if exists (select 1 from public.squad_member_exclusions e
    where e.list_id = p_list_id and e.member_key = 'c:' || p_creator_id::text) then
    return 0;
  end if;
  -- A associação já promovida só recebe status. Não consolida duplicados
  -- históricos nem remove um membro que já pode ter alertas próprios.
  if member.creator_id = p_creator_id then
    update public.list_creators set status = p_status where id = member.id;
    return 1;
  end if;

  select lc.* into existing from public.list_creators lc
    where lc.list_id = p_list_id and lc.creator_id = p_creator_id and lc.id <> member.id
    order by lc.created_at, lc.id limit 1 for update;
  if found then
    update public.list_creators set
      prospect_id = coalesce(existing.prospect_id, member.prospect_id),
      match_score = coalesce(existing.match_score, member.match_score), status = p_status
    where id = existing.id;
    -- Conserva os campos preenchidos e a identidade do membro existente: alertas
    -- já associados a ele continuam intactos. O status acompanha a conclusão.
    delete from public.list_creators where id = member.id;
  else
    update public.list_creators set creator_id = p_creator_id, status = p_status
    where id = member.id;
  end if;
  return 1;
end;
$$;
revoke all on function public.update_squad_item(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.update_squad_item(uuid, text, uuid, text) to service_role;

-- Remover e registrar a decisão formam uma transação: um reprocessamento do briefing
-- não pode observar o intervalo entre apagar o membro e preservar sua exclusão.
create or replace function public.remove_squad_item(p_list_id uuid, p_item_id uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  member public.list_creators%rowtype;
  removed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_list_id::text, 0));
  perform 1 from public.lists where id = p_list_id for key share;
  if not found then return 0; end if;
  select lc.* into member from public.list_creators lc
    where lc.list_id = p_list_id and lc.id = p_item_id for update;
  if not found then return 0; end if;

  -- Uma linha promovida pode conservar o prospect de origem. Registra as duas
  -- identidades sem vinculá-las a outra conta ou a outro squad.
  if member.creator_id is not null then
    insert into public.squad_member_exclusions(list_id, member_key)
      values (p_list_id, 'c:' || member.creator_id::text)
      on conflict (list_id, member_key) do update set removed_at = excluded.removed_at;
  end if;
  if nullif(trim(member.prospect_id), '') is not null then
    insert into public.squad_member_exclusions(list_id, member_key)
      values (p_list_id, 'p:' || member.prospect_id)
      on conflict (list_id, member_key) do update set removed_at = excluded.removed_at;
  end if;
  delete from public.list_creators where list_id = p_list_id and id = p_item_id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.remove_squad_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_squad_item(uuid, uuid) to service_role;

-- O briefing só acrescenta perfis permitidos pela equipe. Compartilha o lock das
-- ações manuais: nem duplica inclusões nem ressuscita membros durante uma remoção.
create or replace function public.sync_squad_items(p_list_id uuid, p_items jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  allowed_items jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Envie até 500 perfis por vez';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_list_id::text, 0));
  perform 1 from public.lists where id = p_list_id for key share;
  if not found then raise exception 'Squad não encontrado'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'creator_id', r.creator_id, 'prospect_id', r.prospect_id, 'match_score', r.match_score
  )), '[]'::jsonb) into allowed_items
  from jsonb_to_recordset(p_items) as r(creator_id uuid, prospect_id text, match_score numeric)
  where not exists (
    select 1 from public.squad_member_exclusions e
    where e.list_id = p_list_id and e.member_key =
      case when r.creator_id is not null then 'c:' || r.creator_id::text else 'p:' || r.prospect_id end
  );
  return public.add_squad_items(p_list_id, allowed_items);
end;
$$;
revoke all on function public.sync_squad_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_squad_items(uuid, jsonb) to service_role;
