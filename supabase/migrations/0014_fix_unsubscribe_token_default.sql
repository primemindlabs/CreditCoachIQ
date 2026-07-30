-- Fix a broken column DEFAULT shipped in migration 0003: PostgreSQL's
-- encode() function only supports 'base64', 'hex', and 'escape' —
-- 'base64url' was never valid Postgres SQL, even though it's a real Node.js
-- Buffer encoding. Every INSERT into `borrowers` that didn't explicitly set
-- unsubscribe_token has been failing with "unrecognized encoding: base64url"
-- ever since — this is the root cause of the Leads page save failures (and
-- would affect /api/enroll new-client creation too, since it also inserts a
-- borrowers row without specifying unsubscribe_token).
--
-- Replacement produces an equivalent URL-safe, unpadded base64 string using
-- only encode() calls Postgres actually supports: base64-encode, then swap
-- the two non-URL-safe characters (+/  ->  -_), then strip '=' padding.
ALTER TABLE borrowers ALTER COLUMN unsubscribe_token
  SET DEFAULT rtrim(translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
