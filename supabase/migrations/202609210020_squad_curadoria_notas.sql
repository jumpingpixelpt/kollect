-- Status de curadoria e notas por membro do squad (feedback rodada 2, F2.2 — set/2026).
--
-- A tabela do squad passa a ter «Status» editável (Sugerida → Em estudo → Aprovada /
-- Descartada; proposta da D7, ainda sem resposta do cliente) e «Notas» com autor e data.
-- `list_creators.status` NÃO é reaproveitado: é o estado do pipeline (aguardando /
-- processando / concluida / erro), escrito pelas RPCs add_squad_items / update_squad_item.
--
-- Só acrescenta colunas (com default ou anuláveis): quem hoje lê ou escreve list_creators
-- continua igual. sync_squad_items → add_squad_items insere sem nomear `curadoria`, por isso
-- os membros vindos do briefing nascem 'sugerida' pelo default.
alter table public.list_creators
  add column if not exists curadoria text not null default 'sugerida',
  add column if not exists notas text,
  add column if not exists notas_por uuid,
  add column if not exists notas_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'list_creators_curadoria_check') then
    alter table public.list_creators add constraint list_creators_curadoria_check
      check (curadoria in ('sugerida', 'em_estudo', 'aprovada', 'descartada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'list_creators_notas_tamanho') then
    alter table public.list_creators add constraint list_creators_notas_tamanho
      check (notas is null or length(notas) <= 2000);
  end if;
end $$;

comment on column public.list_creators.curadoria is
  'Decisão da equipa sobre o membro no squad: sugerida | em_estudo | aprovada | descartada (F2.2). Não confundir com status (pipeline).';
comment on column public.list_creators.notas is 'Nota livre da equipa sobre o membro (F2.2); autor em notas_por, data em notas_em.';

-- Backfill: squads criados a partir de um briefing herdam a decisão já tomada no casting
-- (campaign_creators.status), quando é um dos estados de curadoria. Em 21/09 todos os
-- membros ligados estão 'sugerida', por isso não muda nada hoje; fica para bases antigas.
update public.list_creators lc
   set curadoria = cc.status
  from public.lists l, public.campaign_creators cc
 where l.id = lc.list_id
   and l.campaign_id is not null
   and cc.campaign_id = l.campaign_id
   and cc.creator_id = lc.creator_id
   and cc.status in ('em_estudo', 'aprovada', 'descartada')
   and lc.curadoria = 'sugerida';

-- update_squad_item: mesma assinatura e mesmo comportamento. Única diferença: quando a
-- promoção de um prospect encontra o creator já no squad (os dois membros fundem-se no
-- existente), a curadoria e a nota do membro que sai deixam de se perder — o existente fica
-- com as suas, e só herda as do prospect quando não tinha nenhuma.
CREATE OR REPLACE FUNCTION public.update_squad_item(p_list_id uuid, p_prospect_id text, p_creator_id uuid, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      match_score = coalesce(existing.match_score, member.match_score), status = p_status,
      -- F2.2: a decisão e a nota do membro que sai só entram onde o existente não tem.
      curadoria = case when existing.curadoria = 'sugerida' then member.curadoria else existing.curadoria end,
      notas = coalesce(existing.notas, member.notas),
      notas_por = case when existing.notas is null then member.notas_por else existing.notas_por end,
      notas_em = case when existing.notas is null then member.notas_em else existing.notas_em end
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
$function$;
