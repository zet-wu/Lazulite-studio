import { parseStudioTtml } from "./index";
import type { StudioLyricDocument } from "../../domain/document";

export type ProposalLine = {
  id?: string;
  line_id?: string;
  text?: string;
  begin_us?: number | null;
  end_us?: number | null;
  start?: number | null;
  end?: number | null;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char] ?? char,
  );
export function buildProposalTtml(lines: ProposalLine[]): StudioLyricDocument {
  const body = lines
    .map((line, index) => {
      const id = `proposal-${index + 1}`;
      const begin =
        line.begin_us ??
        (line.start == null ? null : Math.round(line.start * 1_000_000));
      const end =
        line.end_us ??
        (line.end == null ? null : Math.round(line.end * 1_000_000));
      const timing = `${begin == null ? "" : ` begin="${begin / 1_000_000}s"`}${end == null ? "" : ` end="${end / 1_000_000}s"`}`;
      const unknown = [begin == null ? "begin" : "", end == null ? "end" : ""]
        .filter(Boolean)
        .join(" ");
      return `<p xml:id="${escape(id)}"${timing}${unknown ? ` studio:null="${unknown}"` : ""}>${escape(line.text ?? "")}</p>`;
    })
    .join("");
  return parseStudioTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><div>${body}</div></body></tt>`,
  );
}
