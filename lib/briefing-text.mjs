/*
 * Utilitário textual exclusivo do Briefing Geek Diário.
 * Não importa regras ou contratos do fluxo anterior.
 */

export function cleanBriefingText(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n").trim();
}
