// solve.js — fast drop-in for csv-reader 1.0.0.
// Same answers, built with bulk ops: charCodeAt scans, indexOf hops, slice/join
// instead of per-character string concatenation.

const COMMA = 0, LINE_BREAK = 1, END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field body starting at pos. If `prefix` is given it is the
  // value the field starts with (the junk path of a quoted field, or the
  // literal quote of an unterminated one). Returns [value, ended].
  function readUnquoted(prefix) {
    const hasPrefix = prefix !== null;
    let parts = null;           // slices kept around dropped stray CRs
    let segStart = pos;
    let added = hasPrefix ? prefix.length : 0;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {                                    // ','
        pos = i + 1;
        const tail = i > segStart ? text.slice(segStart, i) : '';
        added += i - segStart;
        const v = parts
          ? (hasPrefix ? prefix : '') + parts.join('') + tail
          : (hasPrefix ? prefix + tail : tail);
        return [v, COMMA, added];
      }
      if (c === 10) {                                    // '\n'
        pos = i + 1;
        line += 1;
        const tail = i > segStart ? text.slice(segStart, i) : '';
        added += i - segStart;
        const v = parts
          ? (hasPrefix ? prefix : '') + parts.join('') + tail
          : (hasPrefix ? prefix + tail : tail);
        return [v, LINE_BREAK, added];
      }
      if (c === 13) {                                    // '\r'
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
          pos = i + 2;
          line += 1;
          const tail = i > segStart ? text.slice(segStart, i) : '';
          added += i - segStart;
          const v = parts
            ? (hasPrefix ? prefix : '') + parts.join('') + tail
            : (hasPrefix ? prefix + tail : tail);
          return [v, LINE_BREAK, added];
        }
        // lone CR: dropped, one stray_cr error, the field continues
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (i > segStart) (parts || (parts = [])).push(text.slice(segStart, i));
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    pos = i;
    const tail = i > segStart ? text.slice(segStart, i) : '';
    added += i - segStart;
    const v = parts
      ? (hasPrefix ? prefix : '') + parts.join('') + tail
      : (hasPrefix ? prefix + tail : tail);
    return [v, END, added];
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;

    // Hop quote to quote; a doubled one is skipped as an escape.
    let q = pos;
    let close = -1;
    while (true) {
      const j = text.indexOf('"', q);
      if (j < 0) break;
      if (j + 1 < n && text.charCodeAt(j + 1) === 34) { q = j + 2; continue; }
      close = j;
      break;
    }

    if (close < 0) {
      // Never closes: literal quote, the rest re-read as an unquoted field.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }

    const raw = text.slice(pos, close);
    let value = raw;
    // CRLF and lone CR inside quotes read as LF; every such break is one line.
    if (raw.indexOf('\r') >= 0) {
      value = value.replace(/\r\n?/g, '\n');
      const m = raw.match(/\r\n|[\r\n]/g);
      line += m.length;
    } else {
      const nl = raw.indexOf('\n');
      if (nl >= 0) {
        let cnt = 0;
        for (let k = nl; k < raw.length; k++) if (raw.charCodeAt(k) === 10) cnt++;
        line += cnt;
      }
    }
    if (raw.indexOf('""') >= 0) value = value.replace(/""/g, '"');
    pos = close + 1;

    if (pos >= n) return [value, END];
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return [value, COMMA]; }
    if (c === 10) { pos += 1; line += 1; return [value, LINE_BREAK]; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; return [value, LINE_BREAK];
    }

    // Junk after the closing quote is appended up to the next comma or break.
    const r = readUnquoted(value);
    if (r[2] > value.length) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return r;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    while (ended === COMMA) {
      quoted = pos < n && text.charCodeAt(pos) === 34;
      const f = quoted ? readQuoted() : readUnquoted(null);
      fields.push(f[0]);
      ended = f[1];
    }

    // A line that held only stray CRs leaves one empty unquoted field: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
