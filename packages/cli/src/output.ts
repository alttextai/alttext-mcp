import type { Io, OutputStream } from "./io.js";

export function colorEnabled(stream: OutputStream, env: Io["env"]): boolean {
  return stream.isTTY === true && !env["NO_COLOR"];
}

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
}

const ansi = (open: number, close: number) => (text: string) =>
  `\u001b[${String(open)}m${text}\u001b[${String(close)}m`;

export function style(enabled: boolean): Style {
  if (!enabled) return { bold: (t) => t, dim: (t) => t, red: (t) => t };
  return { bold: ansi(1, 22), dim: ansi(2, 22), red: ansi(31, 39) };
}

/** color is applied after padding so escape codes don't skew column widths */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  paint: Style,
  cellStyle: (row: number, column: number, padded: string) => string = (_r, _c, padded) => padded,
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const pad = (cells: readonly string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0));
  const lines = [paint.bold(pad(headers).join("  ").trimEnd())];
  rows.forEach((row, index) => {
    lines.push(
      pad(row)
        .map((cell, column) => cellStyle(index, column, cell))
        .join("  ")
        .trimEnd(),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function writeJson(io: Io, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeLine(stream: OutputStream, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}
