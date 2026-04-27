-- Migration: 0008-registration-requests.sql

CREATE TABLE IF NOT EXISTS public.business_registration_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  VARCHAR(100) NOT NULL UNIQUE,
  business_name         VARCHAR(255) NOT NULL,
  business_type_id      UUID NOT NULL REFERENCES public.business_types(id),
  user_id               UUID NOT NULL REFERENCES public.users(id)           ON DELETE CASCADE,
  business_owner_id     UUID NOT NULL REFERENCES public.business_owners(id) ON DELETE CASCADE,
  owner_first_name      VARCHAR(100) NOT NULL,
  owner_last_name       VARCHAR(100),
  owner_email           VARCHAR(255) NOT NULL,
  owner_document_type   VARCHAR(20)  DEFAULT 'cedula',
  owner_document_number VARCHAR(50)  NOT NULL UNIQUE,
  owner_phone           VARCHAR(20),
  status                VARCHAR(50)  DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','provisioned')),
  rejection_reason      TEXT,
  requested_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_by           UUID,  -- FK to admin_users added in 0013-fix-reviewed-by-fk.sql
  reviewed_at           TIMESTAMP WITH TIME ZONE,
  provisioned_at        TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status            ON public.business_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_business_type_id  ON public.business_registration_requests(business_type_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_owner_email       ON public.business_registration_requests(owner_email);
CREATE INDEX IF NOT EXISTS idx_reg_requests_user_id           ON public.business_registration_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_business_owner_id ON public.business_registration_requests(business_owner_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_requested_at      ON public.business_registration_requests(requested_at);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_registration_request_modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.business_registration_requests(id) ON DELETE CASCADE,
  module_id  UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(request_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_req_modules_request_id ON public.business_registration_request_modules(request_id);
CREATE INDEX IF NOT EXISTS idx_req_modules_module_id  ON public.business_registration_request_modules(module_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_registration_request_features (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.business_registration_requests(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(request_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_req_features_request_id ON public.business_registration_request_features(request_id);
CREATE INDEX IF NOT EXISTS idx_req_features_feature_id ON public.business_registration_request_features(feature_id);
