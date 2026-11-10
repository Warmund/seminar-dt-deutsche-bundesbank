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
    active boolean NOT NULL DEFAULT true
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
    content bytea NOT NULL CHECK (octet_length(content) <= 3000000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (osm_type, osm_id, kind),
    FOREIGN KEY (osm_type, osm_id) REFERENCES moneta_records(osm_type, osm_id) ON DELETE CASCADE
);
