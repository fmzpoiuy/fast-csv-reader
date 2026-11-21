// solve.js — fast drop-in for csv-reader 1.0.0.
// Same answers, built with bulk ops: charCodeAt scans, indexOf hops, slice/join
// instead of per-character string concatenation. Field results come back
// through module-level regs so no per-field array is allocated.

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
  let lastEnded = END;
  let lastAdded = 0;

  // Reads an unquoted field body starting at pos. If `prefix` is non-null it is
  // the value the field starts with (junk path of a quoted field, or the
  // literal quote of an unterminated one). Returns the value; lastEnded and
  // lastAdded describe how it ended and how many chars the body kept.
  function readUnquoted(prefix) {
    let parts = null;           // slices kept around dropped stray CRs
    let segStart = pos;
    let added = prefix === null ? 0 : prefix.length;
    let i = pos;
    let c = 0;
    while (i < n) {
      c = text.charCodeAt(i);
      if (c === 44) {                                    // ','
        pos = i + 1;
        lastEnded = COMMA; lastAdded = added + i - segStart;
        const tail = i > segStart ? text.slice(segStart, i) : '';
        return parts ? (prefix || '') + parts.join('') + tail
                     : (prefix === null ? tail : prefix + tail);
      }
      if (c === 10) {                                    // '\n'
        pos = i + 1;
        line += 1;
        lastEnded = LINE_BREAK; lastAdded = added + i - segStart;
        const tail = i > segStart ? text.slice(segStart, i) : '';
        return parts ? (prefix || '') + parts.join('') + tail
                     : (prefix === null ? tail : prefix + tail);
      }
      if (c === 13) {                                    // '\r'
        if (text.charCodeAt(i + 1) === 10) {
          pos = i + 2;
          line += 1;
          lastEnded = LINE_BREAK; lastAdded = added + i - segStart;
          const tail = i > segStart ? text.slice(segStart, i) : '';
          return parts ? (prefix || '') + parts.join('') + tail
                       : (prefix === null ? tail : prefix + tail);
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (i > segStart) (parts || (parts = [])).push(text.slice(segStart, i));
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    pos = i;
    lastEnded = END; lastAdded = added + i - segStart;
    const tail = i > segStart ? text.slice(segStart, i) : '';
    return parts ? (prefix || '') + parts.join('') + tail
                 : (prefix === null ? tail : prefix + tail);
  }

  // Reads a quoted field whose opening quote is at pos. Returns the value;
  // lastEnded describes how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;

    let q = pos;
    let close = -1;
    while (true) {
      const j = text.indexOf('"', q);
      if (j < 0) break;
      if (text.charCodeAt(j + 1) === 34) { q = j + 2; continue; }
      close = j;
      break;
    }

    if (close < 0) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }

    const raw = text.slice(pos, close);
    let value = raw;
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

    if (pos >= n) { lastEnded = END; return value; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; lastEnded = COMMA; return value; }
    if (c === 10) { pos += 1; line += 1; lastEnded = LINE_BREAK; return value; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; lastEnded = LINE_BREAK; return value;
    }

    // Junk after the closing quote is appended up to the next comma or break.
    const v = readUnquoted(value);
    if (lastAdded > value.length) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return v;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(null));
    } while (lastEnded === COMMA);

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
