begin read only;
set local statement_timeout = '10s';

with runtime_role as (
  select oid from pg_roles where rolname = 'agromarket_runtime'
)
select jsonb_build_object(
  'runtime_role', coalesce((select jsonb_build_object(
    'superuser', r.rolsuper, 'create_role', r.rolcreaterole, 'create_db', r.rolcreatedb,
    'bypass_rls', r.rolbypassrls, 'replication', r.rolreplication, 'inherit', r.rolinherit,
    'can_login', r.rolcanlogin, 'memberships', coalesce(m.memberships, '[]'::jsonb)
  ) from pg_roles r left join lateral (
    select jsonb_agg(parent.rolname order by parent.rolname) as memberships
    from pg_auth_members membership join pg_roles parent on parent.oid = membership.roleid
    where membership.member = r.oid
  ) m on true where r.rolname = 'agromarket_runtime'), 'null'::jsonb),
  'schemas', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'usage', has_schema_privilege(rr.oid, n.oid, 'usage'),
    'create', has_schema_privilege(rr.oid, n.oid, 'create'), 'owner', owner.rolname
  ) order by n.nspname) from pg_namespace n cross join runtime_role rr
    join pg_roles owner on owner.oid = n.nspowner
    where n.nspname !~ '^pg_temp_' and (
      has_schema_privilege(rr.oid, n.oid, 'usage') or has_schema_privilege(rr.oid, n.oid, 'create') or n.nspowner = rr.oid
    )), '[]'::jsonb),
  'tables', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'owner', owner.rolname, 'rls', c.relrowsecurity,
    'kind', c.relkind, 'select', has_table_privilege(rr.oid, c.oid, 'select'), 'insert', has_table_privilege(rr.oid, c.oid, 'insert'),
    'update', has_table_privilege(rr.oid, c.oid, 'update'), 'delete', has_table_privilege(rr.oid, c.oid, 'delete'),
    'truncate', has_table_privilege(rr.oid, c.oid, 'truncate'), 'references', has_table_privilege(rr.oid, c.oid, 'references'),
    'trigger', has_table_privilege(rr.oid, c.oid, 'trigger')
  ) order by n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_roles owner on owner.oid = c.relowner cross join runtime_role rr
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname !~ '^pg_temp_' and (
      c.relowner = rr.oid or has_table_privilege(rr.oid, c.oid, 'select,insert,update,delete,truncate,references,trigger')
    )), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'column', a.attname,
    'select', has_column_privilege(rr.oid, c.oid, a.attname, 'select'),
    'insert', has_column_privilege(rr.oid, c.oid, a.attname, 'insert'),
    'update', has_column_privilege(rr.oid, c.oid, a.attname, 'update'),
    'references', has_column_privilege(rr.oid, c.oid, a.attname, 'references')
  ) order by n.nspname, c.relname, a.attnum)
    from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace cross join runtime_role rr
    where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname !~ '^pg_temp_' and (
        c.relowner = rr.oid or has_table_privilege(rr.oid, c.oid, 'select,insert,update,delete,truncate,references,trigger')
      )), '[]'::jsonb),
  'sequences', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'sequence', c.relname, 'usage', has_sequence_privilege(rr.oid, c.oid, 'usage'),
    'select', has_sequence_privilege(rr.oid, c.oid, 'select'), 'update', has_sequence_privilege(rr.oid, c.oid, 'update')
  ) order by n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join runtime_role rr where c.relkind = 'S' and n.nspname !~ '^pg_temp_' and (
      c.relowner = rr.oid or has_sequence_privilege(rr.oid, c.oid, 'usage,select,update')
    )), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'function', p.proname, 'identity', pg_get_function_identity_arguments(p.oid),
    'execute', has_function_privilege(rr.oid, p.oid, 'execute')
  ) order by n.nspname, p.proname, p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join runtime_role rr where n.nspname !~ '^pg_temp_' and (
      p.proowner = rr.oid or has_function_privilege(rr.oid, p.oid, 'execute')
    )), '[]'::jsonb),
  'database', coalesce((select jsonb_build_object(
    'connect', has_database_privilege(rr.oid, current_database(), 'connect'),
    'create', has_database_privilege(rr.oid, current_database(), 'create'),
    'temporary', has_database_privilege(rr.oid, current_database(), 'temporary')
  ) from runtime_role rr), 'null'::jsonb),
  'default_privileges', coalesce((select jsonb_agg(jsonb_build_object(
    'owner', owner.rolname, 'schema', namespace.nspname, 'object_type', d.defaclobjtype,
    'grantee', case when entry.grantee = 0 then 'PUBLIC' else grantee.rolname end,
    'privilege', entry.privilege_type, 'grantable', entry.is_grantable
  ) order by owner.rolname, namespace.nspname nulls first, d.defaclobjtype, entry.privilege_type)
  from pg_default_acl d join pg_roles owner on owner.oid = d.defaclrole
    left join pg_namespace namespace on namespace.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) entry left join pg_roles grantee on grantee.oid = entry.grantee
  where entry.grantee = 0 or entry.grantee = (select oid from runtime_role)), '[]'::jsonb),
  'explicit_grant_options', coalesce((select jsonb_agg(item order by item->>'kind', item->>'schema', item->>'object', item->>'privilege') from (
    select jsonb_build_object(
      'kind', 'relation', 'schema', n.nspname, 'object', c.relname,
      'grantee', case when entry.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      'privilege', entry.privilege_type, 'grantable', entry.is_grantable
    ) as item
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) entry
      left join pg_roles grantee on grantee.oid = entry.grantee
    where n.nspname !~ '^pg_temp_' and (entry.grantee = 0 or entry.grantee = (select oid from runtime_role))
    union all
    select jsonb_build_object(
      'kind', 'function', 'schema', n.nspname, 'object', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'grantee', case when entry.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      'privilege', entry.privilege_type, 'grantable', entry.is_grantable
    )
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) entry
      left join pg_roles grantee on grantee.oid = entry.grantee
    where n.nspname !~ '^pg_temp_' and (entry.grantee = 0 or entry.grantee = (select oid from runtime_role))
  ) effective_grants), '[]'::jsonb)
) as runtime_capability_audit;

rollback;
