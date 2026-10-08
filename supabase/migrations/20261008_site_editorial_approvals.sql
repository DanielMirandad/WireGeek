-- Apply to preview before testing; production migration requires a separate deployment decision.
CREATE TABLE IF NOT EXISTS public.site_editorial_approvals (
  noticia_id bigint PRIMARY KEY REFERENCES public.noticias(id) ON DELETE CASCADE,
  materia_site text NOT NULL,
  resumo_site text NOT NULL,
  source_hashes text[] NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_editorial_body_size CHECK (char_length(materia_site) BETWEEN 1800 AND 3500),
  CONSTRAINT site_editorial_excerpt_size CHECK (char_length(resumo_site) BETWEEN 120 AND 280),
  CONSTRAINT site_editorial_source_hashes_valid CHECK (array_length(source_hashes,1) BETWEEN 1 AND 3)
);
ALTER TABLE public.site_editorial_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_editorial_approvals FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.site_editorial_approvals IS 'Approved site editorials, distinct from Bagaça publication. Service-role access only.';
