-- Research Graph schema (Supabase PostgreSQL)
-- Run in Supabase SQL Editor. Enables RLS; isolates by auth.uid().

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Core graph tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS graphs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  title       TEXT NOT NULL,
  summary     TEXT,
  revision    INTEGER NOT NULL DEFAULT 1,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nodes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id    UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  kind        TEXT NOT NULL
    CHECK (kind IN ('experiment','hypothesis','evidence','literature','note','insight','conclusion')),
  title       TEXT NOT NULL,
  content     TEXT,
  hypothesis  TEXT,
  summary     TEXT,
  lifecycle   TEXT NOT NULL DEFAULT 'staged'
    CHECK (lifecycle IN ('staged','committed','archived')),
  outcome     TEXT,
  tags        JSONB NOT NULL DEFAULT '[]',
  meta        JSONB NOT NULL DEFAULT '{}',
  embedding   vector(1536),
  revision    INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id    UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  source_id   UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL
    CHECK (relation IN ('supports','contradicts','derives','references','parent')),
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id    UUID REFERENCES graphs(id) ON DELETE CASCADE,
  node_id     UUID REFERENCES nodes(id) ON DELETE SET NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  mime        TEXT,
  storage_path TEXT NOT NULL,
  size        BIGINT,
  content_hash TEXT,
  manifest    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id    UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  citations   JSONB NOT NULL DEFAULT '[]',
  model       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Experiment / GEPA extension tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS experiments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id            UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  hypothesis_node_id  UUID REFERENCES nodes(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES auth.users(id),
  title               TEXT NOT NULL,
  objective           JSONB NOT NULL DEFAULT '{}',
  dataset_refs        JSONB NOT NULL DEFAULT '[]',
  code_ref            JSONB NOT NULL DEFAULT '{}',
  parameters          JSONB NOT NULL DEFAULT '{}',
  budget              JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','running','completed','failed','archived')),
  revision            INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_hash      TEXT NOT NULL,
  seed            BIGINT,
  provenance      JSONB NOT NULL DEFAULT '{}',
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  exit_code       INTEGER,
  error_code      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  split           TEXT,
  unit            TEXT,
  evaluator       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gepa_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  objective       JSONB NOT NULL,
  budget          JSONB NOT NULL,
  seed            BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','generating','evaluating','awaiting_gate','selected','completed','stopped','failed')),
  current_candidate_id UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gepa_iterations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gepa_run_id     UUID NOT NULL REFERENCES gepa_runs(id) ON DELETE CASCADE,
  generation      INTEGER NOT NULL,
  rollout_run_ids UUID[] NOT NULL DEFAULT '{}',
  aggregate       JSONB NOT NULL DEFAULT '{}',
  critic_report   JSONB NOT NULL DEFAULT '{}',
  selected_id     UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (gepa_run_id, generation)
);

CREATE TABLE IF NOT EXISTS gepa_candidates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iteration_id    UUID NOT NULL REFERENCES gepa_iterations(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES gepa_candidates(id),
  program         JSONB NOT NULL,
  program_hash    TEXT NOT NULL,
  scores          JSONB NOT NULL DEFAULT '{}',
  constraints     JSONB NOT NULL DEFAULT '{}',
  decision        TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','selected','rejected','invalid')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provenance_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  graph_id        UUID REFERENCES graphs(id) ON DELETE CASCADE,
  session_id      TEXT,
  message_id      TEXT,
  actor           TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  operation       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  user_id         UUID NOT NULL,
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_graphs_user ON graphs(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_graph ON nodes(graph_id);
CREATE INDEX IF NOT EXISTS idx_nodes_kind_lifecycle ON nodes(kind, lifecycle);
CREATE INDEX IF NOT EXISTS idx_edges_graph ON edges(graph_id);
CREATE INDEX IF NOT EXISTS idx_experiments_graph_status ON experiments(graph_id, status);
CREATE INDEX IF NOT EXISTS idx_experiment_runs_exp_status ON experiment_runs(experiment_id, status);
CREATE INDEX IF NOT EXISTS idx_experiment_runs_input_hash ON experiment_runs(input_hash);
CREATE INDEX IF NOT EXISTS idx_gepa_iterations_gen ON gepa_iterations(gepa_run_id, generation);
CREATE INDEX IF NOT EXISTS idx_gepa_candidates_hash ON gepa_candidates(program_hash);
CREATE INDEX IF NOT EXISTS idx_provenance_session ON provenance_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, next_retry_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE gepa_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gepa_iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gepa_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE provenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY graphs_owner ON graphs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY nodes_owner ON nodes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY edges_owner ON edges FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY artifacts_owner ON artifacts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY chat_owner ON chat_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY experiments_owner ON experiments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY experiment_runs_owner ON experiment_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY run_metrics_via_run ON run_metrics FOR ALL
  USING (EXISTS (SELECT 1 FROM experiment_runs r WHERE r.id = run_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM experiment_runs r WHERE r.id = run_id AND r.user_id = auth.uid()));
CREATE POLICY gepa_runs_owner ON gepa_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY gepa_iterations_via_run ON gepa_iterations FOR ALL
  USING (EXISTS (SELECT 1 FROM gepa_runs g WHERE g.id = gepa_run_id AND g.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM gepa_runs g WHERE g.id = gepa_run_id AND g.user_id = auth.uid()));
CREATE POLICY gepa_candidates_via_iter ON gepa_candidates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM gepa_iterations i
    JOIN gepa_runs g ON g.id = i.gepa_run_id
    WHERE i.id = iteration_id AND g.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM gepa_iterations i
    JOIN gepa_runs g ON g.id = i.gepa_run_id
    WHERE i.id = iteration_id AND g.user_id = auth.uid()
  ));
CREATE POLICY provenance_owner ON provenance_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY sync_outbox_owner ON sync_outbox FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
