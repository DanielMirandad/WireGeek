-- Drafts do not confer approval or publication. Apply separately to the intended environment.
CREATE TABLE public.site_editorial_drafts (
  noticia_id bigint PRIMARY KEY REFERENCES public.noticias(id) ON DELETE CASCADE,
  materia_site text NOT NULL DEFAULT '',
  resumo_site text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(materia_site) <= 50000),
  CHECK (char_length(resumo_site) <= 5000),
  CHECK (char_length(image_url) <= 8192)
);
ALTER TABLE public.site_editorial_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_editorial_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.site_editorial_drafts TO service_role;
COMMENT ON TABLE public.site_editorial_drafts IS 'Editable site drafts only; never approval or publication. Access through authenticated WireGeek backend.';
