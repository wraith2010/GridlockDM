-- V1__init_schema.sql
-- GridlockDM initial schema
-- All game-state coordinates are stored in grid-cell units (not pixels)

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url    VARCHAR(500),
    role          VARCHAR(20)  NOT NULL DEFAULT 'PLAYER',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- ============================================================
-- CHARACTERS
-- ============================================================
CREATE TABLE characters (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Core identity
    name             VARCHAR(100) NOT NULL,
    race             VARCHAR(100),
    class_name       VARCHAR(100),
    subclass         VARCHAR(100),
    level            INTEGER      NOT NULL DEFAULT 1,
    background       VARCHAR(100),

    -- Combat stats
    max_hp           INTEGER,
    current_hp       INTEGER,
    temp_hp          INTEGER      DEFAULT 0,
    armor_class      INTEGER,
    speed            INTEGER      NOT NULL DEFAULT 30,
    fly_speed        INTEGER,
    swim_speed       INTEGER,
    initiative_bonus INTEGER      DEFAULT 0,
    proficiency_bonus INTEGER     DEFAULT 2,

    -- Ability scores
    str              INTEGER,
    dex              INTEGER,
    con              INTEGER,
    int_score        INTEGER,
    wis              INTEGER,
    cha              INTEGER,

    -- Flexible JSONB storage
    spells           JSONB,
    features         JSONB,
    equipment        JSONB,
    proficiencies    JSONB,
    notes            TEXT,

    -- Import metadata
    import_source    VARCHAR(20)  NOT NULL DEFAULT 'manual',
    ddb_character_id VARCHAR(50),
    raw_source       JSONB,

    avatar_url       VARCHAR(500),

    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_characters_owner  ON characters (owner_id);
CREATE INDEX idx_characters_ddb_id ON characters (ddb_character_id) WHERE ddb_character_id IS NOT NULL;

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_id         UUID         NOT NULL REFERENCES users (id),
    name          VARCHAR(200) NOT NULL,
    invite_code   VARCHAR(20)  NOT NULL UNIQUE,
    invite_mode   VARCHAR(20)  NOT NULL DEFAULT 'dm_approval',
    status        VARCHAR(20)  NOT NULL DEFAULT 'lobby',
    map_image_url VARCHAR(500),
    grid_config   JSONB,
    fog_state     JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_dm          ON sessions (dm_id);
CREATE INDEX idx_sessions_invite_code ON sessions (invite_code);
CREATE INDEX idx_sessions_status      ON sessions (status);

-- ============================================================
-- SESSION INVITES
-- ============================================================
CREATE TABLE session_invites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
    character_id UUID        NOT NULL REFERENCES characters (id),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    UNIQUE (session_id, user_id)
);

CREATE INDEX idx_session_invites_session ON session_invites (session_id, status);

-- ============================================================
-- SESSION CHARACTERS
-- ============================================================
CREATE TABLE session_characters (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID    NOT NULL REFERENCES sessions (id)    ON DELETE CASCADE,
    character_id UUID    NOT NULL REFERENCES characters (id),
    player_id    UUID    NOT NULL REFERENCES users (id),

    current_hp   INTEGER,
    temp_hp      INTEGER  DEFAULT 0,
    position_x   FLOAT8,           -- grid cell X — Java Double maps to FLOAT8
    position_y   FLOAT8,           -- grid cell Y
    conditions   JSONB   NOT NULL DEFAULT '[]',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    token_type   VARCHAR(20) NOT NULL DEFAULT 'player',

    joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (session_id, character_id)
);

CREATE INDEX idx_session_chars_session ON session_characters (session_id);
CREATE INDEX idx_session_chars_player  ON session_characters (player_id);

-- ============================================================
-- OBSERVER TOKENS
-- ============================================================
CREATE TABLE observer_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID         NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    token       VARCHAR(500) NOT NULL UNIQUE,
    label       VARCHAR(100),
    created_by  UUID         NOT NULL REFERENCES users (id),
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_observer_tokens_session ON observer_tokens (session_id);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_characters_updated_at
    BEFORE UPDATE ON characters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_session_characters_updated_at
    BEFORE UPDATE ON session_characters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
