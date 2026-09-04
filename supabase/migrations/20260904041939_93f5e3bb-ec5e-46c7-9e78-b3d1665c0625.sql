CREATE POLICY "journal images read own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "journal images insert own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "journal images update own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "journal images delete own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);