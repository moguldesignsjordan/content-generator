-- Migration 017: brand_members — who owns which brand (multi-tenancy Step 1).
--
-- Until now the app has been single-tenant by a locked decision: every logged-in
-- user sees THE brand (getSingleBrand does .limit(1)). This table is the
-- ownership primitive that makes a brand belong to specific users, so usage can
-- be attributed and (later) billed per customer. See multi-tenancy-roadmap.md
-- Step 1. Roles are owner/editor/viewer to match the roadmap; only 'owner' is
-- used at first (created during onboarding).
--
-- Additive and idempotent, matching migrations 001-016.

create table if not exists brand_members (
  brand_id   uuid not null references brands(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner'
             check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create index if not exists idx_brand_members_user on brand_members(user_id);

-- Backfill: every existing brand gets the current admins as owners. Today that
-- is one brand ("Moguls") and two admin accounts, both Jordan's
-- (jordan@moguldesignagency.com and jordancobb92@gmail.com), so the cross join
-- makes both owners of it: intended, he can sign in with either and see his
-- brand. It is only safe while every admin is the same person; if a non-Jordan
-- admin is ever added before this runs, scope the select instead. New brands
-- created via onboarding insert their own membership row (see lib/db/queries.ts
-- createBrand), so this only covers pre-existing data.
insert into brand_members (brand_id, user_id, role)
select b.id, up.id, 'owner'
from brands b
cross join user_profiles up
where up.role = 'admin'
on conflict do nothing;
