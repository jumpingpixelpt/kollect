-- Uma avaliação externa pode custar créditos. Um lease por rede/@ protege pedidos
-- simultâneos, inclusive de squads diferentes; não depende da instância da Vercel.
create table public.squad_profile_imports (
  platform text not null check (platform in ('instagram', 'tiktok')),
  handle text not null,
  claim_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '6 minutes',
  primary key (platform, handle)
);
alter table public.squad_profile_imports enable row level security;
revoke all on public.squad_profile_imports from public, anon, authenticated;
grant all on public.squad_profile_imports to service_role;

create or replace function public.claim_squad_profile_import(p_platform text, p_handle text)
returns uuid language sql security invoker set search_path = public as $$
  insert into public.squad_profile_imports(platform, handle) values (p_platform, lower(p_handle))
  on conflict (platform, handle) do update set claim_token = gen_random_uuid(), expires_at = now() + interval '6 minutes'
    where squad_profile_imports.expires_at < now()
  returning claim_token;
$$;
create or replace function public.release_squad_profile_import(p_platform text, p_handle text, p_claim_token uuid)
returns void language sql security invoker set search_path = public as $$
  delete from public.squad_profile_imports where platform = p_platform and handle = lower(p_handle) and claim_token = p_claim_token;
$$;
revoke all on function public.claim_squad_profile_import(text,text) from public, anon, authenticated;
revoke all on function public.release_squad_profile_import(text,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_squad_profile_import(text,text) to service_role;
grant execute on function public.release_squad_profile_import(text,text,uuid) to service_role;
