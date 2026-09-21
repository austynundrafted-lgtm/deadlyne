-- These run only as triggers; Postgres exposes them as callable RPC endpoints by default, which
-- the Supabase security advisor flags. Nothing but the triggers should be able to call them.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;
