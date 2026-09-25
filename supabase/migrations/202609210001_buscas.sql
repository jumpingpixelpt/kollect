-- Histórico de buscas (feedback rodada 2, bug 2 — set/2026). Até aqui só a CONFIRMAÇÃO
-- de um briefing gravava alguma coisa (campaigns); uma busca que falhava na leitura (ex.:
-- créditos da Anthropic esgotados) ou que ficava por confirmar desaparecia, e o cliente
-- leu isso como "o histórico some a cada atualização". Cada busca passa a ficar gravada
-- no momento em que é lida, com o estado em que parou, e liga-se ao briefing quando é
-- confirmada. "Aberto em" sai do localStorage e vem para aqui, igual em qualquer aparelho.
create table public.buscas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  origem text not null default 'busca' check (origem in ('busca', 'hub')),
  texto text not null,
  campos jsonb,
  parsed jsonb,
  estado text not null default 'lido' check (estado in ('lido', 'confirmado', 'erro')),
  erro_codigo text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  aberto_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index buscas_user_created on public.buscas (user_id, created_at desc);
create index buscas_campaign on public.buscas (campaign_id) where campaign_id is not null;

-- Só o servidor (service role) lê e escreve: a visibilidade por utilizador é feita na app,
-- como em campaigns (soMeus em lib/auth-server.js).
alter table public.buscas enable row level security;
revoke all on public.buscas from public, anon, authenticated;
grant all on public.buscas to service_role;
