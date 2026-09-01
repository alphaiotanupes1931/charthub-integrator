CREATE POLICY "Users can update their own chat messages"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT UPDATE ON public.chat_messages TO authenticated;