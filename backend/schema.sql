CREATE TABLE IF NOT EXISTS cases (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_name text NOT NULL,
    predicted_code text NOT NULL,
    confidence double precision CHECK (confidence >= 0 AND confidence <= 1),
    explanation text,
    source_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS decisions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES cases(id),
    reviewer text NOT NULL,
    decision text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    is_admin boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
    client text PRIMARY KEY,
    attempts integer NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS moneta_records (
    osm_type text NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id bigint NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (osm_type, osm_id)
);
CREATE TABLE IF NOT EXISTS moneta_images (
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('osm', 'satellite')),
    content bytea CHECK (octet_length(content) <= 3000000),
    object_key text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (osm_type, osm_id, kind),
    FOREIGN KEY (osm_type, osm_id) REFERENCES moneta_records(osm_type, osm_id) ON DELETE CASCADE
);

ALTER TABLE moneta_images ADD COLUMN IF NOT EXISTS object_key text;
ALTER TABLE moneta_images ALTER COLUMN content DROP NOT NULL;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS classification_runs (
    id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_users(id),
    name text NOT NULL,
    model text NOT NULL,
    prompt text NOT NULL,
    sources jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS classification_run_items (
    run_id uuid NOT NULL REFERENCES classification_runs(id) ON DELETE CASCADE,
    position integer NOT NULL,
    osm_type text NOT NULL,
    osm_id text NOT NULL,
    name text NOT NULL,
    reference text NOT NULL,
    snapshot jsonb NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'done', 'error')),
    result jsonb,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    attempt uuid,
    PRIMARY KEY (run_id, position)
);
CREATE INDEX IF NOT EXISTS classification_runs_user_created ON classification_runs (user_id, created_at DESC);

ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'legacy';
ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS prompt_config text NOT NULL DEFAULT 'Simple';
ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS clue_prompts jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE classification_run_items ADD COLUMN IF NOT EXISTS clues jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS selection jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS runner_state text NOT NULL DEFAULT 'paused';
ALTER TABLE classification_runs ADD COLUMN IF NOT EXISTS runner_generation uuid;
