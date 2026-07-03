import { writeFileSync as fsWriteFileSync } from 'node:fs';
import { read, utils } from 'xlsx';

export const escapeCsv = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const writeCsv = (filePath, rows, columns, writeFileSync = fsWriteFileSync) => {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(',')),
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
};

export const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows
    .filter((values) => values.some((value) => String(value || '').trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

export const parseJsonDataset = (content) => {
  const parsed = JSON.parse(String(content));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.foods)) return parsed.foods;
  if (Array.isArray(parsed.recipes)) return parsed.recipes;
  if (Array.isArray(parsed.items)) return parsed.items;
  return [parsed];
};

export const parseXlsxDataset = (content) => {
  const workbook = read(content, { type: Buffer.isBuffer(content) ? 'buffer' : 'binary' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  });
};
