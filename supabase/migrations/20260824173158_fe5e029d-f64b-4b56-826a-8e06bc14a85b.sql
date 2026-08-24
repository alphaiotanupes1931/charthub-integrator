ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS scan_retention_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_scan_retention_days_check
  CHECK (scan_retention_days IN (0, 7, 30, 90, 180, 365));

ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS chat_threads_user_archived_idx
  ON public.chat_threads (user_id, archived_at, updated_at DESC);

-- Archives (never deletes) each user's threads once they fall outside the
-- retention window that user chose in Settings. Runs daily via pg_cron.
CREATE OR REPLACE FUNCTION public.archive_expired_chat_threads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.chat_threads t
     SET archived_at = now()
    FROM public.profiles p
   WHERE p.id = t.user_id
     AND p.scan_retention_days > 0
     AND t.archived_at IS NULL
     AND t.updated_at < now() - (p.scan_retention_days || ' days')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_expired_chat_threads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_expired_chat_threads() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('archive-expired-chat-threads')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-expired-chat-threads');

SELECT cron.schedule(
  'archive-expired-chat-threads',
  '20 3 * * *',
  $$SELECT public.archive_expired_chat_threads();$$
);