ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ;

UPDATE public.businesses
SET provisioned_at = COALESCE(updated_at, created_at, NOW())
WHERE provisioned_at IS NULL
  AND schema_name IS NOT NULL
  AND to_regnamespace(schema_name) IS NOT NULL;
