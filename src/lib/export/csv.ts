/**
 * Tiny CSV writer for the Export feature (v4.30.0).
 *
 * RFC 4180: every field quoted when it holds a comma, quote or line break;
 * embedded quotes doubled; CRLF between rows so Excel opens it cleanly.
 * A UTF-8 BOM is prepended so Excel reads accents (é, ü …) correctly.
 */

export type CsvValue = string | number | boolean | null | undefined | Date;

function cell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else s = String(v);
  // Guard against spreadsheet formula injection from scraped post text.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
