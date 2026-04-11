-- V3__add_active_overlays.sql
-- Persistent spell/AoE overlays placed by the DM.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_overlays jsonb NOT NULL DEFAULT '[]';
