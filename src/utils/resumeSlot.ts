import type { TailorRecord } from "../types/tailorQueue";

/** Parse leading `NN_` or legacy `NN-` from a folder name. */
export function parseFolderSlot(pathOrFolder: string | null | undefined): number | null {
  if (!pathOrFolder) return null;
  const base = pathOrFolder.split("/").filter(Boolean).pop() || "";
  const match = base.match(/^(\d+)[_-]/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse hour segment from run_dir: .../YYYY-MM-DD/HH/NN_company-role */
export function parseSessionHourFromPath(dir?: string | null): string | null {
  if (!dir) return null;
  const parts = dir.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const hour = parts[parts.length - 2];
  return /^\d{1,2}$/.test(hour) ? String(Number(hour)).padStart(2, "0") : null;
}

/** Table # column — prefer stored slot, then folder name, then row index. */
export function resolveResumeSlot(
  record: TailorRecord | null | undefined,
  tableIndex: number,
): number {
  if (record?.resumeSlot && record.resumeSlot > 0) return record.resumeSlot;
  const fromFolder = parseFolderSlot(record?.folder || record?.dir || record?.pdfPath);
  if (fromFolder) return fromFolder;
  return tableIndex;
}

export function resolveSessionHour(
  record: TailorRecord | null | undefined,
  fallbackHour?: string | null,
): string {
  if (record?.sessionHour) return record.sessionHour;
  const fromPath = parseSessionHourFromPath(record?.dir || record?.pdfPath);
  if (fromPath) return fromPath;
  return fallbackHour || "00";
}

export function formatResumeSlot(n: number): string {
  return String(n).padStart(2, "0");
}
