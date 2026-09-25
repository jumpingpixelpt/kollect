-- Regressão em PostgreSQL local descartável, com as migrations Squad aplicadas.
-- psql -v ON_ERROR_STOP=1 -d BASE_LOCAL -f tests/sql/squad-update.sql
-- Todas as fixtures ficam na transação; nenhum dado real é necessário.
begin;

insert into public.lists(id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Squad fictício de atualização'),
  ('10000000-0000-4000-8000-000000000002', 'Outro squad fictício');
insert into public.creators(id, name, handle, platform, kol_score) values
  ('10000000-0000-4000-8000-000000000010', 'Perfil fictício A', 'fixture_a', 'tiktok', '{"geral":{"elegivel":true,"classe":"rising_star"}}'),
  ('10000000-0000-4000-8000-000000000011', 'Perfil fictício B', 'fixture_b', 'instagram', '{"geral":{"elegivel":true,"classe":"kol"}}'),
  ('10000000-0000-4000-8000-000000000012', 'Perfil fictício C', 'fixture_c', 'tiktok', null);

do $$
declare
  squad uuid := '10000000-0000-4000-8000-000000000001';
  other_squad uuid := '10000000-0000-4000-8000-000000000002';
  creator_a uuid := '10000000-0000-4000-8000-000000000010';
  creator_b uuid := '10000000-0000-4000-8000-000000000011';
  creator_c uuid := '10000000-0000-4000-8000-000000000012';
  member_id uuid;
  existing_id uuid;
  checked_at timestamptz;
  expected_tag text;
  n integer;
begin
  -- Promoção sem colisão conserva a associação original e os campos do prospect.
  perform public.add_squad_items(squad, '[{"prospect_id":"prospect-a","match_score":77}]');
  select id into member_id from public.list_creators where list_id = squad and prospect_id = 'prospect-a';
  n := public.update_squad_item(squad, 'prospect-a', null, 'processando');
  assert n = 1 and (select status = 'processando' from public.list_creators where id = member_id), 'status de prospect';
  n := public.update_squad_item(squad, 'prospect-a', creator_a, 'concluida');
  assert n = 1 and (select creator_id = creator_a and status = 'concluida' and match_score = 77
    and squad_alert_tag = 'rising_star' from public.list_creators where id = member_id), 'promoção normal';
  select squad_alert_checked_at into checked_at from public.list_creators where id = member_id;
  perform public.update_squad_item(squad, 'prospect-a', creator_a, 'concluida');
  assert (select squad_alert_checked_at = checked_at from public.list_creators where id = member_id), 'repetição preserva baseline';
  n := public.update_squad_item(squad, null, creator_a, 'erro');
  assert n = 1 and (select status = 'erro' from public.list_creators where id = member_id), 'status por creator';

  -- Inclusão concorrente concluída antes da promoção: fica um só creator, com o
  -- ID/baseline do membro já existente e o status da conclusão explícita.
  perform public.add_squad_items(squad, jsonb_build_array(jsonb_build_object('creator_id', creator_b, 'match_score', 88)));
  select id, squad_alert_checked_at, squad_alert_tag into existing_id, checked_at, expected_tag
    from public.list_creators where list_id = squad and creator_id = creator_b;
  update public.list_creators set status = 'processando' where id = existing_id;
  perform public.add_squad_items(squad, '[{"prospect_id":"prospect-b","match_score":55}]');
  select id into member_id from public.list_creators where list_id = squad and prospect_id = 'prospect-b';
  n := public.update_squad_item(squad, 'prospect-b', creator_b, 'concluida');
  assert n = 1 and (select count(*) = 1 from public.list_creators where list_id = squad and creator_id = creator_b), 'merge sem duplicação';
  assert not exists (select 1 from public.list_creators where id = member_id), 'prospect redundante retirado';
  assert (select status = 'concluida' and match_score = 88 and prospect_id = 'prospect-b'
    and squad_alert_checked_at = checked_at and squad_alert_tag = expected_tag
    from public.list_creators where id = existing_id), 'merge preserva dados e baseline';
  perform public.update_squad_item(squad, 'prospect-b', creator_b, 'concluida');
  assert (select status = 'concluida' and match_score = 88 and squad_alert_checked_at = checked_at
    from public.list_creators where id = existing_id), 'merge repetido idempotente';

  -- A remoção posterior ao merge conserva ambas as identidades excluídas.
  perform public.remove_squad_item(squad, existing_id);
  assert exists (select 1 from public.squad_member_exclusions where list_id = squad and member_key = 'p:prospect-b'), 'exclusão de prospect';
  assert exists (select 1 from public.squad_member_exclusions where list_id = squad and member_key = 'c:' || creator_b::text), 'exclusão de creator';
  n := public.update_squad_item(squad, 'prospect-b', creator_b, 'concluida');
  assert n = 0 and not exists (select 1 from public.list_creators where list_id = squad and creator_id = creator_b), 'conclusão tardia não recria removido';

  -- Um creator removido enquanto outro prospect é analisado não é reintroduzido.
  perform public.add_squad_items(squad, '[{"prospect_id":"prospect-b-outra-origem"}]');
  n := public.update_squad_item(squad, 'prospect-b-outra-origem', creator_b, 'concluida');
  assert n = 0 and not exists (select 1 from public.list_creators where list_id = squad and creator_id = creator_b), 'respeita exclusão explícita';

  -- Remover o prospect antes da conclusão também impede recriação.
  perform public.add_squad_items(squad, '[{"prospect_id":"prospect-c"}]');
  select id into member_id from public.list_creators where list_id = squad and prospect_id = 'prospect-c';
  perform public.remove_squad_item(squad, member_id);
  n := public.update_squad_item(squad, 'prospect-c', creator_c, 'concluida');
  assert n = 0 and not exists (select 1 from public.list_creators where list_id = squad and creator_id = creator_c), 'prospect removido não reaparece';

  perform public.add_squad_items(other_squad, '[{"prospect_id":"prospect-a"}]');
  perform public.update_squad_item(squad, 'prospect-a', null, 'concluida');
  assert (select status = 'aguardando' from public.list_creators where list_id = other_squad and prospect_id = 'prospect-a'), 'isolamento entre squads';
  assert not has_function_privilege('anon', 'public.update_squad_item(uuid,text,uuid,text)', 'execute'), 'anon sem acesso';
  assert not has_function_privilege('authenticated', 'public.update_squad_item(uuid,text,uuid,text)', 'execute'), 'authenticated sem acesso';
  assert has_function_privilege('service_role', 'public.update_squad_item(uuid,text,uuid,text)', 'execute'), 'service_role autorizado';
  raise notice 'Squad update: promoção, merge, repetição, baseline, remoções, isolamento e permissões OK';
end;
$$;
rollback;
