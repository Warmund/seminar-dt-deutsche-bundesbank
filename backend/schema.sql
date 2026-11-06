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
