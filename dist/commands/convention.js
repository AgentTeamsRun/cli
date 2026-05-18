import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";
import { basename, join, relative, resolve, sep } from "node:path";
import httpClient from "../utils/httpClient.js";
import { isAxiosError } from "axios";
import matter from "gray-matter";
import { diffLines, createTwoFilesPatch } from "diff";
import { loadConfig, findProjectConfig } from "../utils/config.js";
import { withSpinner } from "../utils/spinner.js";
import { withoutJsonContentType } from "../utils/httpHeaders.js";
const CONVENTION_DIR = ".agentteams";
const LEGACY_CONVENTION_DOWNLOAD_DIR = "conventions";
const CONVENTION_INDEX_FILE = "convention.md";
const CONVENTION_MANIFEST_FILE = "conventions.manifest.json";
function findProjectRoot(cwd) {
    const configPath = findProjectConfig(cwd ?? process.cwd());
    if (!configPath)
        return null;
    // configPath = /path/.agentteams/config.json → resolve up 2 levels to project root
    return resolve(configPath, "..", "..");
}
function getApiBaseUrl(apiUrl) {
    return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}
function getApiConfigOrThrow(options) {
    const config = options?.config ?? loadConfig();
    if (!config) {
        throw new Error("Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.");
    }
    return {
        config,
        apiUrl: getApiBaseUrl(config.apiUrl),
        headers: {
            "X-API-Key": config.apiKey,
            "Content-Type": "application/json",
        },
    };
}
function normalizeRelativePath(input) {
    return input.replaceAll("\\", "/");
}
function resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput) {
    // If absolute path, keep as-is.
    const resolvedFromCwd = resolve(cwd, fileInput);
    if (resolvedFromCwd === fileInput && existsSync(fileInput)) {
        return validatePathBoundary(fileInput, projectRoot);
    }
    // Common usage: pass `.agentteams/...` from any working directory.
    if (fileInput.startsWith(`${CONVENTION_DIR}/`) || fileInput.startsWith(`${CONVENTION_DIR}\\`)) {
        return validatePathBoundary(resolve(projectRoot, fileInput), projectRoot);
    }
    // Fallback: if the cwd-based resolution exists, use it.
    if (existsSync(resolvedFromCwd)) {
        return validatePathBoundary(resolvedFromCwd, projectRoot);
    }
    // Otherwise, return cwd-based resolution to preserve a stable error path.
    return validatePathBoundary(resolvedFromCwd, projectRoot);
}
function validatePathBoundary(absolutePath, projectRoot) {
    const normalized = resolve(absolutePath);
    if (!normalized.startsWith(resolve(projectRoot) + sep)) {
        throw new Error("Path traversal detected: file must be within project root");
    }
    return normalized;
}
function buildManifestPath(projectRoot) {
    return join(projectRoot, CONVENTION_DIR, CONVENTION_MANIFEST_FILE);
}
function loadManifestOrThrow(projectRoot) {
    const manifestPath = buildManifestPath(projectRoot);
    if (!existsSync(manifestPath)) {
        throw new Error(`Download manifest not found: ${manifestPath}\nRun 'agentteams convention download' first.`);
    }
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error(`Invalid manifest format: ${manifestPath}`);
    }
    return parsed;
}
function loadManifestOrCreate(projectRoot) {
    const manifestPath = buildManifestPath(projectRoot);
    if (!existsSync(manifestPath)) {
        return {
            version: 1,
            generatedAt: new Date().toISOString(),
            entries: [],
        };
    }
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error(`Invalid manifest format: ${manifestPath}`);
    }
    return parsed;
}
function writeManifest(projectRoot, manifest) {
    const manifestPath = buildManifestPath(projectRoot);
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}
function toFileList(input) {
    return Array.isArray(input) ? input : [input];
}
function hasAnyDiff(a, b) {
    const parts = diffLines(a, b);
    return parts.some((p) => p.added || p.removed);
}
function createUnifiedDiff(fileLabel, serverText, localText) {
    return createTwoFilesPatch(`${fileLabel} (server)`, `${fileLabel} (local)`, serverText, localText, "", "", { context: 3 });
}
function toOptionalString(value) {
    return typeof value === "string" ? value : undefined;
}
function fileNameToTitle(fileName) {
    return fileName
        .replace(/\.md$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function parseCategoryFromAgentteamsPath(fileRelativePath) {
    const normalized = normalizeRelativePath(fileRelativePath);
    const parts = normalized.split("/");
    const agentteamsIndex = parts.indexOf(CONVENTION_DIR);
    if (agentteamsIndex === -1) {
        throw new Error(`Convention create requires a file under ${CONVENTION_DIR}/<category>/: ${fileRelativePath}`);
    }
    const category = parts[agentteamsIndex + 1];
    if (!category || category.length === 0) {
        throw new Error(`Convention create requires a category directory under ${CONVENTION_DIR}/: ${fileRelativePath}`);
    }
    if (category === "platform" || category === "active-plan") {
        throw new Error(`Convention create does not allow reserved directories under ${CONVENTION_DIR}/: ${category}`);
    }
    return category;
}
async function fetchAllConventions(apiUrl, projectId, headers) {
    const pageSize = 100;
    let page = 1;
    let totalPages;
    const items = [];
    while (true) {
        const response = await httpClient.get(`${apiUrl}/api/projects/${projectId}/conventions`, { headers, params: { page, pageSize } });
        const data = response.data?.data;
        if (!Array.isArray(data)) {
            break;
        }
        items.push(...data);
        const meta = response.data?.meta;
        if (typeof meta?.totalPages === "number") {
            totalPages = meta.totalPages;
        }
        if (totalPages !== undefined) {
            if (page >= totalPages)
                break;
            page += 1;
            continue;
        }
        // Fallback if meta is missing: stop when we got less than a full page.
        if (data.length < pageSize)
            break;
        page += 1;
    }
    return items;
}
async function fetchConventionsWithContent(apiUrl, projectId, headers) {
    const response = await httpClient.get(`${apiUrl}/api/projects/${projectId}/conventions/download-all`, { headers });
    const data = response.data?.data;
    if (!Array.isArray(data)) {
        throw new Error("Invalid download-all response format");
    }
    return data;
}
async function fetchPlatformGuidesHash(apiUrl, headers) {
    const response = await httpClient.get(`${apiUrl}/api/platform/guides/hash`, { headers });
    const hash = response.data?.data?.hash;
    if (typeof hash !== "string" || hash.length === 0) {
        throw new Error("Invalid platform guides hash response format");
    }
    return hash;
}
function toConventionName(convention) {
    const title = typeof convention.title === "string" ? convention.title.trim() : "";
    if (title.length > 0)
        return title;
    const fileName = typeof convention.fileName === "string" ? convention.fileName.trim() : "";
    if (fileName.length > 0)
        return fileName;
    return convention.id;
}
function toConventionNameFromManifest(entry) {
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (title.length > 0)
        return title;
    const fileName = typeof entry.fileName === "string" ? entry.fileName.trim() : "";
    if (fileName.length > 0)
        return fileName;
    return entry.conventionId;
}
function toOptionalStringOrNullIfPresent(data, key) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
        return undefined;
    }
    const value = data[key];
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return undefined;
}
export async function conventionShow() {
    const { config, apiUrl, headers } = getApiConfigOrThrow();
    const conventions = await fetchConventionsWithContent(apiUrl, config.projectId, headers);
    if (!conventions || conventions.length === 0) {
        throw new Error("No conventions found for this project. Create one via the web dashboard first.");
    }
    const sections = [];
    for (const convention of conventions) {
        const contentMarkdown = typeof convention.contentMarkdown === "string" ? convention.contentMarkdown : "";
        const sectionHeader = `# ${convention.title ?? "untitled"}\ncategory: ${convention.category ?? "uncategorized"}\nid: ${convention.id}`;
        sections.push(`${sectionHeader}\n\n${contentMarkdown}`);
    }
    return sections.join("\n\n---\n\n");
}
export async function checkConventionFreshness(apiUrl, projectId, headers, projectRoot) {
    const manifestPath = buildManifestPath(projectRoot);
    if (!existsSync(manifestPath)) {
        return {
            platformGuidesChanged: false,
            conventionChanges: [],
        };
    }
    const manifest = loadManifestOrThrow(projectRoot);
    const currentPlatformGuidesHash = await fetchPlatformGuidesHash(apiUrl, headers);
    const platformGuidesChanged = typeof manifest.platformGuidesHash === "string"
        && manifest.platformGuidesHash.length > 0
        && manifest.platformGuidesHash !== currentPlatformGuidesHash;
    const serverConventions = await fetchAllConventions(apiUrl, projectId, headers);
    const serverById = new Map(serverConventions.map((item) => [item.id, item]));
    const localById = new Map(manifest.entries.map((entry) => [entry.conventionId, entry]));
    const conventionChanges = [];
    for (const serverConvention of serverConventions) {
        const local = localById.get(serverConvention.id);
        if (!local) {
            conventionChanges.push({
                id: serverConvention.id,
                type: "new",
                title: toConventionName(serverConvention),
                fileName: serverConvention.fileName ?? undefined,
            });
            continue;
        }
        if (typeof serverConvention.updatedAt === "string"
            && typeof local.updatedAt === "string"
            && serverConvention.updatedAt !== local.updatedAt) {
            conventionChanges.push({
                id: serverConvention.id,
                type: "updated",
                title: toConventionName(serverConvention),
                fileName: serverConvention.fileName ?? local.fileName,
            });
        }
    }
    for (const localEntry of manifest.entries) {
        if (serverById.has(localEntry.conventionId))
            continue;
        conventionChanges.push({
            id: localEntry.conventionId,
            type: "deleted",
            title: toConventionNameFromManifest(localEntry),
            fileName: localEntry.fileName,
        });
    }
    return {
        platformGuidesChanged,
        conventionChanges,
    };
}
export async function conventionList() {
    const { config, apiUrl, headers } = getApiConfigOrThrow();
    const conventions = await fetchAllConventions(apiUrl, config.projectId, headers);
    if (!Array.isArray(conventions)) {
        return { data: conventions };
    }
    return {
        data: conventions.map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            fileName: item.fileName,
            updatedAt: item.updatedAt,
            createdAt: item.createdAt,
        })),
        meta: {
            total: conventions.length,
            page: 1,
            pageSize: conventions.length,
            totalPages: 1,
        }
    };
}
function toSafeFileName(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}
function toSafeDirectoryName(input) {
    const normalized = toSafeFileName(input);
    return normalized.length > 0 ? normalized : "uncategorized";
}
function buildConventionFileName(convention) {
    if (convention.fileName && convention.fileName.trim().length > 0) {
        return convention.fileName.trim();
    }
    const titleSegment = convention.title ? toSafeFileName(convention.title) : "";
    const prefix = titleSegment.length > 0 ? titleSegment : "convention";
    return `${prefix}.md`;
}
function normalizeMarkdownFileName(input) {
    const trimmed = input.trim();
    const base = trimmed.toLowerCase().endsWith('.md')
        ? trimmed.slice(0, -3)
        : trimmed;
    const safeBase = toSafeFileName(base);
    const resolvedBase = safeBase.length > 0 ? safeBase : 'guide';
    return `${resolvedBase}.md`;
}
function buildPlatformGuideFileName(guide) {
    if (typeof guide.fileName === 'string' && guide.fileName.trim().length > 0) {
        return normalizeMarkdownFileName(guide.fileName);
    }
    if (typeof guide.title === 'string' && guide.title.trim().length > 0) {
        return `${toSafeFileName(guide.title)}.md`;
    }
    return 'guide.md';
}
async function downloadPlatformGuides(projectRoot, apiUrl, headers) {
    try {
        const response = await httpClient.get(`${apiUrl}/api/platform/guides`, { headers });
        const guides = response.data?.data;
        if (!Array.isArray(guides) || guides.length === 0) {
            return 0;
        }
        const baseDir = join(projectRoot, CONVENTION_DIR, 'platform');
        rmSync(baseDir, { recursive: true, force: true });
        mkdirSync(baseDir, { recursive: true });
        const fileNameCount = new Map();
        let written = 0;
        for (const guide of guides) {
            if (!guide || typeof guide.content !== 'string') {
                continue;
            }
            const baseFileName = buildPlatformGuideFileName(guide);
            const seenCount = fileNameCount.get(baseFileName) ?? 0;
            fileNameCount.set(baseFileName, seenCount + 1);
            const fileName = seenCount === 0
                ? baseFileName
                : baseFileName.replace(/\.md$/, `-${seenCount + 1}.md`);
            const filePath = join(baseDir, fileName);
            atomicWriteFileSync(filePath, guide.content, 'utf-8');
            written += 1;
        }
        return written;
    }
    catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) {
            return 0;
        }
        throw error;
    }
}
async function downloadReportingTemplate(projectRoot, config, apiUrl, headers) {
    const agentConfigResponse = await httpClient.get(`${apiUrl}/api/projects/${config.projectId}/agent-configs`, { headers });
    const agentConfigs = agentConfigResponse.data?.data;
    if (!Array.isArray(agentConfigs) || agentConfigs.length === 0) {
        return false;
    }
    const firstAgentConfig = agentConfigs[0];
    if (!firstAgentConfig?.id || typeof firstAgentConfig.id !== "string") {
        return false;
    }
    const templateResponse = await httpClient.get(`${apiUrl}/api/projects/${config.projectId}/agent-configs/${firstAgentConfig.id}/convention`, { headers });
    const content = templateResponse.data?.data?.content;
    if (typeof content !== "string") {
        return false;
    }
    const conventionPath = join(projectRoot, CONVENTION_DIR, CONVENTION_INDEX_FILE);
    atomicWriteFileSync(conventionPath, content, "utf-8");
    return true;
}
export async function conventionDownload(options) {
    const { config, apiUrl, headers } = getApiConfigOrThrow(options);
    const projectRoot = findProjectRoot(options?.cwd);
    if (!projectRoot) {
        throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
    }
    const conventionRoot = join(projectRoot, CONVENTION_DIR);
    if (!existsSync(conventionRoot)) {
        throw new Error(`Convention directory not found: ${conventionRoot}\nRun 'agentteams init' first.`);
    }
    const hasReportingTemplate = await withSpinner('Downloading reporting template...', () => downloadReportingTemplate(projectRoot, config, apiUrl, headers));
    const platformGuideCount = await withSpinner('Downloading platform guides...', () => downloadPlatformGuides(projectRoot, apiUrl, headers));
    const conventions = await withSpinner('Downloading conventions...', async () => {
        const conventionList = await fetchConventionsWithContent(apiUrl, config.projectId, headers);
        if (!conventionList || conventionList.length === 0) {
            return conventionList;
        }
        const legacyDir = join(projectRoot, CONVENTION_DIR, LEGACY_CONVENTION_DOWNLOAD_DIR);
        rmSync(legacyDir, { recursive: true, force: true });
        const categoryDirs = new Set();
        for (const convention of conventionList) {
            const categoryName = typeof convention.category === "string" ? convention.category : "";
            categoryDirs.add(toSafeDirectoryName(categoryName));
        }
        for (const categoryDir of categoryDirs) {
            rmSync(join(projectRoot, CONVENTION_DIR, categoryDir), { recursive: true, force: true });
            mkdirSync(join(projectRoot, CONVENTION_DIR, categoryDir), { recursive: true });
        }
        const fileNameCount = new Map();
        const platformGuidesHash = await fetchPlatformGuidesHash(apiUrl, headers);
        const manifest = {
            version: 1,
            generatedAt: new Date().toISOString(),
            platformGuidesHash,
            entries: [],
        };
        for (const convention of conventionList) {
            const contentMarkdown = typeof convention.contentMarkdown === "string" ? convention.contentMarkdown : "";
            const baseFileName = buildConventionFileName(convention);
            const categoryName = typeof convention.category === "string" ? convention.category : "";
            const categoryDir = toSafeDirectoryName(categoryName);
            const duplicateKey = `${categoryDir}/${baseFileName}`;
            const seenCount = fileNameCount.get(duplicateKey) ?? 0;
            fileNameCount.set(duplicateKey, seenCount + 1);
            const fileName = seenCount === 0
                ? baseFileName
                : baseFileName.replace(/\.md$/, `-${seenCount + 1}.md`);
            const filePath = join(projectRoot, CONVENTION_DIR, categoryDir, fileName);
            atomicWriteFileSync(filePath, contentMarkdown, "utf-8");
            manifest.entries.push({
                conventionId: String(convention.id),
                fileRelativePath: normalizeRelativePath(relative(projectRoot, filePath)),
                fileName,
                categoryDir,
                title: toOptionalString(convention.title),
                category: toOptionalString(convention.category),
                scope: toOptionalString(convention.scope),
                updatedAt: toOptionalString(convention.updatedAt),
                downloadedAt: new Date().toISOString(),
            });
        }
        writeManifest(projectRoot, manifest);
        return conventionList;
    });
    if (!conventions || conventions.length === 0) {
        if (hasReportingTemplate) {
            const platformLine = platformGuideCount > 0
                ? `\nDownloaded ${platformGuideCount} platform guide file(s) into ${CONVENTION_DIR}/platform`
                : '';
            return `Convention sync completed.\nUpdated ${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}\nNo project conventions found.${platformLine}`;
        }
        throw new Error("No conventions found for this project. Create one via the web dashboard first.");
    }
    const reportingLine = hasReportingTemplate
        ? `Updated ${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}\n`
        : "";
    const platformLine = platformGuideCount > 0
        ? `Downloaded ${platformGuideCount} platform guide file(s) into ${CONVENTION_DIR}/platform\n`
        : "";
    return `Convention sync completed.\n${reportingLine}${platformLine}Downloaded ${conventions.length} file(s) into category directories under ${CONVENTION_DIR}`;
}
export async function conventionCreate(options) {
    const { config, apiUrl, headers } = getApiConfigOrThrow(options);
    const projectRoot = findProjectRoot(options?.cwd);
    if (!projectRoot) {
        throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
    }
    const manifest = loadManifestOrCreate(projectRoot);
    const files = toFileList(options.file);
    const results = [];
    for (const fileInput of files) {
        const cwd = options.cwd ?? process.cwd();
        const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
        if (!existsSync(absolutePath)) {
            throw new Error(`File not found: ${normalizeRelativePath(relative(projectRoot, absolutePath))}`);
        }
        const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));
        const category = parseCategoryFromAgentteamsPath(fileRelativePath);
        const fileName = basename(absolutePath);
        if (!fileName.toLowerCase().endsWith(".md")) {
            throw new Error(`Convention create requires a .md file: ${fileRelativePath}`);
        }
        const existingEntry = manifest.entries.find((e) => e.fileRelativePath === fileRelativePath);
        if (existingEntry) {
            throw new Error(`File is already tracked in the manifest (use update instead): ${fileRelativePath}\n` +
                `- conventionId: ${existingEntry.conventionId}`);
        }
        const localMarkdown = readFileSync(absolutePath, "utf-8");
        const parsed = matter(localMarkdown);
        const frontmatter = (parsed.data ?? {});
        const bodyMarkdown = String(parsed.content ?? "");
        const content = bodyMarkdown;
        const title = toOptionalString(frontmatter.title)?.trim() || fileNameToTitle(fileName);
        const payload = {
            title,
            category,
            fileName,
            content,
        };
        const trigger = toOptionalString(frontmatter.trigger)?.trim();
        const description = toOptionalString(frontmatter.description)?.trim();
        const agentInstruction = toOptionalString(frontmatter.agentInstruction);
        if (trigger)
            payload.trigger = trigger;
        if (description)
            payload.description = description;
        if (typeof agentInstruction === "string" && agentInstruction.trim().length > 0) {
            payload.agentInstruction = agentInstruction.trimEnd();
        }
        const response = await withSpinner(`Creating convention for ${fileRelativePath}...`, () => httpClient.post(`${apiUrl}/api/projects/${config.projectId}/conventions`, payload, { headers }));
        const created = response.data?.data;
        const createdId = typeof created?.id === "string" ? created.id : "unknown";
        const createdUpdatedAt = typeof created?.updatedAt === "string" ? created.updatedAt : undefined;
        const createdWebUrl = typeof created?.webUrl === "string" ? created.webUrl : undefined;
        const now = new Date().toISOString();
        manifest.generatedAt = now;
        manifest.entries.push({
            conventionId: createdId,
            fileRelativePath,
            fileName,
            categoryDir: category,
            title,
            category,
            ...(createdUpdatedAt ? { updatedAt: createdUpdatedAt } : {}),
            downloadedAt: now,
            lastUploadedAt: now,
            ...(createdUpdatedAt ? { lastKnownUpdatedAt: createdUpdatedAt } : {}),
        });
        writeManifest(projectRoot, manifest);
        results.push(`[OK] ${fileRelativePath}: Created. (conventionId=${createdId})`);
        if (createdWebUrl) {
            results.push(`webUrl: ${createdWebUrl}`);
        }
        results.push(`[OK] ${CONVENTION_DIR}/${CONVENTION_MANIFEST_FILE}: Updated.`);
        results.push(`[NEXT] Run 'agentteams convention download' to refresh convention.md and canonical markdown.`);
    }
    return results.join("\n");
}
export async function conventionUpdate(options) {
    const { config, apiUrl, headers } = getApiConfigOrThrow(options);
    const projectRoot = findProjectRoot(options?.cwd);
    if (!projectRoot) {
        throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
    }
    const manifest = loadManifestOrThrow(projectRoot);
    const files = toFileList(options.file);
    const apply = options.apply === true;
    const results = [];
    for (const fileInput of files) {
        const cwd = options.cwd ?? process.cwd();
        const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
        const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));
        const manifestEntry = manifest.entries.find((e) => e.fileRelativePath === fileRelativePath);
        if (!manifestEntry) {
            const available = manifest.entries
                .map((e) => e.fileRelativePath)
                .sort()
                .slice(0, 30);
            throw new Error(`Only downloaded convention files can be updated: ${fileInput}\n` +
                `- resolved: ${fileRelativePath}\n` +
                `Run 'agentteams convention download' first, or pass a file path listed in the manifest.\n` +
                (available.length > 0 ? `Examples (partial):\n- ${available.join("\n- ")}` : ""));
        }
        const conventionId = manifestEntry.conventionId;
        const [serverDetail, serverMarkdown, localMarkdown] = await withSpinner(`Preparing update for ${fileRelativePath}...`, async () => {
            const detailResponse = await httpClient.get(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`, { headers });
            const downloadResponse = await httpClient.get(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}/download`, { headers, responseType: "text" });
            const local = readFileSync(absolutePath, "utf-8");
            return [detailResponse.data?.data, String(downloadResponse.data), local];
        });
        if (!hasAnyDiff(serverMarkdown, localMarkdown)) {
            results.push(`[SKIP] ${fileRelativePath}: No changes detected.`);
            continue;
        }
        const diffText = createUnifiedDiff(fileRelativePath, serverMarkdown, localMarkdown);
        results.push(diffText.trimEnd());
        if (!apply) {
            results.push(`[DRY-RUN] ${fileRelativePath}: Printed diff only (no server changes).`);
            continue;
        }
        const parsed = matter(localMarkdown);
        const frontmatter = (parsed.data ?? {});
        const bodyMarkdown = String(parsed.content ?? "");
        const content = bodyMarkdown;
        if (typeof serverDetail?.updatedAt !== "string" || serverDetail.updatedAt.length === 0) {
            throw new Error(`[ERROR] ${fileRelativePath}: Server response is missing updatedAt.`);
        }
        const payload = {
            updatedAt: serverDetail.updatedAt,
            content,
        };
        const trigger = toOptionalStringOrNullIfPresent(frontmatter, "trigger");
        const description = toOptionalStringOrNullIfPresent(frontmatter, "description");
        const agentInstruction = toOptionalStringOrNullIfPresent(frontmatter, "agentInstruction");
        if (trigger !== undefined)
            payload.trigger = trigger;
        if (description !== undefined)
            payload.description = description;
        if (agentInstruction !== undefined)
            payload.agentInstruction = agentInstruction;
        const updatedResponse = await withSpinner(`Uploading ${fileRelativePath}...`, () => httpClient.put(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`, payload, { headers }));
        const newUpdatedAt = updatedResponse.data?.data?.updatedAt;
        const newWebUrl = typeof updatedResponse.data?.data?.webUrl === "string"
            ? updatedResponse.data.data.webUrl
            : undefined;
        const now = new Date().toISOString();
        manifestEntry.lastUploadedAt = now;
        if (typeof newUpdatedAt === "string") {
            manifestEntry.lastKnownUpdatedAt = newUpdatedAt;
        }
        writeManifest(projectRoot, manifest);
        results.push(`[OK] ${fileRelativePath}: Update applied. (conventionId=${conventionId})`);
        if (newWebUrl) {
            results.push(`webUrl: ${newWebUrl}`);
        }
    }
    return results.join("\n\n");
}
export async function conventionDelete(options) {
    const { config, apiUrl, headers } = getApiConfigOrThrow(options);
    const projectRoot = findProjectRoot(options?.cwd);
    if (!projectRoot) {
        throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
    }
    const manifest = loadManifestOrThrow(projectRoot);
    const files = toFileList(options.file);
    const apply = options.apply === true;
    const results = [];
    for (const fileInput of files) {
        const cwd = options.cwd ?? process.cwd();
        const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
        const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));
        const entryIndex = manifest.entries.findIndex((e) => e.fileRelativePath === fileRelativePath);
        if (entryIndex === -1) {
            const available = manifest.entries
                .map((e) => e.fileRelativePath)
                .sort()
                .slice(0, 30);
            throw new Error(`Only downloaded convention files can be deleted: ${fileInput}\n` +
                `- resolved: ${fileRelativePath}\n` +
                `Run 'agentteams convention download' first, or pass a file path listed in the manifest.\n` +
                (available.length > 0 ? `Examples (partial):\n- ${available.join("\n- ")}` : ""));
        }
        const entry = manifest.entries[entryIndex];
        const conventionId = entry.conventionId;
        results.push(`[PLAN] ${fileRelativePath}: Will delete conventionId=${conventionId}`);
        if (!apply) {
            results.push(`[DRY-RUN] ${fileRelativePath}: Planned only (no server delete).`);
            continue;
        }
        await withSpinner(`Deleting convention for ${fileRelativePath}...`, () => httpClient.delete(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`, { headers: withoutJsonContentType(headers) }));
        // After a successful server delete, also clean up local files/manifest.
        try {
            unlinkSync(absolutePath);
        }
        catch {
            // ignore
        }
        manifest.entries.splice(entryIndex, 1);
        writeManifest(projectRoot, manifest);
        results.push(`[OK] ${fileRelativePath}: Deleted. (conventionId=${conventionId})`);
    }
    return results.join("\n");
}
//# sourceMappingURL=convention.js.map