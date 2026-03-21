-- V2__add_zones.sql
-- Per-cell zone types for difficult terrain, fire, water, etc.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS zones jsonb;
