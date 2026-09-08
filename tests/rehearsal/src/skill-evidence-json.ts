/**
 * The study's CSV as JSON, for the app's Fair play page.
 *
 * The page imports `docs/skill-evidence/results.json` the way it imports the
 * founder-owned config files (a JSON import; there is no CSV loader), and a
 * test asserts the JSON is exactly the CSV re-shaped — so the page can never
 * show a number the nightly reproduction does not. Values stay the CSV's
 * strings: nothing is parsed into a float on the way through.
 */

export interface EvidenceJson {
  columns: string[];
  rows: Record<string, string>[];
}

export function csvToJson(csv: string): EvidenceJson {
  const lines = csv.trim().split('\n');
  const columns = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new Error(`csvToJson: ${cells.length} cells for ${columns.length} columns: ${line}`);
    }
    return Object.fromEntries(columns.map((c, i) => [c, cells[i]]));
  });
  return { columns, rows };
}

/** Byte-stable serialisation — the committed file and the CHECK compare bytes. */
export function renderJson(csv: string): string {
  return JSON.stringify(csvToJson(csv), null, 2) + '\n';
}
