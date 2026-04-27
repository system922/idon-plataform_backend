-- Migration: 0013-fix-reviewed-by-fk.sql
-- reviewed_by should reference admin_users, not users

ALTER TABLE public.business_registration_requests
  DROP CONSTRAINT IF EXISTS business_registration_requests_reviewed_by_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'business_registration_requests_reviewed_by_fkey'
      AND table_name      = 'business_registration_requests'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.business_registration_requests
      ADD CONSTRAINT business_registration_requests_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;
  END IF;
END $$;
