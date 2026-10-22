-- Refund a metered action that failed after it was charged.
-- Atomic and idempotent: the usage_events row is locked, only a row still in
-- status 'ok' is changed, so a second call (retry, double handler) is a no-op.
--   charged event (credits_charged > 0): status -> 'refunded', +credits back, ledger row 'agent_refund'
--   free setup event (credits_charged = 0): status -> 'failed', nothing to give back
-- Service role only, like spend_credits.

create or replace function public.refund_credits(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_event public.usage_events;
begin
  select * into v_event from public.usage_events where id = p_event_id for update;
  if not found then
    raise exception 'unknown usage_event %', p_event_id;
  end if;

  if v_event.status <> 'ok' then
    return jsonb_build_object('changed', false, 'status', v_event.status);
  end if;

  if v_event.credits_charged > 0 then
    update public.usage_events set status = 'refunded' where id = v_event.id;

    insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
    values (v_event.user_id, v_event.credits_charged, 'agent_refund', 'usage_event', v_event.id);

    update public.profiles
      set credits_balance = credits_balance + v_event.credits_charged, updated_at = now()
      where id = v_event.user_id;

    return jsonb_build_object('changed', true, 'status', 'refunded');
  end if;

  update public.usage_events set status = 'failed' where id = v_event.id;
  return jsonb_build_object('changed', true, 'status', 'failed');
end;
$$;

revoke execute on function public.refund_credits(uuid) from public, anon, authenticated;
