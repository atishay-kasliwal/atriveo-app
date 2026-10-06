export interface ResumeDirectory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<ResumeDirectory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
}

export function splitResumeDownloadPath(filename: string): [string, string] {
  if (!/^[a-zA-Z0-9_-]+\/Atishay Kasliwal\.pdf$/.test(filename)) throw new Error("Resume folder information is missing. Refresh this page and try again.");
  return filename.split("/") as [string, string];
}

/** Save into a posting folder, replacing only the same resume version. */
export async function saveResumeToDirectory(parent: ResumeDirectory, filename: string, blob: Blob): Promise<void> {
  const [folder, name] = splitResumeDownloadPath(filename);
  const dir = await parent.getDirectoryHandle(folder, { create: true });
  const file = await dir.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try { await writer.write(blob); await writer.close(); }
  catch (error) { await writer.abort().catch(() => undefined); throw error; }
}

/** A stored ZIP preserves the folder and exact PDF filename on browsers without folder access. */
export async function resumeFolderZip(filename: string, blob: Blob): Promise<Blob> {
  splitResumeDownloadPath(filename);
  const name = new TextEncoder().encode(filename);
  const data = new Uint8Array(await blob.arrayBuffer());
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const header = new Uint8Array(30 + name.length);
  const h = new DataView(header.buffer);
  h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
  h.setUint16(12, 33, true); h.setUint32(14, crc, true);
  h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
  header.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const c = new DataView(central.buffer);
  c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
  c.setUint16(14, 33, true); c.setUint32(16, crc, true);
  c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true);
  e.setUint32(12, central.length, true); e.setUint32(16, header.length + data.length, true);
  return new Blob([header, data, central, end], { type: "application/zip" });
}
