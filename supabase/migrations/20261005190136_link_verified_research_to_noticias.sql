-- W28.2: existing candidates remain unlinked; no backfill or data changes.
ALTER TABLE public.research_candidates
  ADD COLUMN noticia_id bigint REFERENCES public.noticias(id) ON DELETE CASCADE;

CREATE INDEX research_candidates_noticia_id_id_idx
  ON public.research_candidates (noticia_id, id DESC)
  WHERE noticia_id IS NOT NULL;
