import { writeFileSync, renameSync } from "node:fs";
export function atomicWriteFileSync(filePath, data, encoding = "utf-8") {
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    writeFileSync(tmpPath, data, encoding);
    renameSync(tmpPath, filePath);
}
//# sourceMappingURL=atomicWrite.js.map