import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { findProjectConfig } from '../utils/config.js';
import {
  PROJECT_SCOPE_FILE_MODE,
  USER_SCOPE_FILE_MODE,
  writeConfigFileAtomically,
} from '../mcp-registration/atomicWrite.js';
import {
  DEFAULT_SESSION_HOOK_CLIENT_ID,
  findSessionHookClient,
  SESSION_HOOK_CLIENT_IDS,
  type SessionHookClientDefinition,
  type SessionHookClientId,
  type SessionHookScope,
} from './clients.js';

/**
 * 세션 시작 훅 설치·제거.
 *
 * 대상 파일은 사용자 것이다 — 권한 규칙, 다른 훅, 환경변수가 함께 들어 있다. 그래서 AgentTeams
 * 항목(명령 문자열 정확 일치)만 고치고, 나머지 키·이벤트·훅은 순서까지 그대로 둔다.
 *
 * 편집은 파싱 → 수정 → 직렬화다. `mcp-registration/jsonc.ts`의 텍스트 스플라이스는 키-값
 * 컨테이너 전용이라 배열인 `hooks.<Event>`를 다룰 수 없다. 대신 엄격한 JSON만 받는다: 주석이나
 * 후행 쉼표가 있는 파일을 재직렬화하면 그것들이 조용히 사라지므로, 그런 파일은 쓰지 않고 거부한다.
 * Claude Code 자신도 설정을 바꿀 때 파일을 JSON으로 다시 쓰므로 들여쓰기 외의 서식은 보존 대상이 아니다.
 */

export type SessionHookStatus = 'installed' | 'updated' | 'unchanged' | 'removed' | 'not-installed';

export interface SessionHookOptions {
  clientId?: SessionHookClientId;
  scope?: SessionHookScope;
  /** project 스코프의 기준 디렉터리. */
  cwd?: string;
  /** user 스코프의 기준 디렉터리. 테스트가 실제 홈을 건드리지 않도록 주입할 수 있다. */
  homeDir?: string;
  dryRun?: boolean;
}

export interface SessionHookResult {
  clientId: SessionHookClientId;
  scope: SessionHookScope;
  status: SessionHookStatus;
  configPath: string;
  /** 기존 파일을 바꿨을 때만 채워진다. 새로 만들었거나 쓰지 않았으면 `null`. */
  backupPath: string | null;
  dryRun: boolean;
  message: string;
}

/** 이 오류가 나면 대상 파일은 한 바이트도 바뀌지 않았다. */
export class SessionHookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionHookConfigError';
  }
}

type JsonObject = Record<string, unknown>;

interface SessionHookTarget {
  client: SessionHookClientDefinition;
  scope: SessionHookScope;
  configPath: string;
  dryRun: boolean;
}

interface LoadedSettings {
  settings: JsonObject;
  indent: string;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function resolveTarget(options: SessionHookOptions): SessionHookTarget {
  const clientId = options.clientId ?? DEFAULT_SESSION_HOOK_CLIENT_ID;
  const client = findSessionHookClient(clientId);
  if (!client) {
    throw new SessionHookConfigError(
      `Unknown session hook client: ${String(clientId)}. Supported: ${SESSION_HOOK_CLIENT_IDS.join(', ')}.`,
    );
  }
  const scope = options.scope ?? 'project';
  const cwd = resolve(options.cwd ?? process.cwd());
  // 명시한 --cwd는 존중하고, 기본 경로만 sync·doctor와 같은 프로젝트 루트로 올린다.
  const projectConfig = scope === 'project' && options.cwd === undefined ? findProjectConfig(cwd) : null;
  const context = {
    cwd: projectConfig ? resolve(projectConfig, '..', '..') : cwd,
    homeDir: options.homeDir ?? homedir(),
  };
  const configPath = client.configPath(scope, context);
  let writePath = configPath;
  try {
    // rename은 링크 자체를 교체하므로 읽기·백업·쓰기를 모두 실제 대상에서 수행한다.
    // existsSync는 끊어진 링크도 false로 반환하므로 lstat으로 부재와 구분한다.
    if (lstatSync(configPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
      writePath = realpathSync(configPath);
    }
  } catch (error) {
    throw new SessionHookConfigError(`Could not resolve ${configPath}: ${describeError(error)}. Nothing was written.`);
  }
  return { client, scope, configPath: writePath, dryRun: options.dryRun === true };
}

function detectIndent(source: string): string {
  const match = /\n([ \t]+)\S/.exec(source);
  return match ? match[1] : '  ';
}

function loadSettings(path: string): LoadedSettings {
  if (!existsSync(path)) return { settings: {}, indent: '  ' };

  let source: string;
  try {
    source = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new SessionHookConfigError(`Could not read ${path}: ${describeError(error)}`);
  }
  // 빈 파일은 손상이 아니라 "아직 설정 없음"이다.
  if (source.trim().length === 0) return { settings: {}, indent: '  ' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new SessionHookConfigError(
      `${path} is not valid JSON (${describeError(error)}). The file was left unchanged — fix it, or remove comments and trailing commas, then re-run.`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw new SessionHookConfigError(
      `${path} must contain a JSON object at the top level. The file was left unchanged.`,
    );
  }
  return { settings: parsed, indent: detectIndent(source) };
}

function readEventGroups(settings: JsonObject, event: string, path: string): unknown[] {
  const hooks = settings.hooks;
  if (hooks === undefined) return [];
  if (!isJsonObject(hooks)) {
    throw new SessionHookConfigError(`"hooks" in ${path} is not an object. The file was left unchanged.`);
  }
  const groups = hooks[event];
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) {
    throw new SessionHookConfigError(`"hooks.${event}" in ${path} is not an array. The file was left unchanged.`);
  }
  return groups;
}

const isAgentTeamsHook = (hook: unknown, command: string): boolean => isJsonObject(hook) && hook.command === command;

const ownsGroup = (group: unknown, command: string): group is JsonObject & { hooks: unknown[] } =>
  isJsonObject(group) && Array.isArray(group.hooks) && group.hooks.some((hook) => isAgentTeamsHook(hook, command));

/** AgentTeams 항목이 정확히 하나이고 현재 계약과 같은가. 설치의 `unchanged`와 doctor의 `installed`가 이 판정을 공유한다. */
const isCurrentEntry = (groups: unknown[], client: SessionHookClientDefinition): boolean => {
  const owned = groups.filter((group) => ownsGroup(group, client.command));
  return owned.length === 1 && isDeepStrictEqual(owned[0], client.entry);
};

/**
 * AgentTeams 훅을 모든 matcher 그룹에서 뺀다. 사용자가 같은 그룹에 자기 훅을 함께 넣어 뒀다면
 * 그 훅은 그룹째 남기고, AgentTeams 훅만 있던 그룹은 통째로 지운다. `firstIndex`는 처음 발견한
 * 자리로, 재설치가 항목을 배열 끝으로 옮기지 않게 한다.
 */
function stripAgentTeamsHooks(groups: unknown[], command: string): { remaining: unknown[]; firstIndex: number } {
  const remaining: unknown[] = [];
  let firstIndex = -1;
  for (const group of groups) {
    if (!ownsGroup(group, command)) {
      remaining.push(group);
      continue;
    }
    if (firstIndex === -1) firstIndex = remaining.length;
    const others = group.hooks.filter((hook) => !isAgentTeamsHook(hook, command));
    if (others.length > 0) remaining.push({ ...group, hooks: others });
  }
  return { remaining, firstIndex };
}

/** 키 순서를 유지한 채 `hooks.<event>`를 바꾸고, 비게 된 배열·객체는 키째 정리한다. */
function withEventGroups(settings: JsonObject, event: string, groups: unknown[]): JsonObject {
  const hooks: JsonObject = isJsonObject(settings.hooks) ? { ...settings.hooks } : {};
  if (groups.length > 0) hooks[event] = groups;
  else delete hooks[event];

  const next: JsonObject = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function describeChange(target: SessionHookTarget, status: SessionHookStatus): string {
  const hook = `AgentTeams ${target.client.label} ${target.client.event} hook`;
  const path = target.configPath;
  switch (status) {
    case 'installed':
      return target.dryRun ? `Dry run: would add the ${hook} to ${path}.` : `Added the ${hook} to ${path}.`;
    case 'updated':
      return target.dryRun ? `Dry run: would update the ${hook} in ${path}.` : `Updated the ${hook} in ${path}.`;
    case 'removed':
      return target.dryRun ? `Dry run: would remove the ${hook} from ${path}.` : `Removed the ${hook} from ${path}.`;
    case 'unchanged':
      return `The ${hook} is already installed in ${path}; nothing was written.`;
    case 'not-installed':
      return `No ${hook} found in ${path}; nothing was written.`;
  }
}

function buildResult(
  target: SessionHookTarget,
  status: SessionHookStatus,
  backupPath: string | null = null,
): SessionHookResult {
  return {
    clientId: target.client.id,
    scope: target.scope,
    status,
    configPath: target.configPath,
    backupPath,
    dryRun: target.dryRun,
    message: describeChange(target, status),
  };
}

function writeSettings(
  target: SessionHookTarget,
  loaded: LoadedSettings,
  next: JsonObject,
  status: SessionHookStatus,
): SessionHookResult {
  if (target.dryRun) return buildResult(target, status);

  try {
    const written = writeConfigFileAtomically(
      target.configPath,
      `${JSON.stringify(next, null, loaded.indent)}\n`,
      target.scope === 'user' ? USER_SCOPE_FILE_MODE : PROJECT_SCOPE_FILE_MODE,
    );
    return buildResult(target, status, written.backupPath);
  } catch (error) {
    throw new SessionHookConfigError(
      `Could not write ${target.configPath}: ${describeError(error)}. The original file was left unchanged.`,
    );
  }
}

/**
 * AgentTeams 세션 훅을 설치하거나 최신 형태로 갱신한다. `session hook install`과 `init`이
 * 같은 구현을 쓰도록 명령 핸들러와 분리해 둔다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석하거나 쓸 수 없을 때. 대상 파일은 그대로다.
 */
export function installSessionHook(options: SessionHookOptions = {}): SessionHookResult {
  const target = resolveTarget(options);
  const { client } = target;
  const loaded = loadSettings(target.configPath);
  const groups = readEventGroups(loaded.settings, client.event, target.configPath);

  if (isCurrentEntry(groups, client)) {
    return buildResult(target, 'unchanged');
  }

  const { remaining, firstIndex } = stripAgentTeamsHooks(groups, client.command);
  const nextGroups = [...remaining];
  nextGroups.splice(firstIndex === -1 ? nextGroups.length : firstIndex, 0, structuredClone(client.entry));

  return writeSettings(
    target,
    loaded,
    withEventGroups(loaded.settings, client.event, nextGroups),
    firstIndex === -1 ? 'installed' : 'updated',
  );
}

/** 설정 파일에 들어 있는 AgentTeams 세션 훅의 상태. `outdated`는 설치가 `updated`로 고칠 상태다. */
export type SessionHookInstallState = 'installed' | 'outdated' | 'not-installed';

export interface SessionHookInspection {
  clientId: SessionHookClientId;
  scope: SessionHookScope;
  state: SessionHookInstallState;
  configPath: string;
}

/**
 * 파일을 쓰지 않고 AgentTeams 세션 훅 상태만 판정한다(doctor용). 훅 설치는 명시적 opt-in이라
 * 판정하는 쪽은 절대 쓰지 않는다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석할 수 없을 때.
 */
export function inspectSessionHook(options: Omit<SessionHookOptions, 'dryRun'> = {}): SessionHookInspection {
  const target = resolveTarget(options);
  const { client } = target;
  const groups = readEventGroups(loadSettings(target.configPath).settings, client.event, target.configPath);

  const state: SessionHookInstallState = !groups.some((group) => ownsGroup(group, client.command))
    ? 'not-installed'
    : isCurrentEntry(groups, client)
      ? 'installed'
      : 'outdated';
  return { clientId: client.id, scope: target.scope, state, configPath: target.configPath };
}

/**
 * AgentTeams 세션 훅만 지운다. 설치가 파일을 새로 만들었더라도 그 뒤에 사용자가 다른 설정을
 * 넣었을 수 있으므로 파일 자체는 지우지 않는다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석하거나 쓸 수 없을 때. 대상 파일은 그대로다.
 */
export function uninstallSessionHook(options: SessionHookOptions = {}): SessionHookResult {
  const target = resolveTarget(options);
  const { client } = target;
  const loaded = loadSettings(target.configPath);
  const groups = readEventGroups(loaded.settings, client.event, target.configPath);

  const { remaining, firstIndex } = stripAgentTeamsHooks(groups, client.command);
  if (firstIndex === -1) return buildResult(target, 'not-installed');

  return writeSettings(target, loaded, withEventGroups(loaded.settings, client.event, remaining), 'removed');
}
