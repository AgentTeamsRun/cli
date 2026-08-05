import { stripEntityIdPrefix } from './entityId.js';

/**
 * How a resolved reference is delivered back to the caller.
 *
 * - `file`       body-bearing AgentTeams entity → downloaded to a local `.md`
 * - `record`     structured record → returned inline as JSON
 * - `localFile`  the reference already carries a local path → read it directly
 * - `external`   non-AgentTeams system → url / suggested command only
 */
export type EntityRefKind = 'file' | 'record' | 'localFile' | 'external';

export interface EntityRefDescriptor {
  /** Reference token type, exactly as it is serialized into markdown. */
  refType: string;
  /**
   * Short code inside the canonical `agentteams_<code>_` id prefix, used to
   * infer the type back from a bare prefixed id. Absent for external markers,
   * whose ids never carry an AgentTeams prefix.
   */
  prefixCode?: string;
  kind: EntityRefKind;
  /** Reference points at a system outside AgentTeams (no prefix normalization). */
  external?: boolean;
  /** Equivalent command for older CLIs that do not ship `resolve`. */
  resolver: string;
}

export interface ParsedEntityRef {
  /** Input as received, after trimming. */
  raw: string;
  /** Link text, when the input was a whole `[label](target)` markdown link. */
  label?: string;
  refType: string;
  /** Bare id (AgentTeams prefix stripped) or, for external markers, the locator. */
  id: string;
  kind: EntityRefKind;
  external: boolean;
  /** Parent id of a sub-entity reference (`codeReview:R:F`, `plan:P:T`). */
  parentId?: string;
  /** Local file path carried by a `convention:id:path` reference. */
  path?: string;
  /** Equivalent command for older CLIs that do not ship `resolve`. */
  fallbackCommand: string;
  /** Web URL of an external reference, when it can be derived from the locator. */
  url?: string;
  /** CLI command that fetches an external reference (`gh`/`glab`). */
  suggestedCommand?: string;
}

/**
 * Canonical prefix codes mirror `cli/src/utils/entityId.ts` and
 * `web/src/lib/entityId.ts` (`entityPrefixByType`). The codes live here because
 * the shared `stripEntityIdPrefix` only removes a prefix — it cannot tell which
 * type a prefix belongs to, which is exactly what reverse inference needs.
 * Stripping itself is always delegated, never re-implemented.
 */
const ENTITY_REF_DESCRIPTORS: EntityRefDescriptor[] = [
  { refType: 'plan', prefixCode: 'pln', kind: 'file', resolver: 'agentteams plan download --id <id>' },
  { refType: 'completionReport', prefixCode: 'rpt', kind: 'file', resolver: 'agentteams report download --id <id>' },
  { refType: 'postMortem', prefixCode: 'pmt', kind: 'file', resolver: 'agentteams postmortem download --id <id>' },
  { refType: 'coAction', prefixCode: 'act', kind: 'file', resolver: 'agentteams coaction download --id <id>' },
  { refType: 'document', prefixCode: 'doc', kind: 'file', resolver: 'agentteams document download --id <id>' },
  { refType: 'codeReview', prefixCode: 'rev', kind: 'record', resolver: 'agentteams code-review get --id <id>' },
  {
    refType: 'codeReviewFinding',
    prefixCode: 'rvf',
    kind: 'record',
    resolver: 'agentteams code-review get --finding-id <id>',
  },
  { refType: 'planTask', prefixCode: 'tsk', kind: 'record', resolver: 'agentteams task get --task-id <id>' },
  {
    refType: 'convention',
    prefixCode: 'cnv',
    // A convention reference usually carries the local path it was deployed to,
    // so the default resolution is a local read; the id-only form falls back to
    // a server fetch (see `resolveConventionKind`).
    kind: 'localFile',
    resolver: 'read the local path from the reference',
  },
  {
    refType: 'LINEAR_ISSUE',
    kind: 'record',
    external: true,
    resolver: 'agentteams linear issue get --issue-id <id>',
  },
  { refType: 'GITHUB_ISSUE', kind: 'external', external: true, resolver: 'gh issue view <number> --repo <owner/repo>' },
  { refType: 'GITHUB_PR', kind: 'external', external: true, resolver: 'gh pr view <number> --repo <owner/repo>' },
  {
    refType: 'GITLAB_ISSUE',
    kind: 'external',
    external: true,
    resolver: 'glab issue view <iid> --repo <projectPath>',
  },
  {
    refType: 'GITLAB_MERGE_REQUEST',
    kind: 'external',
    external: true,
    resolver: 'glab mr view <iid> --repo <projectPath>',
  },
  { refType: 'BITBUCKET_ISSUE', kind: 'external', external: true, resolver: 'open the issue URL' },
  { refType: 'BITBUCKET_PR', kind: 'external', external: true, resolver: 'open the pull request URL' },
];

const descriptorByRefType = new Map<string, EntityRefDescriptor>(
  ENTITY_REF_DESCRIPTORS.map((descriptor) => [descriptor.refType.toLowerCase(), descriptor]),
);

const descriptorByPrefixCode = new Map<string, EntityRefDescriptor>(
  ENTITY_REF_DESCRIPTORS.filter((descriptor) => descriptor.prefixCode).map((descriptor) => [
    descriptor.prefixCode as string,
    descriptor,
  ]),
);

export const SUPPORTED_REF_FORMS = [
  'type:id (e.g. plan:agentteams_pln_<uuid>)',
  'type:id:path (convention:<id>:.agentteams/rules/context.md)',
  'parent:child (codeReview:<reviewId>:<findingId>, plan:<planId>:<taskId>)',
  'bare prefixed id (agentteams_doc_<uuid>)',
  'external marker (LINEAR_ISSUE:<uuid>, GITHUB_ISSUE:<owner/repo#n>, GITHUB_PR, GITLAB_ISSUE, GITLAB_MERGE_REQUEST, BITBUCKET_ISSUE, BITBUCKET_PR)',
  'a whole markdown link wrapping any of the above ([label](type:id))',
].join('; ');

const SUPPORTED_REF_TYPES = ENTITY_REF_DESCRIPTORS.map((descriptor) => descriptor.refType).join(', ');

function unsupported(input: string, reason: string): Error {
  return new Error(
    `Unsupported entity reference: ${input} (${reason}). Supported forms: ${SUPPORTED_REF_FORMS}. Supported types: ${SUPPORTED_REF_TYPES}. A plain https link is not an entity reference — open the URL directly.`,
  );
}

const MARKDOWN_LINK_PATTERN = /^\[([^\]]*)\]\((.+)\)$/;
const PREFIXED_ID_PATTERN = /^agentteams_([a-z]{3})_(.+)$/;
/**
 * Every AgentTeams entity id is a bare UUID (mirrors `uuidBodyPattern` in
 * `web/src/lib/entityId.ts`). References arrive from user-authored text, and a
 * parsed id is interpolated straight into an API path, so anything that is not
 * a UUID is rejected here rather than sent to the server. External markers are
 * exempt — their locators are not AgentTeams ids.
 */
const ENTITY_UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Sentinel host the web editor uses when a reference has no real web URL. */
const ENTITY_REF_SENTINEL_HOST = '__entity_ref__';

/**
 * Unwrap the layers a reference can arrive in — a whole markdown link and/or
 * the `https://__entity_ref__/<encoded token>` URL the editor serializes — down
 * to the bare `type:id` token.
 */
function unwrapRefTarget(input: string): { target: string; label?: string } {
  const linkMatch = input.match(MARKDOWN_LINK_PATTERN);
  const label = linkMatch?.[1]?.trim() || undefined;
  let target = (linkMatch?.[2] ?? input).trim();

  if (
    target.startsWith(`https://${ENTITY_REF_SENTINEL_HOST}/`) ||
    target.startsWith(`http://${ENTITY_REF_SENTINEL_HOST}/`)
  ) {
    const encoded = target.slice(target.indexOf(ENTITY_REF_SENTINEL_HOST) + ENTITY_REF_SENTINEL_HOST.length + 1);
    target = decodeURIComponent(encoded).trim();
  }

  return { target, label };
}

function buildExternalTarget(refType: string, locator: string): { url?: string; suggestedCommand?: string } {
  const hashIndex = locator.lastIndexOf('#');
  const bangIndex = locator.lastIndexOf('!');

  if (refType === 'GITHUB_ISSUE' || refType === 'GITHUB_PR') {
    if (hashIndex <= 0) return {};
    const repo = locator.slice(0, hashIndex);
    const number = locator.slice(hashIndex + 1);
    const segment = refType === 'GITHUB_ISSUE' ? 'issues' : 'pull';
    const command = refType === 'GITHUB_ISSUE' ? 'issue' : 'pr';
    return {
      url: `https://github.com/${repo}/${segment}/${number}`,
      suggestedCommand: `gh ${command} view ${number} --repo ${repo}`,
    };
  }

  if (refType === 'GITLAB_ISSUE' || refType === 'GITLAB_MERGE_REQUEST') {
    const separatorIndex = refType === 'GITLAB_ISSUE' ? hashIndex : bangIndex;
    if (separatorIndex <= 0) return {};
    const projectPath = locator.slice(0, separatorIndex);
    const iid = locator.slice(separatorIndex + 1);
    const command = refType === 'GITLAB_ISSUE' ? 'issue' : 'mr';
    // No url: the GitLab host can be self-managed and is not derivable from the
    // project path, so `glab` (which reads the configured host) is the answer.
    return { suggestedCommand: `glab ${command} view ${iid} --repo ${projectPath}` };
  }

  if (refType === 'BITBUCKET_ISSUE' || refType === 'BITBUCKET_PR') {
    if (hashIndex <= 0) return {};
    const repo = locator.slice(0, hashIndex);
    const id = locator.slice(hashIndex + 1);
    const segment = refType === 'BITBUCKET_ISSUE' ? 'issues' : 'pull-requests';
    return { url: `https://bitbucket.org/${repo}/${segment}/${id}` };
  }

  return {};
}

function buildFallbackCommand(descriptor: EntityRefDescriptor, parsed: { id: string }): string {
  return descriptor.resolver.replace('<id>', parsed.id);
}

/**
 * A `convention:<id>` reference without a path cannot be read locally, so it
 * degrades to a server fetch instead of the usual local read.
 */
function resolveConventionKind(path: string | undefined): EntityRefKind {
  return path ? 'localFile' : 'record';
}

/**
 * Parse an entity reference token into the type, bare id, and resolution kind.
 * Pure: no filesystem, no network.
 */
export function parseEntityRef(input: string): ParsedEntityRef {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw unsupported(String(input), 'empty reference');
  }

  const raw = input.trim();
  const { target, label } = unwrapRefTarget(raw);
  if (target.length === 0) {
    throw unsupported(raw, 'empty reference target');
  }

  const prefixedMatch = target.match(PREFIXED_ID_PATTERN);
  if (prefixedMatch) {
    const descriptor = descriptorByPrefixCode.get(prefixedMatch[1] as string);
    if (!descriptor) {
      throw unsupported(raw, `unknown id prefix agentteams_${prefixedMatch[1]}_`);
    }
    const id = stripEntityIdPrefix(target);
    return finalize({ raw, label, descriptor, id });
  }

  const typeSeparator = target.indexOf(':');
  if (typeSeparator <= 0) {
    throw unsupported(raw, 'no type could be determined');
  }

  const typeToken = target.slice(0, typeSeparator);
  const rest = target.slice(typeSeparator + 1).trim();
  const descriptor = descriptorByRefType.get(typeToken.toLowerCase());
  if (!descriptor) {
    throw unsupported(raw, `unknown reference type "${typeToken}"`);
  }
  if (rest.length === 0) {
    throw unsupported(raw, 'reference has no id');
  }

  // External locators (`owner/repo#12`, `group/project!7`) never contain a
  // colon, so they are taken whole rather than split further.
  if (descriptor.external) {
    return finalize({ raw, label, descriptor, id: rest, skipPrefixStrip: true });
  }

  const idSeparator = rest.indexOf(':');
  const idPart = idSeparator === -1 ? rest : rest.slice(0, idSeparator).trim();
  const thirdPart = idSeparator === -1 ? undefined : rest.slice(idSeparator + 1).trim();
  if (idPart.length === 0) {
    throw unsupported(raw, 'reference has no id');
  }

  if (thirdPart === undefined) {
    return finalize({ raw, label, descriptor, id: idPart });
  }
  if (thirdPart.length === 0) {
    throw unsupported(raw, 'three-part reference has an empty third segment');
  }

  // The same three-part grammar carries a local path for conventions and a
  // child id for code reviews and plans, so the parent type decides.
  if (descriptor.refType === 'convention') {
    return finalize({ raw, label, descriptor, id: idPart, path: thirdPart });
  }
  if (descriptor.refType === 'codeReview') {
    return finalize({
      raw,
      label,
      descriptor: descriptorByRefType.get('codereviewfinding') as EntityRefDescriptor,
      id: thirdPart,
      parentId: stripEntityIdPrefix(idPart),
    });
  }
  if (descriptor.refType === 'plan') {
    return finalize({
      raw,
      label,
      descriptor: descriptorByRefType.get('plantask') as EntityRefDescriptor,
      id: thirdPart,
      parentId: stripEntityIdPrefix(idPart),
    });
  }

  throw unsupported(raw, `three-part references are not supported for type "${descriptor.refType}"`);
}

function finalize(input: {
  raw: string;
  label?: string;
  descriptor: EntityRefDescriptor;
  id: string;
  parentId?: string;
  path?: string;
  skipPrefixStrip?: boolean;
}): ParsedEntityRef {
  const { raw, label, descriptor, parentId, path, skipPrefixStrip } = input;
  const id = skipPrefixStrip ? input.id : stripEntityIdPrefix(input.id);
  if (descriptor.prefixCode) {
    if (!ENTITY_UUID_PATTERN.test(id)) {
      throw unsupported(raw, `"${id}" is not a valid ${descriptor.refType} id (expected a UUID)`);
    }
    if (parentId !== undefined && !ENTITY_UUID_PATTERN.test(parentId)) {
      throw unsupported(raw, `"${parentId}" is not a valid parent id (expected a UUID)`);
    }
  }
  const kind = descriptor.refType === 'convention' ? resolveConventionKind(path) : descriptor.kind;
  const external = descriptor.external === true;
  const { url, suggestedCommand } = external ? buildExternalTarget(descriptor.refType, id) : {};

  const parsed: ParsedEntityRef = {
    raw,
    refType: descriptor.refType,
    id,
    kind,
    external,
    // A derived `gh`/`glab` invocation is strictly more useful than the generic
    // template, so it doubles as the fallback for SCM references.
    fallbackCommand: suggestedCommand ?? buildFallbackCommand(descriptor, { id }),
  };
  if (label) parsed.label = label;
  if (parentId) parsed.parentId = parentId;
  if (path) parsed.path = path;
  if (url) parsed.url = url;
  if (suggestedCommand) parsed.suggestedCommand = suggestedCommand;
  return parsed;
}
