-- Runs once, the first time the postgres volume is created.
-- The test suite truncates tables between cases, so it needs its own database
-- rather than sharing the one the running app uses.
CREATE DATABASE research_uploads_test;
