-- 022: a real photo per product.
-- Product emails should be able to lead with the actual thing being sold
-- instead of an AI-imagined stand-in; the create-agent interview offers this
-- photo as the default hero whenever a product email maps to it.
alter table products
  add column if not exists image_url text;
