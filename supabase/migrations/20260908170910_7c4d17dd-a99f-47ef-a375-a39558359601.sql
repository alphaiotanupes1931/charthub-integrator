create table if not exists public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  message_id text,
  template_name text not null,
  recipient_email text not null,
  status text not null check (status in ('pending','sent','suppressed','failed','bounced','complained','dlq')),
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
grant all on public.email_send_log to service_role;
alter table public.email_send_log enable row level security;

create table if not exists public.suppressed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text not null check (reason in ('unsubscribe','bounce','complaint')),
  metadata jsonb,
  created_at timestamptz not null default now()
);
grant all on public.suppressed_emails to service_role;
alter table public.suppressed_emails enable row level security;

create table if not exists public.email_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  email text not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
grant all on public.email_unsubscribe_tokens to service_role;
alter table public.email_unsubscribe_tokens enable row level security;

create index if not exists email_send_log_created_at_idx on public.email_send_log (created_at desc);
create index if not exists email_send_log_recipient_idx on public.email_send_log (lower(recipient_email));