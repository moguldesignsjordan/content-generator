-- Migration 030: let prompt_logs record OpenAI requests (GPT Image 2.5, the
-- optional second image engine) alongside Anthropic and Gemini. Until this is
-- applied, GPT Image prompts just aren't captured on /prompts; renders still work.
-- Idempotent. Apply in the Supabase SQL editor.

-- 021 defines the check inline on prompt_logs.provider;
-- Postgres auto-named it prompt_logs_provider_check.
alter table prompt_logs drop constraint if exists prompt_logs_provider_check;
alter table prompt_logs
  add constraint prompt_logs_provider_check
  check (provider in ('anthropic', 'gemini', 'openai'));
