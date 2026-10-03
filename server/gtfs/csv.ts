// A GTFS CSV reader that scans the text once. Feeds run to 1.3 million rows, so it avoids
// splitting the whole file into lines and handles quoted fields, doubled quotes, and CRLF.
export function* csvRows(text: string): Generator<string[]> {
  const end = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < end) {
    const row: string[] = [];
    for (;;) {
      let field = '';
      if (text.charCodeAt(i) === QUOTE) {
        i++;
        for (;;) {
          const close = text.indexOf('"', i);
          if (close === -1) {
            field += text.slice(i);
            i = end;
            break;
          }
          field += text.slice(i, close);
          i = close + 1;
          if (text.charCodeAt(i) !== QUOTE) break;
          field += '"';
          i++;
        }
      }
      // Unquoted text, or stray text after a closing quote in a malformed field.
      let stop = i;
      while (stop < end) {
        const c = text.charCodeAt(stop);
        if (c === COMMA || c === LF || c === CR) break;
        stop++;
      }
      field += text.slice(i, stop);
      i = stop;
      row.push(field);
      if (text.charCodeAt(i) === COMMA) {
        i++;
        continue;
      }
      if (text.charCodeAt(i) === CR) i++;
      if (text.charCodeAt(i) === LF) i++;
      break;
    }
    if (row.length > 1 || row[0] !== '') yield row;
  }
}

// Reads a table by column name. Missing columns read as empty strings, as GTFS treats them.
export function* csvRecords<const Columns extends string>(text: string, columns: readonly Columns[]) {
  const rows = csvRows(text);
  const header = rows.next();
  if (header.done) return;
  const names = header.value.map((name) => name.trim());
  const indexes = columns.map((column) => names.indexOf(column));
  for (const row of rows) {
    const record = {} as Record<Columns, string>;
    for (const [n, column] of columns.entries()) {
      const index = indexes[n] ?? -1;
      record[column] = index === -1 ? '' : (row[index] ?? '').trim();
    }
    yield record;
  }
}

const QUOTE = 34;
const COMMA = 44;
const LF = 10;
const CR = 13;
