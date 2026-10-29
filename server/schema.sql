-- The whole database: one table of links, plus a small key/value table for the robot's own notes.
-- Safe to run many times; the server runs it at every start.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  url_key     TEXT NOT NULL UNIQUE,          -- the "fingerprint" of the address, used to catch duplicates
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',      -- what the page says about itself
  summary     TEXT NOT NULL DEFAULT '',      -- written by the AI
  use_for     TEXT NOT NULL DEFAULT '',
  features    JSONB NOT NULL DEFAULT '[]',
  category    TEXT NOT NULL DEFAULT 'Other',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  user_tags   TEXT[] NOT NULL DEFAULT '{}',  -- tags you typed yourself; the AI never removes them
  pricing     TEXT NOT NULL DEFAULT 'unknown',
  source      TEXT NOT NULL DEFAULT 'web',   -- web | github | youtube
  site_name   TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL DEFAULT '',
  icon_url    TEXT NOT NULL DEFAULT '',
  github      JSONB,
  note        TEXT NOT NULL DEFAULT '',
  collection  TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued | reading | summarizing | ready | failed
  ai_status   TEXT NOT NULL DEFAULT 'pending', -- pending | done | basic | failed
  attempts    INT NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT '',
  health      TEXT NOT NULL DEFAULT 'ok',      -- ok | broken
  embedding   vector(384),                     -- the "meaning fingerprint" for smart search
  search      tsvector,                        -- words for word search, kept up to date by the trigger below
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at  TIMESTAMPTZ
);

-- More details for each website (version 3). Added this way so libraries made before keep all their links.
ALTER TABLE links
  ADD COLUMN IF NOT EXISTS overview      TEXT NOT NULL DEFAULT '',     -- 4-5 sentences, by the AI
  ADD COLUMN IF NOT EXISTS tasks         TEXT[] NOT NULL DEFAULT '{}', -- "what you can do with it": "convert PDF to Excel"
  ADD COLUMN IF NOT EXISTS audience      TEXT NOT NULL DEFAULT '',     -- who it's for
  ADD COLUMN IF NOT EXISTS quick_start   TEXT[] NOT NULL DEFAULT '{}', -- up to 3 steps to begin
  ADD COLUMN IF NOT EXISTS level         TEXT NOT NULL DEFAULT '',     -- beginner | intermediate | advanced
  ADD COLUMN IF NOT EXISTS search_words  TEXT[] NOT NULL DEFAULT '{}', -- other words people might type
  ADD COLUMN IF NOT EXISTS headings      TEXT[] NOT NULL DEFAULT '{}', -- the section titles on the pages
  ADD COLUMN IF NOT EXISTS page_links    JSONB NOT NULL DEFAULT '[]',  -- important links on the page: Docs, Pricing…
  ADD COLUMN IF NOT EXISTS pages_read    JSONB NOT NULL DEFAULT '[]',  -- the extra pages of the website the robot read
  ADD COLUMN IF NOT EXISTS content       TEXT NOT NULL DEFAULT '',     -- all the text the robot read, for search
  ADD COLUMN IF NOT EXISTS favorite      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS my_status     TEXT NOT NULL DEFAULT '',     -- '' | to-try | using | done
  ADD COLUMN IF NOT EXISTS opens         INT NOT NULL DEFAULT 0,       -- how often you opened it
  ADD COLUMN IF NOT EXISTS opened_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS robot_version INT NOT NULL DEFAULT 0;       -- which version of the robot read it

-- The words for word search. Where a word is found decides how much it counts:
-- A = name and "what you can do with it", B = tags, search words, headings, C = summaries, D = all the page text.
CREATE OR REPLACE FUNCTION links_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('english', coalesce(NEW.title, '') || ' ' || array_to_string(NEW.tasks, ' ')), 'A') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ') || ' ' || NEW.category || ' ' || NEW.collection || ' ' ||
      array_to_string(NEW.search_words, ' ') || ' ' || array_to_string(NEW.headings, ' ')), 'B') ||
    setweight(to_tsvector('english', NEW.summary || ' ' || NEW.overview || ' ' || NEW.use_for || ' ' || NEW.audience || ' ' ||
      NEW.note || ' ' || NEW.features::text), 'C') ||
    setweight(to_tsvector('english', NEW.description || ' ' || NEW.site_name || ' ' || coalesce(NEW.github ->> 'language', '') || ' ' ||
      NEW.content), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Only when the words change, so clicks, favorites and status changes stay fast.
DROP TRIGGER IF EXISTS links_search_trigger ON links;
CREATE TRIGGER links_search_trigger
  BEFORE INSERT OR UPDATE OF title, tasks, tags, category, collection, search_words, headings, summary, overview, use_for,
    audience, note, features, description, site_name, github, content ON links
  FOR EACH ROW EXECUTE FUNCTION links_search_update();

CREATE INDEX IF NOT EXISTS links_created_idx ON links (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS links_status_idx ON links (status);
CREATE INDEX IF NOT EXISTS links_search_idx ON links USING gin (search);
CREATE INDEX IF NOT EXISTS links_tags_idx ON links USING gin (tags);
CREATE INDEX IF NOT EXISTS links_embedding_idx ON links USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Website facts (version 5): small facts about each website, collected a few at a time by server/facts/runner.js.
-- `facts` has one key per kind ("company", "age", "trust"…); a kind set to null was checked and nothing was found.
CREATE TABLE IF NOT EXISTS link_facts (
  link_id    TEXT PRIMARY KEY REFERENCES links(id) ON DELETE CASCADE,
  facts      JSONB NOT NULL DEFAULT '{}',  -- one key per kind
  checked    JSONB NOT NULL DEFAULT '{}',  -- { kind: ISO time it was last checked }
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Changes over time: GitHub stars each week, a price that went up, a new feature, a page that broke…
CREATE TABLE IF NOT EXISTS link_history (
  id       BIGSERIAL PRIMARY KEY,
  link_id  TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,              -- stars | price | feature | dead | rising
  data     JSONB NOT NULL,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_history_link_idx ON link_history (link_id, kind, found_at DESC);
CREATE INDEX IF NOT EXISTS link_history_found_idx ON link_history (found_at DESC);
