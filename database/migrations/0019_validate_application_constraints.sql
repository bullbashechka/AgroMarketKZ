-- Preflight found no violations. Keep validation bounded: a busy production
-- table aborts safely and the migration can be retried during a quieter window.
set lock_timeout = '2s';
set statement_timeout = '10s';

do $block$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, c.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('categories', 'cards', 'card_images', 'requests')
      and con.contype = 'c'
      and not con.convalidated
    order by c.relname, con.conname
  loop
    execute format('alter table %I.%I validate constraint %I', item.schema_name, item.table_name, item.constraint_name);
  end loop;
end
$block$;

reset lock_timeout;
reset statement_timeout;
