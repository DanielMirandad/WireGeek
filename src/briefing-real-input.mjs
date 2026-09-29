/*
 * INPUT REAL DO BRIEFING
 *
 * Esta fronteira identifica uma notícia já persistida.
 * O conteúdo editorial usado pelos banners é carregado
 * pelo backend a partir dessa notícia.
 */

export function parseBriefingRealInput(text) {
  let item;

  try {
    item = JSON.parse(text);
  } catch {
    throw new Error(
      "JSON inválido. Cole um único item do Briefing Geek Diário."
    );
  }

  if (
    item === null ||
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    throw new Error(
      "Carregue um único objeto de notícia."
    );
  }

  const parseNewsId = value => {
    if (
      (typeof value !== "number" &&
        typeof value !== "string") ||
      (typeof value === "string" &&
        !/^[0-9]+$/.test(value.trim()))
    ) {
      throw new Error(
        "Informe id ou noticia_id de uma notícia existente, como inteiro positivo."
      );
    }

    const id = Number(value);

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      throw new Error(
        "Informe id ou noticia_id de uma notícia existente, como inteiro positivo."
      );
    }

    return id;
  };

  const id =
    parseNewsId(
      item.id ??
      item.noticia_id
    );

  if (
    item.id != null &&
    item.noticia_id != null &&
    id !== parseNewsId(item.noticia_id)
  ) {
    throw new Error(
      "id e noticia_id devem identificar a mesma notícia."
    );
  }

  return {
    id,
  };
}