import { randomUUID } from "node:crypto";

export async function repairMissingPublicationGroup({
  supabase,
  noticiaId,
  requestedGroupId = randomUUID(),
} = {}) {
  const id = Number(noticiaId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("noticia_id invalido.");
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(requestedGroupId || "")
    )
  ) {
    throw new Error("publication_group_id solicitado invalido.");
  }

  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error("Cliente Supabase invalido.");
  }

  const { data, error } = await supabase.rpc(
    "repair_missing_publication_group",
    {
      p_noticia_id: id,
      p_requested_group_id: requestedGroupId,
    }
  );

  if (error) {
    throw new Error(
      "Nao foi possivel reparar o grupo de publicacao: " +
        error.message
    );
  }

  const rows = Array.isArray(data) ? data : [];

  if (rows.length < 1 || rows.length > 2) {
    throw new Error(
      "Reparo retornou quantidade inesperada de publicacoes."
    );
  }

  const groupId = String(
    rows[0]?.publication_group_id || ""
  ).trim();

  if (!groupId) {
    throw new Error(
      "Reparo nao retornou publication_group_id."
    );
  }

  if (
    rows.some(
      (row, index) =>
        Number(row?.noticia_id) !== id ||
        String(row?.publication_group_id || "") !== groupId ||
        Number(row?.carousel_position) !== index + 1 ||
        String(row?.status || "") !== "APROVADO" ||
        row?.published_at != null ||
        row?.instagram_post_id != null ||
        row?.youtube_video_id != null
    )
  ) {
    throw new Error(
      "Reparo nao confirmou um grupo seguro."
    );
  }

  return {
    publication_group_id: groupId,
    rows,
  };
}
