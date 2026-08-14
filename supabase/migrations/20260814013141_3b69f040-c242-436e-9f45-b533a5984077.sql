ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS msg_id text;

DELETE FROM public.chat_messages c
USING public.chat_messages k
WHERE c.thread_id = k.thread_id
  AND c.role = k.role
  AND c.parts::text = k.parts::text
  AND (c.created_at > k.created_at OR (c.created_at = k.created_at AND c.id > k.id));

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_thread_msg_id_key
  ON public.chat_messages (thread_id, msg_id)
  WHERE msg_id IS NOT NULL;