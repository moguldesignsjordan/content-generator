-- Lower the new-user starter credit grant from ~$25 face (2500 credits) to
-- $5 face (500 credits) at 100 credits/$1. Idempotent: safe to re-run.

alter table billing_config
  alter column starter_credit_grant set default 500;

update billing_config
  set starter_credit_grant = 500
  where id = 1;
