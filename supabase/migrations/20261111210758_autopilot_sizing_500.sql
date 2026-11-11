alter table public.autopilot_settings alter column sizing_balance set default 500;
update public.autopilot_settings set sizing_balance = 500 where sizing_balance is null;
