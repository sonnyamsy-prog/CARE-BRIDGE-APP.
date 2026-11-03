-- CareBridge v2 for Supabase: organizations + authenticator-code (MFA) enforcement.
-- WARNING: this DELETES the CareBridge tables first (profiles, patients, checkins, messages, organizations...).
-- Paste into SQL Editor and Run. It replaces the earlier carebridge_supabase.sql.

drop table if exists public.audit_log, public.messages, public.checkins, public.patient_organizations, public.patients,
  public.organization_members, public.organizations, public.profiles cascade;
drop function if exists public.aal2(), public.is_org_staff(uuid), public.staff_can_see(bigint), public.my_patient_id(),
  public.is_staff(), public.set_patient_code(), public.grade_checkin(), public.stamp_message(),
  public.log_audit(uuid,text,bigint,jsonb), public.audit_checkin(), public.audit_message(), public.audit_patient() cascade;

-- ============ TABLES ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff','patient')),
  name text not null
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner','nurse')),
  active          boolean not null default true,
  primary key (organization_id, user_id)
);

create table public.patients (
  id            bigint generated always as identity (start with 1001) primary key,
  code          text unique,
  user_id       uuid unique references auth.users(id) on delete set null,
  name          text not null check (length(name) <= 100),
  age           text,
  phone         text,
  dx            text not null check (length(dx) <= 200),
  dept          text not null check (dept in ('Cardiology','Diabetes and endocrine','Respiratory','Renal','Maternity','General medical','Surgical','Paediatrics','Other')),
  ward          text,
  meds          text check (length(meds) <= 1000),
  dd            date not null default current_date,
  status        text not null default 'monitoring' check (status in ('monitoring','closed')),
  registered_by uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create table public.patient_organizations (
  patient_id      bigint not null references public.patients(id) on delete cascade,
  organization_id uuid   not null references public.organizations(id) on delete cascade,
  primary key (patient_id, organization_id)
);

create table public.checkins (
  id         bigint generated always as identity primary key,
  patient_id bigint not null references public.patients(id) on delete cascade,
  meds boolean not null, sw boolean not null, br boolean not null, fv boolean not null,
  note       text not null default '' check (length(note) <= 1000),
  urgent     boolean not null default false,
  em         boolean not null default false,
  risk       text not null default 'green',
  ack        boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.messages (
  id          bigint generated always as identity primary key,
  patient_id  bigint not null references public.patients(id) on delete cascade,
  sender_name text,
  sender_role text,
  body        text not null check (length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text,
  action     text not null,
  patient_id bigint,
  detail     jsonb not null default '{}'
);

-- ============ HELPERS ============
-- True only when the signed-in session has passed the authenticator-code step.
create function public.aal2() returns boolean
language sql stable as $$ select coalesce(auth.jwt()->>'aal','') = 'aal2' $$;

-- Active member of this organization AND authenticator code verified.
create function public.is_org_staff(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.aal2() and exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.organization_id = org and m.active)
$$;

-- Staff who share an organization with this patient, with authenticator code verified.
create function public.staff_can_see(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.aal2() and exists (
    select 1 from public.patient_organizations po
    join public.organization_members m on m.organization_id = po.organization_id
    where po.patient_id = pid and m.user_id = auth.uid() and m.active)
$$;

create function public.my_patient_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.patients where user_id = auth.uid()
$$;

-- ============ TRIGGERS (the database decides risk, so nobody can fake it) ============
create function public.set_patient_code() returns trigger
language plpgsql as $$ begin new.code := 'CB-' || new.id; return new; end $$;
create trigger trg_patient_code before insert on public.patients
for each row execute function public.set_patient_code();

create function public.grade_checkin() returns trigger
language plpgsql as $$
declare s int;
begin
  new.em := new.urgent or new.note ~* 'chest.{0,12}(pain|tight|hurt)|pain.{0,12}chest|faint|pass(ed|ing)? out|can.?t (breathe|catch my breath)|cannot breathe|unconscious|seizure|kifua|kuzimia|nimezimia|siwezi kupumua';
  s := (case when new.meds then 0 else 1 end) + (case when new.sw then 2 else 0 end)
     + (case when new.br then 3 else 0 end) + (case when new.fv then 2 else 0 end);
  new.risk := case when new.em or new.br or s >= 4 then 'red' when s > 0 then 'amber' else 'green' end;
  new.ack := false;
  new.created_at := now();
  return new;
end $$;
create trigger trg_grade before insert on public.checkins
for each row execute function public.grade_checkin();

create function public.stamp_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  new.sender_name := p.name;
  new.sender_role := case when p.role = 'patient' then 'patient' else 'nurse' end;
  new.created_at := now();
  return new;
end $$;
create trigger trg_stamp before insert on public.messages
for each row execute function public.stamp_message();

-- ============ AUDIT TRAIL (who did what; no PINs or health details stored) ============
create function public.log_audit(a uuid, act text, pid bigint, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor, actor_name, action, patient_id, detail)
  values (a, (select name from public.profiles where id = a), act, pid, coalesce(d, '{}'));
end $$;
revoke execute on function public.log_audit(uuid, text, bigint, jsonb) from public, anon, authenticated;

create function public.audit_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(auth.uid(), 'checkin', new.patient_id, jsonb_build_object('risk', new.risk));
  elsif new.ack and not old.ack then
    perform public.log_audit(auth.uid(), 'alert_acknowledged', new.patient_id, jsonb_build_object('checkin', new.id));
  end if;
  return null;
end $$;
create trigger trg_audit_checkin after insert or update on public.checkins
for each row execute function public.audit_checkin();

create function public.audit_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.log_audit(auth.uid(), 'message', new.patient_id, '{}'); return null; end $$;
create trigger trg_audit_message after insert on public.messages
for each row execute function public.audit_message();

create function public.audit_patient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.registered_by, 'patient_registered', new.id, jsonb_build_object('dept', new.dept));
  elsif new.status is distinct from old.status then
    perform public.log_audit(auth.uid(), 'status_changed', new.id, jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;
create trigger trg_audit_patient after insert or update on public.patients
for each row execute function public.audit_patient();

-- ============ ROW LEVEL SECURITY ============
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.patients enable row level security;
alter table public.patient_organizations enable row level security;
alter table public.checkins enable row level security;
alter table public.messages enable row level security;
alter table public.audit_log enable row level security;

-- Read-only things a person needs just to sign in (no authenticator code needed for these):
create policy profiles_own on public.profiles for select using (id = auth.uid());
create policy members_own on public.organization_members for select using (user_id = auth.uid());
create policy orgs_mine on public.organizations for select using (
  exists (select 1 from public.organization_members m
          where m.organization_id = id and m.user_id = auth.uid() and m.active));

-- Patient data: staff need shared organization AND the authenticator code; patients see only their own.
create policy patients_read on public.patients for select
  using (public.staff_can_see(id) or user_id = auth.uid());
create policy patients_staff_update on public.patients for update
  using (public.staff_can_see(id)) with check (public.staff_can_see(id));

create policy patorg_read on public.patient_organizations for select
  using (public.staff_can_see(patient_id) or patient_id = public.my_patient_id());

create policy checkins_read on public.checkins for select
  using (public.staff_can_see(patient_id) or patient_id = public.my_patient_id());
create policy checkins_patient_insert on public.checkins for insert
  with check (patient_id = public.my_patient_id()
    and exists (select 1 from public.patients p where p.id = patient_id and p.status = 'monitoring'));
create policy checkins_staff_ack on public.checkins for update
  using (public.staff_can_see(patient_id)) with check (public.staff_can_see(patient_id));

create policy messages_read on public.messages for select
  using (public.staff_can_see(patient_id) or patient_id = public.my_patient_id());
create policy messages_insert on public.messages for insert
  with check (
    public.staff_can_see(patient_id)
    or (patient_id = public.my_patient_id()
        and exists (select 1 from public.patients p where p.id = patient_id and p.status = 'monitoring')));

create policy audit_read on public.audit_log for select using (public.staff_can_see(patient_id));

-- Narrow what the browser may change. New patients, PIN resets: Edge Function only.
revoke all on all tables in schema public from anon;
revoke insert, delete on public.patients, public.patient_organizations, public.organizations,
  public.organization_members, public.profiles from authenticated;
revoke update on public.patients, public.checkins from authenticated;
grant  update (status) on public.patients to authenticated;
grant  update (ack) on public.checkins to authenticated;
revoke update on public.organizations, public.organization_members, public.profiles from authenticated;
revoke delete on public.checkins, public.messages from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

-- ============ FIRST-TIME SETUP (run separately, after creating your user in Authentication > Users) ============
-- insert into public.organizations (name) values ('Your Hospital') returning id;   -- copy this id: it is the Organization ID
-- insert into public.profiles (id, role, name) values ('YOUR-USER-ID', 'staff', 'Your Name');
-- insert into public.organization_members (organization_id, user_id, role) values ('ORG-ID', 'YOUR-USER-ID', 'owner');

-- PIN resets happen in the Edge Function (service role), so it logs them through this helper.
create or replace function public.log_pin_reset(actor uuid, pid bigint) returns void
language sql security definer set search_path = public as $$
  select public.log_audit(actor, 'pin_reset', pid, '{}'::jsonb)
$$;
revoke execute on function public.log_pin_reset(uuid, bigint) from public, anon, authenticated;
