CREATE OR REPLACE FUNCTION public.platform_accuracy_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE scan_counts jsonb; trade_counts jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT jsonb_build_object('wins', count(*) FILTER (WHERE status = 'target'), 'losses', count(*) FILTER (WHERE status = 'stop'), 'updatedAt', max(resolved_at))
  INTO scan_counts FROM public.signal_scores
  WHERE bias IN ('Long', 'Short') AND status IN ('target', 'stop') AND correlated IS NOT TRUE;

  -- Only closed executed trades with explicitly reported P&L. Price-history
  -- guesses and manually tagged wins without P&L are never actual trade wins.
  SELECT jsonb_build_object('wins', count(*) FILTER (WHERE pnl > 0), 'losses', count(*) FILTER (WHERE pnl < 0), 'breakeven', count(*) FILTER (WHERE pnl = 0), 'updatedAt', max(updated_at))
  INTO trade_counts FROM (
    SELECT CASE WHEN jsonb_typeof(data->'reportedPnl') = 'number' THEN (data->>'reportedPnl')::numeric ELSE NULL END AS pnl, updated_at
    FROM public.journal_trades
    WHERE data->>'executed' = 'true' AND data->>'result' IN ('tp', 'stop', 'breakeven', 'partial')
  ) closed_trades WHERE pnl IS NOT NULL;
  RETURN jsonb_build_object('scans', scan_counts, 'trades', trade_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_accuracy_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_accuracy_summary() TO authenticated;