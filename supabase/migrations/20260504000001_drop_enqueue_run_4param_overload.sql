-- Drop the old 4-param overload of enqueue_run.
-- The 6-param version (with p_resume_from_index and p_resume_session_id DEFAULT NULL)
-- handles both fresh and resume runs, so the old version is superseded and causes
-- function ambiguity errors (PostgreSQL error 42725) when called with 4 args.
DROP FUNCTION IF EXISTS public.enqueue_run(uuid, uuid, text, text);
