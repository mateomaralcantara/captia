-- Reversión de 20261119000100_core.sql.
-- DESTRUCTIVO: borra organizaciones, membresías y auditoría. Ejecutar solo en entornos desechables
-- o tras exportar `core.audit_events` a almacenamiento inmutable.

drop trigger if exists captia_on_auth_user on auth.users;
drop schema if exists core cascade;
