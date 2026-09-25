-- Executar somente em banco PostgreSQL local vazio, com os papéis anon,
-- authenticated e service_role já criados. Todas as fixtures são fictícias.
-- Exemplo: psql ... -d squad_notifications_test -f tests/squad-notifications.sql
\set ON_ERROR_STOP on
begin;
create schema auth;
create table auth.users(id uuid primary key, email text);
create table public.campaigns(id uuid primary key, user_id uuid references auth.users(id));
create table public.creators(id uuid primary key, name text not null, handle text not null, kol_score jsonb);
create table public.lists(id uuid primary key, name text not null, campaign_id uuid references public.campaigns(id));
create table public.list_creators(id uuid primary key default gen_random_uuid(), list_id uuid not null references public.lists(id) on delete cascade,
  creator_id uuid references public.creators(id) on delete cascade, created_at timestamptz not null default now());
create function public.test_assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%', p_message; end if; end;
$$;

insert into auth.users values ('00000000-0000-4000-8000-000000000001', 'owner@example.test');
insert into campaigns values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001');
insert into lists values
  ('00000000-0000-4000-8000-000000000003', 'Squad fictício', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000004', 'Squad sem dono conhecido', null);
insert into creators values
  ('00000000-0000-4000-8000-000000000010', 'Pool', 'pool', '{"geral":{"elegivel":true,"classe":"promissora"}}'),
  ('00000000-0000-4000-8000-000000000011', 'Rising', 'rising', '{"geral":{"elegivel":true,"classe":"rising_star"}}'),
  ('00000000-0000-4000-8000-000000000012', 'Sem análise', 'novo', null),
  ('00000000-0000-4000-8000-000000000013', 'KOL', 'kol', '{"geral":{"elegivel":true,"classe":"kol"}}');
insert into list_creators(list_id, creator_id)
select '00000000-0000-4000-8000-000000000003', id from creators;
insert into list_creators(list_id, creator_id) values
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000010');

\ir ../supabase/migrations/202609170001_squad_notifications.sql

select test_assert((select user_id from lists where id='00000000-0000-4000-8000-000000000003')='00000000-0000-4000-8000-000000000001', 'Dono deve vir da campanha');
select test_assert((select user_id from lists where id='00000000-0000-4000-8000-000000000004') is null, 'Squad antigo avulso não pode ganhar dono inferido');
select test_assert(squad_collect_alerts()=0, 'Baseline Rising Star não deve gerar alerta');
select test_assert(squad_creator_tag('{"geral":{"elegivel":false,"classe":"rising_star"}}')='pool', 'Inelegível não é Rising Star');

-- Ausência temporária de score não gera falsa promoção nem transforma queda de KOL em promoção.
update creators set kol_score=null where handle in ('rising', 'kol');
select test_assert(squad_collect_alerts()=0, 'Ausência de score não deve gerar alertas');
select test_assert((select squad_alert_tag from list_creators where creator_id='00000000-0000-4000-8000-000000000013')='kol', 'Baseline KOL deve sobreviver ao score ausente');
update creators set kol_score='{"geral":{"elegivel":true,"classe":"rising_star"}}';
select test_assert(squad_collect_alerts()=2, 'Só Pool e primeira análise devem alertar');
select test_assert((select count(*) from squad_alerts)=2, 'Somente dois alertas esperados');
select test_assert((select bool_and(user_id='00000000-0000-4000-8000-000000000001' and recipient_email='owner@example.test' and list_id='00000000-0000-4000-8000-000000000003') from squad_alerts), 'Destinatário deve ser o criador de cada squad');
select test_assert(squad_collect_alerts()=0, 'Coleta repetida não deve duplicar alertas');

-- Nova associação já Rising Star recebe baseline atual e não uma notificação histórica.
insert into lists(id, name, user_id) values ('00000000-0000-4000-8000-000000000005', 'Squad novo', '00000000-0000-4000-8000-000000000001');
insert into list_creators(list_id, creator_id) values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000010');
select test_assert(squad_collect_alerts()=0, 'Inclusão Rising Star não deve alertar');

-- Tokens impedem confirmação por worker antigo; claims ativos não podem ser duplicados.
create temporary table claimed as select * from squad_claim_alert(20);
select test_assert((select count(*) from claimed)=2, 'Deve reservar dois alertas');
select test_assert((select count(*) from squad_claim_alert(20))=0, 'Claim ativo não deve ser reservado novamente');
select test_assert(not squad_finish_alert(id, gen_random_uuid(), 'sent', null, 'fake-provider'), 'Token incorreto não deve concluir') from claimed;
update squad_alerts set request_body='{"to":["owner@example.test"],"text":"Corpo imutável"}', claimed_at=now()-interval '11 minutes';
create temporary table reclaimed as select * from squad_claim_alert(20);
select test_assert((select count(*) from reclaimed)=2, 'Claim expirado deve ser retomado');
select test_assert((select bool_and(r.claim_token<>c.claim_token and r.attempts=2 and r.first_attempt_at=c.first_attempt_at and r.request_body->>'text'='Corpo imutável') from reclaimed r join claimed c using(id)), 'Retry deve renovar token e preservar corpo/janela');
select test_assert(not squad_finish_alert(id, claim_token, 'sent', null, 'old-provider'), 'Worker antigo não deve confirmar nova reserva') from claimed;

-- Depois de 23 h nenhum resultado incerto é reenviado automaticamente.
update squad_alerts set first_attempt_at=now()-interval '24 hours' where creator_id='00000000-0000-4000-8000-000000000010';
select test_assert((select count(*) from squad_claim_alert(20))=0, 'Janela encerrada não deve reenviar');
select test_assert((select status from squad_alerts where creator_id='00000000-0000-4000-8000-000000000010')='needs_review', 'Resultado antigo deve exigir reconciliação');
select test_assert(squad_finish_alert(id, claim_token, 'pending', 'Falha transitória'), 'Falha transitória deve voltar à fila') from reclaimed where creator_id='00000000-0000-4000-8000-000000000012';
select test_assert((select count(*) from squad_claim_alert(20))=0, 'Backoff deve impedir nova tentativa imediata');
update squad_alerts set available_at=now()-interval '1 minute' where status='pending';
select test_assert(squad_finish_alert(id, claim_token, 'sent', null, 'fake-provider'), 'Aceite deve concluir entrega') from squad_claim_alert(1);
select test_assert((select count(*) from squad_alerts where status='sent' and provider_id='fake-provider' and sent_at is not null)=1, 'Entrega deve persistir confirmação do provedor');

-- Reclassificações posteriores não repetem o evento para o mesmo creator/squad.
update creators set kol_score='{"geral":{"elegivel":false,"classe":"rising_star"}}' where handle='novo';
select test_assert(squad_collect_alerts()=0, 'Descida não alerta');
update creators set kol_score='{"geral":{"elegivel":true,"classe":"rising_star"}}' where handle='novo';
select test_assert(squad_collect_alerts()=0, 'Nova subida não duplica alerta já criado');

delete from list_creators where creator_id='00000000-0000-4000-8000-000000000010';
select test_assert((select count(*) from squad_alerts)=1, 'Remoção do membro deve cancelar seu alerta');
delete from lists where id='00000000-0000-4000-8000-000000000003';
select test_assert((select count(*) from squad_alerts)=0, 'Remoção da squad deve cancelar seus alertas');

select test_assert(not has_table_privilege('anon', 'squad_alerts', 'SELECT'), 'Fila privada para anon');
select test_assert(not has_table_privilege('authenticated', 'squad_alerts', 'SELECT'), 'Fila privada para authenticated');
select test_assert(has_table_privilege('service_role', 'squad_alerts', 'UPDATE'), 'Worker deve poder atualizar fila');
select test_assert(not has_function_privilege('authenticated', 'squad_collect_alerts()', 'EXECUTE'), 'Coleta privada');
select test_assert(not has_function_privilege('anon', 'squad_claim_alert(integer)', 'EXECUTE'), 'Claims privados');
select test_assert(not has_function_privilege('authenticated', 'squad_finish_alert(uuid,uuid,text,text,text)', 'EXECUTE'), 'Confirmação privada');
select test_assert((select relrowsecurity from pg_class where oid='public.squad_alerts'::regclass), 'RLS deve estar ativo');
rollback;
