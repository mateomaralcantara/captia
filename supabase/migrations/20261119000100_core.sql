-- CAPTIA OS · Entrega 1 · Núcleo: organizaciones, RBAC, auditoría, catálogo de servicios.
--
-- Reglas:
--   * Todas las tablas viven en el esquema `core`, que NO se expone por la Data API de Supabase.
--     El único camino de lectura/escritura para usuarios es la API de CAPTIA, que ejecuta cada
--     petición con `set local role authenticated` y los claims del JWT, de modo que RLS aplica.
--   * Los usuarios no tienen políticas de INSERT/UPDATE/DELETE: toda mutación pasa por funciones
--     `security definer` que comprueban permisos, MFA y escriben auditoría en la misma transacción.
--   * Errores de negocio con SQLSTATE propios (la API los traduce a HTTP):
--       CA401 mfa_required · CA403 forbidden · CA404 not_found · CA409 conflict · CA422 invalid
--   * `search_path = ''` en todas las funciones: todo va calificado.

create schema if not exists core;
revoke all on schema core from public;
grant usage on schema core to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catálogo de permisos y roles
-- ---------------------------------------------------------------------------

create table core.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  scope text not null check (scope in ('platform', 'organization')),
  description text not null,
  unique (key, scope)
);

create table core.platform_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+$'),
  name text not null,
  description text not null default ''
);

-- Un rol de plataforma puede tener permisos de organización: los ejerce sobre TODAS las organizaciones.
create table core.platform_role_permissions (
  role_id uuid not null references core.platform_roles (id) on delete cascade,
  permission_key text not null references core.permissions (key) on update cascade,
  primary key (role_id, permission_key)
);

create table core.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- organization_id NULL = rol de sistema (plantilla compartida por todas las organizaciones).
create table core.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references core.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z_]+$'),
  name text not null,
  description text not null default '',
  is_system boolean generated always as (organization_id is null) stored,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, key)
);

create table core.role_permissions (
  role_id uuid not null references core.organization_roles (id) on delete cascade,
  permission_key text not null,
  permission_scope text not null default 'organization' check (permission_scope = 'organization'),
  primary key (role_id, permission_key),
  foreign key (permission_key, permission_scope) references core.permissions (key, scope) on update cascade
);

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------

-- Perfil de aplicación de cada usuario de Supabase Auth (se crea por trigger).
create table core.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_key on core.profiles (lower(email));

create table core.platform_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles (id) on delete cascade,
  role_id uuid not null references core.platform_roles (id) on delete restrict,
  granted_by uuid references core.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create table core.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  user_id uuid not null references core.profiles (id) on delete cascade,
  role_id uuid not null references core.organization_roles (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid references core.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on core.organization_members (user_id);
create index organization_members_role_idx on core.organization_members (role_id);

-- ---------------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------------

create table core.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references core.organizations (id) on delete set null,
  actor_user_id uuid,
  actor_email text,            -- instantánea en el momento de la acción (el perfil puede cambiar o no ser visible)
  actor_type text not null check (actor_type in ('user', 'system', 'api_key', 'agent')),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_org_created_idx on core.audit_events (organization_id, created_at desc);
create index audit_events_created_idx on core.audit_events (created_at desc);
create index audit_events_actor_idx on core.audit_events (actor_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Catálogo de servicios, flags e idempotencia
-- ---------------------------------------------------------------------------

-- Estado declarado de cada servicio. Lo que el panel muestra como disponible sale de aquí.
create table core.service_catalog (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+(\.[a-z_]+)*$'),
  product text not null check (product in ('control', 'phone', 'voice', 'mail', 'id', 'ai')),
  name text not null,
  status text not null check (status in (
    'implemented',             -- implementado y probado
    'pending_infrastructure',  -- implementado, falta infraestructura
    'pending_authorization',   -- integración pendiente de autorización (legal/proveedor)
    'experimental',
    'unavailable'              -- no disponible
  )),
  status_reason text not null default '',
  delivery text,               -- entrega del roadmap que lo implementa
  updated_at timestamptz not null default now()
);

create table core.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+$'),
  enabled boolean not null,
  description text not null,
  updated_by uuid references core.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table core.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles (id) on delete cascade,
  scope text not null,
  key text not null check (char_length(key) between 8 and 200),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, scope, key)
);
create index idempotency_keys_created_idx on core.idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- Triggers genéricos
-- ---------------------------------------------------------------------------

create function core.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on core.organizations
  for each row execute function core.touch_updated_at();
create trigger organization_members_touch before update on core.organization_members
  for each row execute function core.touch_updated_at();
create trigger profiles_touch before update on core.profiles
  for each row execute function core.touch_updated_at();

create function core.audit_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events es de solo inserción' using errcode = 'CA403';
end;
$$;

create trigger audit_events_no_update before update or delete on core.audit_events
  for each row execute function core.audit_events_immutable();
create trigger audit_events_no_truncate before truncate on core.audit_events
  for each statement execute function core.audit_events_immutable();

-- Un miembro solo puede tener un rol de sistema o un rol de SU organización.
create function core.check_member_role() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_role_org uuid;
begin
  select r.organization_id into v_role_org from core.organization_roles r where r.id = new.role_id;
  if v_role_org is not null and v_role_org <> new.organization_id then
    raise exception 'role_from_other_organization' using errcode = 'CA422';
  end if;
  return new;
end;
$$;

create trigger organization_members_role_check before insert or update of role_id, organization_id
  on core.organization_members for each row execute function core.check_member_role();

-- Perfil automático para cada usuario de Supabase Auth.
create function core.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@users.invalid'),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger captia_on_auth_user after insert or update of email on auth.users
  for each row execute function core.handle_auth_user();

insert into core.profiles (id, email)
select u.id, coalesce(u.email, u.id::text || '@users.invalid') from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Contexto de la petición
-- ---------------------------------------------------------------------------

create function core.current_user_id() returns uuid
language sql stable set search_path = '' as $$
  select auth.uid()
$$;

-- Nivel de autenticación del JWT de Supabase: 'aal1' (contraseña) o 'aal2' (MFA verificado).
create function core.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

create function core.flag_enabled(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select f.enabled from core.feature_flags f where f.key = p_key), false)
$$;

create function core.has_platform_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from core.platform_role_assignments a
    join core.platform_role_permissions p on p.role_id = a.role_id
    where a.user_id = auth.uid() and p.permission_key = p_permission
  )
$$;

-- Permiso efectivo sobre una organización: por rol de plataforma (todas las organizaciones) o por
-- membresía activa en una organización activa.
create function core.has_org_permission(p_organization_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select core.has_platform_permission(p_permission)
    or exists (
      select 1
      from core.organization_members m
      join core.organizations o on o.id = m.organization_id
      join core.role_permissions rp on rp.role_id = m.role_id
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and o.status = 'active'
        and rp.permission_key = p_permission
    )
$$;

create function core.assert_authenticated() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'CA403';
  end if;
  return v_user;
end;
$$;

-- Las acciones administrativas exigen MFA (aal2) mientras el flag esté activo.
create function core.assert_admin_mfa() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if core.flag_enabled('mfa_required_for_admins') and core.current_aal() <> 'aal2' then
    raise exception 'mfa_required' using errcode = 'CA401';
  end if;
end;
$$;

create function core.assert_org_permission(p_organization_id uuid, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.assert_authenticated();
  if not exists (select 1 from core.organizations o where o.id = p_organization_id) then
    raise exception 'organization_not_found' using errcode = 'CA404';
  end if;
  if not core.has_org_permission(p_organization_id, p_permission) then
    -- No revelar existencia a quien ni siquiera puede leer la organización.
    if core.has_org_permission(p_organization_id, 'organization.read') then
      raise exception 'forbidden' using errcode = 'CA403';
    end if;
    raise exception 'organization_not_found' using errcode = 'CA404';
  end if;
end;
$$;

create function core.write_audit(
  p_organization_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_type text default 'user'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into core.audit_events (organization_id, actor_user_id, actor_email, actor_type, action, target_type, target_id, metadata)
  values (p_organization_id, auth.uid(), (select p.email from core.profiles p where p.id = auth.uid()),
          p_actor_type, p_action, p_target_type, p_target_id,
          coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('aal', core.current_aal()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ¿Puede el actor conceder este rol? Solo si posee todos sus permisos (evita escalada de privilegios).
create function core.can_grant_role(p_organization_id uuid, p_role_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from core.role_permissions rp
    where rp.role_id = p_role_id
      and not core.has_org_permission(p_organization_id, rp.permission_key)
  )
$$;

create function core.resolve_role(p_organization_id uuid, p_role_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  select r.id into v_role from core.organization_roles r
  where r.key = p_role_key and (r.organization_id = p_organization_id or r.organization_id is null)
  order by r.organization_id nulls last
  limit 1;
  if v_role is null then
    raise exception 'role_not_found' using errcode = 'CA404';
  end if;
  return v_role;
end;
$$;

-- Número de administradores activos (miembros con members.manage) de la organización.
create function core.active_admin_count(p_organization_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from core.organization_members m
  join core.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'members.manage'
  where m.organization_id = p_organization_id and m.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- Operaciones (únicas vías de escritura para usuarios)
-- ---------------------------------------------------------------------------

create function core.create_organization(
  p_name text,
  p_slug text,
  p_add_creator boolean default true,
  p_idempotency_key text default null
) returns core.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := core.assert_authenticated();
  v_org core.organizations;
  v_existing uuid;
begin
  if not core.has_platform_permission('platform.organizations.create')
     and not core.flag_enabled('self_service_organizations') then
    raise exception 'forbidden' using errcode = 'CA403';
  end if;
  perform core.assert_admin_mfa();

  if p_idempotency_key is not null then
    select k.resource_id into v_existing from core.idempotency_keys k
    where k.user_id = v_user and k.scope = 'organization.create' and k.key = p_idempotency_key;
    if v_existing is not null then
      select * into v_org from core.organizations o where o.id = v_existing;
      return v_org;
    end if;
  end if;

  begin
    insert into core.organizations (name, slug, created_by)
    values (btrim(p_name), lower(btrim(p_slug)), v_user)
    returning * into v_org;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = 'CA409';
    when check_violation then
      raise exception 'invalid_organization' using errcode = 'CA422';
  end;

  if p_add_creator then
    insert into core.organization_members (organization_id, user_id, role_id, invited_by)
    values (v_org.id, v_user, core.resolve_role(v_org.id, 'org_admin'), v_user);
  end if;

  if p_idempotency_key is not null then
    insert into core.idempotency_keys (user_id, scope, key, resource_id)
    values (v_user, 'organization.create', p_idempotency_key, v_org.id);
  end if;

  perform core.write_audit(v_org.id, 'organization.created', 'organization', v_org.id,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'creator_is_member', p_add_creator));
  return v_org;
end;
$$;

create function core.update_organization(
  p_organization_id uuid,
  p_name text default null,
  p_status text default null
) returns core.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_before core.organizations;
  v_after core.organizations;
begin
  perform core.assert_authenticated();
  select * into v_before from core.organizations o where o.id = p_organization_id for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'CA404';
  end if;

  perform core.assert_org_permission(p_organization_id, 'organization.update');
  if p_status is not null and p_status <> v_before.status
     and not core.has_platform_permission('platform.organizations.suspend') then
    raise exception 'forbidden' using errcode = 'CA403';
  end if;
  if p_name is null and (p_status is null or p_status = v_before.status) then
    return v_before;
  end if;
  perform core.assert_admin_mfa();

  begin
    update core.organizations o
    set name = coalesce(btrim(p_name), o.name),
        status = coalesce(p_status, o.status)
    where o.id = p_organization_id
    returning * into v_after;
  exception when check_violation then
    raise exception 'invalid_organization' using errcode = 'CA422';
  end;

  perform core.write_audit(p_organization_id,
    case when v_after.status <> v_before.status
      then case v_after.status when 'suspended' then 'organization.suspended' else 'organization.reactivated' end
      else 'organization.updated' end,
    'organization', p_organization_id,
    jsonb_build_object('before', jsonb_build_object('name', v_before.name, 'status', v_before.status),
                       'after', jsonb_build_object('name', v_after.name, 'status', v_after.status)));
  return v_after;
end;
$$;

create function core.add_organization_member(
  p_organization_id uuid,
  p_email text,
  p_role_key text
) returns core.organization_members
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := core.assert_authenticated();
  v_target uuid;
  v_role uuid;
  v_member core.organization_members;
begin
  perform core.assert_org_permission(p_organization_id, 'members.manage');
  perform core.assert_admin_mfa();

  select p.id into v_target from core.profiles p where lower(p.email) = lower(btrim(p_email));
  if v_target is null then
    raise exception 'user_not_found' using errcode = 'CA404';
  end if;

  v_role := core.resolve_role(p_organization_id, p_role_key);
  if not core.can_grant_role(p_organization_id, v_role) then
    raise exception 'cannot_grant_role' using errcode = 'CA403';
  end if;

  begin
    insert into core.organization_members (organization_id, user_id, role_id, invited_by)
    values (p_organization_id, v_target, v_role, v_user)
    returning * into v_member;
  exception when unique_violation then
    raise exception 'already_member' using errcode = 'CA409';
  end;

  perform core.write_audit(p_organization_id, 'member.added', 'organization_member', v_member.id,
    jsonb_build_object('user_id', v_target, 'role', p_role_key));
  return v_member;
end;
$$;

create function core.update_organization_member(
  p_member_id uuid,
  p_role_key text default null,
  p_status text default null
) returns core.organization_members
language plpgsql security definer set search_path = '' as $$
declare
  v_before core.organization_members;
  v_after core.organization_members;
  v_role uuid;
begin
  perform core.assert_authenticated();
  select * into v_before from core.organization_members m where m.id = p_member_id for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'CA404';
  end if;
  perform core.assert_org_permission(v_before.organization_id, 'members.manage');
  perform core.assert_admin_mfa();

  -- Serializa cambios de administradores de la misma organización (guardia del último admin).
  perform 1 from core.organizations o where o.id = v_before.organization_id for update;

  v_role := case when p_role_key is null then v_before.role_id
                 else core.resolve_role(v_before.organization_id, p_role_key) end;
  if not core.can_grant_role(v_before.organization_id, v_before.role_id)
     or not core.can_grant_role(v_before.organization_id, v_role) then
    raise exception 'cannot_grant_role' using errcode = 'CA403';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = 'CA422';
  end if;

  update core.organization_members m
  set role_id = v_role, status = coalesce(p_status, m.status)
  where m.id = p_member_id
  returning * into v_after;

  if core.active_admin_count(v_after.organization_id) = 0 then
    raise exception 'last_admin' using errcode = 'CA409';
  end if;

  perform core.write_audit(v_after.organization_id, 'member.updated', 'organization_member', v_after.id,
    jsonb_build_object('user_id', v_after.user_id,
      'before', jsonb_build_object('role_id', v_before.role_id, 'status', v_before.status),
      'after', jsonb_build_object('role_id', v_after.role_id, 'status', v_after.status)));
  return v_after;
end;
$$;

create function core.remove_organization_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_member core.organization_members;
begin
  perform core.assert_authenticated();
  select * into v_member from core.organization_members m where m.id = p_member_id for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'CA404';
  end if;
  perform core.assert_org_permission(v_member.organization_id, 'members.manage');
  perform core.assert_admin_mfa();
  perform 1 from core.organizations o where o.id = v_member.organization_id for update;

  if not core.can_grant_role(v_member.organization_id, v_member.role_id) then
    raise exception 'cannot_grant_role' using errcode = 'CA403';
  end if;

  delete from core.organization_members m where m.id = p_member_id;
  if core.active_admin_count(v_member.organization_id) = 0 then
    raise exception 'last_admin' using errcode = 'CA409';
  end if;

  perform core.write_audit(v_member.organization_id, 'member.removed', 'organization_member', v_member.id,
    jsonb_build_object('user_id', v_member.user_id, 'role_id', v_member.role_id));
end;
$$;

-- Resumen con datos reales. Sin organización: vista de plataforma (requiere permiso de plataforma).
create function core.dashboard_summary(p_organization_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform core.assert_authenticated();
  if p_organization_id is null then
    if not core.has_platform_permission('platform.dashboard.read') then
      raise exception 'forbidden' using errcode = 'CA403';
    end if;
    select jsonb_build_object(
      'scope', 'platform',
      'organizations_total', (select count(*) from core.organizations),
      'organizations_active', (select count(*) from core.organizations where status = 'active'),
      'organizations_suspended', (select count(*) from core.organizations where status = 'suspended'),
      'users_total', (select count(*) from core.profiles),
      'platform_admins', (select count(distinct user_id) from core.platform_role_assignments),
      'memberships_active', (select count(*) from core.organization_members where status = 'active'),
      'audit_events_24h', (select count(*) from core.audit_events where created_at > now() - interval '24 hours')
    ) into v_result;
  else
    perform core.assert_org_permission(p_organization_id, 'dashboard.read');
    select jsonb_build_object(
      'scope', 'organization',
      'organization_id', p_organization_id,
      'members_total', (select count(*) from core.organization_members where organization_id = p_organization_id),
      'members_active', (select count(*) from core.organization_members
                           where organization_id = p_organization_id and status = 'active'),
      'custom_roles', (select count(*) from core.organization_roles where organization_id = p_organization_id),
      'audit_events_24h', (select count(*) from core.audit_events
                             where organization_id = p_organization_id and created_at > now() - interval '24 hours')
    ) into v_result;
  end if;
  return v_result;
end;
$$;

-- Contexto del usuario actual: perfil, roles de plataforma y membresías (incluidas las de
-- organizaciones suspendidas, para poder explicarle por qué no tiene acceso).
create function core.my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'email', p.email,
    'display_name', p.display_name,
    'mfa_required_for_admins', core.flag_enabled('mfa_required_for_admins'),
    'platform_roles', coalesce((
      select jsonb_agg(r.key order by r.key)
      from core.platform_role_assignments a join core.platform_roles r on r.id = a.role_id
      where a.user_id = p.id), '[]'::jsonb),
    'platform_permissions', coalesce((
      select jsonb_agg(distinct rp.permission_key order by rp.permission_key)
      from core.platform_role_assignments a join core.platform_role_permissions rp on rp.role_id = a.role_id
      where a.user_id = p.id), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', o.id, 'organization_name', o.name, 'organization_slug', o.slug,
        'organization_status', o.status, 'role_key', r.key, 'role_name', r.name, 'status', m.status,
        'permissions', coalesce((select jsonb_agg(x.permission_key order by x.permission_key)
                                 from core.role_permissions x where x.role_id = m.role_id), '[]'::jsonb)
      ) order by o.name)
      from core.organization_members m
      join core.organizations o on o.id = m.organization_id
      join core.organization_roles r on r.id = m.role_id
      where m.user_id = p.id), '[]'::jsonb)
  )
  from core.profiles p
  where p.id = auth.uid()
$$;

-- Alta del primer superadministrador. Solo para operadores con acceso directo a la base de datos
-- (service_role / postgres), nunca para usuarios de la API.
create function core.bootstrap_superadmin(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_role uuid;
begin
  select p.id into v_user from core.profiles p where lower(p.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'user_not_found: crea primero el usuario en Supabase Auth' using errcode = 'CA404';
  end if;
  select r.id into v_role from core.platform_roles r where r.key = 'superadmin';
  insert into core.platform_role_assignments (user_id, role_id) values (v_user, v_role)
  on conflict (user_id, role_id) do nothing;
  perform core.write_audit(null, 'platform.superadmin_bootstrapped', 'user', v_user, '{}'::jsonb, 'system');
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (lecturas)
-- ---------------------------------------------------------------------------

alter table core.permissions enable row level security;
alter table core.platform_roles enable row level security;
alter table core.platform_role_permissions enable row level security;
alter table core.organizations enable row level security;
alter table core.organization_roles enable row level security;
alter table core.role_permissions enable row level security;
alter table core.profiles enable row level security;
alter table core.platform_role_assignments enable row level security;
alter table core.organization_members enable row level security;
alter table core.audit_events enable row level security;
alter table core.service_catalog enable row level security;
alter table core.feature_flags enable row level security;
alter table core.idempotency_keys enable row level security;

create policy permissions_read on core.permissions for select to authenticated using (true);
create policy platform_roles_read on core.platform_roles for select to authenticated using (true);
create policy platform_role_permissions_read on core.platform_role_permissions for select to authenticated using (true);
create policy service_catalog_read on core.service_catalog for select to authenticated using (true);
create policy feature_flags_read on core.feature_flags for select to authenticated using (true);

create policy organizations_read on core.organizations for select to authenticated
  using (core.has_org_permission(id, 'organization.read'));

create policy organization_roles_read on core.organization_roles for select to authenticated
  using (organization_id is null or core.has_org_permission(organization_id, 'roles.read'));

create policy role_permissions_read on core.role_permissions for select to authenticated
  using (exists (
    select 1 from core.organization_roles r
    where r.id = role_id and (r.organization_id is null or core.has_org_permission(r.organization_id, 'roles.read'))
  ));

create policy organization_members_read on core.organization_members for select to authenticated
  using (user_id = auth.uid() or core.has_org_permission(organization_id, 'members.read'));

create policy profiles_read on core.profiles for select to authenticated
  using (
    id = auth.uid()
    or core.has_platform_permission('platform.users.read')
    or exists (
      select 1 from core.organization_members m
      where m.user_id = profiles.id and core.has_org_permission(m.organization_id, 'members.read')
    )
  );

create policy platform_role_assignments_read on core.platform_role_assignments for select to authenticated
  using (user_id = auth.uid() or core.has_platform_permission('platform.users.read'));

create policy audit_events_read on core.audit_events for select to authenticated
  using (
    core.has_platform_permission('platform.audit.read')
    or (organization_id is not null and core.has_org_permission(organization_id, 'audit.read'))
  );
-- idempotency_keys: sin política => invisible para usuarios.

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke all on all tables in schema core from public, anon, authenticated;
revoke all on all functions in schema core from public, anon, authenticated;

grant select on
  core.permissions, core.platform_roles, core.platform_role_permissions, core.organizations,
  core.organization_roles, core.role_permissions, core.profiles, core.platform_role_assignments,
  core.organization_members, core.audit_events, core.service_catalog, core.feature_flags
to authenticated;

-- Funciones usadas por las políticas RLS y operaciones permitidas a usuarios (cada una valida permisos).
grant execute on function
  core.current_user_id(), core.current_aal(), core.has_platform_permission(text),
  core.has_org_permission(uuid, text),
  core.create_organization(text, text, boolean, text),
  core.update_organization(uuid, text, text),
  core.add_organization_member(uuid, text, text),
  core.update_organization_member(uuid, text, text),
  core.remove_organization_member(uuid),
  core.dashboard_summary(uuid),
  core.my_context()
to authenticated;

grant all on all tables in schema core to service_role;
grant execute on all functions in schema core to service_role;
revoke execute on function core.bootstrap_superadmin(text) from authenticated;

-- ---------------------------------------------------------------------------
-- Datos de referencia (no son datos de ejemplo: son el catálogo del sistema)
-- ---------------------------------------------------------------------------

insert into core.permissions (key, scope, description) values
  ('platform.organizations.create', 'platform', 'Crear organizaciones'),
  ('platform.organizations.suspend', 'platform', 'Suspender y reactivar organizaciones'),
  ('platform.users.read', 'platform', 'Consultar todos los usuarios de la plataforma'),
  ('platform.audit.read', 'platform', 'Consultar la auditoría de toda la plataforma'),
  ('platform.dashboard.read', 'platform', 'Consultar el resumen global de la plataforma'),
  ('organization.read', 'organization', 'Consultar la organización'),
  ('organization.update', 'organization', 'Editar los datos de la organización'),
  ('members.read', 'organization', 'Consultar miembros'),
  ('members.manage', 'organization', 'Añadir, cambiar de rol, suspender y quitar miembros'),
  ('roles.read', 'organization', 'Consultar roles y permisos'),
  ('audit.read', 'organization', 'Consultar la auditoría de la organización'),
  ('dashboard.read', 'organization', 'Consultar el resumen de la organización');

insert into core.platform_roles (key, name, description) values
  ('superadmin', 'Superadministrador', 'Control total de la plataforma'),
  ('platform_admin', 'Administrador de plataforma', 'Opera organizaciones y usuarios de todos los clientes'),
  ('platform_auditor', 'Auditor de plataforma', 'Solo lectura global, incluida la auditoría');

insert into core.platform_role_permissions (role_id, permission_key)
select r.id, p.key from core.platform_roles r cross join core.permissions p
where r.key in ('superadmin', 'platform_admin');

insert into core.platform_role_permissions (role_id, permission_key)
select r.id, p.key from core.platform_roles r join core.permissions p on p.key in (
  'platform.users.read', 'platform.audit.read', 'platform.dashboard.read',
  'organization.read', 'members.read', 'roles.read', 'audit.read', 'dashboard.read')
where r.key = 'platform_auditor';

insert into core.organization_roles (organization_id, key, name, description) values
  (null, 'org_admin', 'Administrador de organización', 'Gestiona usuarios y recursos de su organización'),
  (null, 'supervisor', 'Supervisor', 'Consulta todo y opera recursos; no gestiona usuarios'),
  (null, 'operator', 'Operador', 'Usa los recursos que se le asignan'),
  (null, 'user', 'Usuario', 'Acceso a sus propios recursos'),
  (null, 'auditor', 'Auditor', 'Solo lectura, incluida la auditoría');

insert into core.role_permissions (role_id, permission_key)
select r.id, p.key from core.organization_roles r join core.permissions p on p.scope = 'organization'
where r.key = 'org_admin' and r.organization_id is null;

insert into core.role_permissions (role_id, permission_key)
select r.id, x.key from core.organization_roles r
join (values
  ('supervisor', 'organization.read'), ('supervisor', 'members.read'), ('supervisor', 'roles.read'),
  ('supervisor', 'dashboard.read'),
  ('operator', 'organization.read'), ('operator', 'dashboard.read'),
  ('user', 'organization.read'),
  ('auditor', 'organization.read'), ('auditor', 'members.read'), ('auditor', 'roles.read'),
  ('auditor', 'audit.read'), ('auditor', 'dashboard.read')
) as x(role_key, key) on x.role_key = r.key
where r.organization_id is null;

insert into core.feature_flags (key, enabled, description) values
  ('mfa_required_for_admins', true, 'Las acciones administrativas exigen sesión con MFA (aal2)'),
  ('self_service_organizations', false, 'Cualquier usuario autenticado puede crear su propia organización');

insert into core.service_catalog (key, product, name, status, status_reason, delivery) values
  ('control.core', 'control', 'Organizaciones, usuarios, roles y auditoría', 'implemented',
   'Implementado y cubierto por pruebas automáticas', 'Entrega 1'),
  ('phone.virtual', 'phone', 'Android virtual', 'unavailable',
   'Requiere un nodo Linux con KVM; se implementa en la Entrega 2', 'Entrega 2'),
  ('phone.physical', 'phone', 'Android físico remoto', 'unavailable',
   'Requiere un nodo con dispositivos USB; se implementa en la Entrega 6', 'Entrega 6'),
  ('voice.internal', 'voice', 'Telefonía IP interna (extensiones)', 'unavailable',
   'Requiere servidor Asterisk; se implementa en la Entrega 3', 'Entrega 3'),
  ('voice.public', 'voice', 'Numeración pública y SIP trunks', 'pending_authorization',
   'Requiere operador autorizado y revisión regulatoria (INDOTEL)', 'Entrega 9'),
  ('mail.mailboxes', 'mail', 'Correo propio', 'unavailable',
   'Requiere servidor de correo y un dominio verificado bajo control del propietario', 'Entrega 4'),
  ('id.identities', 'id', 'Identidades y vínculos', 'unavailable',
   'Depende de dispositivos, correo y extensiones; Entrega 5', 'Entrega 5'),
  ('control.infrastructure', 'control', 'Nodos e infraestructura', 'unavailable',
   'El registro de nodos y su monitorización se implementan en la Entrega 2', 'Entrega 2'),
  ('control.network', 'control', 'Network Fabric (redes por dispositivo)', 'unavailable',
   'Perfiles de red y aislamiento se implementan con los dispositivos (Entrega 2)', 'Entrega 2'),
  ('billing.subscriptions', 'control', 'Planes y suscripciones', 'unavailable',
   'Se implementa en la Entrega 7', 'Entrega 7'),
  ('billing.invoices', 'control', 'Facturación y consumo', 'unavailable',
   'Se implementa en la Entrega 7', 'Entrega 7'),
  ('ai.automations', 'ai', 'Automatizaciones y flujos', 'unavailable',
   'Se implementa en la Entrega 8', 'Entrega 8'),
  ('ai.harness', 'ai', 'Agentes de IA (CAPTIA Harness)', 'unavailable',
   'Se implementa en la Entrega 8', 'Entrega 8');
