-- Tables created via raw SQL don't get Supabase's usual automatic grants the
-- way tables created through the dashboard Table Editor do. Without this, even
-- a logged-in ("authenticated") user gets a permission-denied error before RLS
-- policies are ever evaluated. `anon` intentionally gets nothing here -- it
-- stays blocked at this layer too, on top of the RLS policies.

grant select, insert, update, delete on
  programs, locations, coaches, rates, one_v_one_rates, events
to authenticated;
