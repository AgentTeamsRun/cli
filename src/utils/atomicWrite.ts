import { writeFileSync, renameSync } from "node:fs";

export function atomicWriteFileSync(
  filePath: string,
  data: string,
  encoding: BufferEncoding = "utf-8"
): void {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmpPath, data, encoding);
  renameSync(tmpPath, filePath);
}
