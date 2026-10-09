DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE conname = 'autopilot_grade_check' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT autopilot_grade_check CHECK (min_grade IN (''A+'',''A'',''B'',''ALL''))', r.t);
  END LOOP;
END $$;