DELETE FROM public.chat_messages a
USING public.chat_messages b
WHERE a.msg_id IS NOT NULL
  AND a.thread_id = b.thread_id
  AND a.msg_id = b.msg_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_thread_msg_uidx
  ON public.chat_messages (thread_id, msg_id);