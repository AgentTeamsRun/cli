import { readFileSync, readdirSync } from 'node:fs';
import { getProfileToolSpecs } from '../src/mcp/catalog.js';
import { GUIDE_FILE_NAMES, GUIDE_RECORD_KINDS, WRITE_ENABLED_GUIDE_RECORD_KINDS } from '../src/mcp/guides.js';

/**
 * 플랫폼 가이드는 에이전트가 **쓰기 직전에** 읽는 문서라, 도구 표면과 어긋나면
 * 그대로 잘못된 경로 안내가 된다. `guide-command-smoke.test.ts`가 CLI 명령에 대해 하는 일을
 * MCP 도구 이름에 대해 수행한다.
 *
 * 두 번째 단언(쓰기 해금 종류마다 `## Writing via MCP` 절이 있는가)이 핵심이다.
 * 새 종류가 `GUIDE_RECORD_KINDS`에 추가되는 순간 이 테스트가 실패해 가이드 갱신을 강제한다.
 */
const guidesDir = new URL('../../api/src/templates/platform-guides/', import.meta.url);

const MCP_SECTION_HEADING = '## Writing via MCP';

const guideFileNameByWriteDomain: Readonly<Record<string, string>> = {
  documents: GUIDE_FILE_NAMES.document,
  comments: GUIDE_FILE_NAMES.comment,
  coActions: GUIDE_FILE_NAMES['co-action'],
  postMortems: GUIDE_FILE_NAMES['post-mortem'],
  codeReviews: GUIDE_FILE_NAMES['code-review'],
};

/**
 * 엔티티 ID 접두사(`agentteams_pln_...`)는 도구 이름이 아니다. 실제 도구 이름의 두 번째 마디는
 * 세 글자짜리가 없으므로(document, comment, coaction, codereview, guide, resolve ...)
 * 이 형태로 안전하게 갈린다.
 */
const ENTITY_ID_PREFIX = /^agentteams_[a-z]{3}_/;

/** 가이드 본문에서 MCP 도구로 보이는 토큰을 뽑는다. 본문을 테스트에 복사하지 않기 위한 순수 함수. */
export function extractMcpToolNames(markdown: string): string[] {
  const matches = markdown.match(/agentteams_[a-z0-9_]+/g) ?? [];
  return [...new Set(matches)].filter((name) => !ENTITY_ID_PREFIX.test(name));
}

function guideFileNames(): string[] {
  return readdirSync(guidesDir).filter((name) => name.endsWith('.md'));
}

function readGuide(fileName: string): string {
  return readFileSync(new URL(fileName, guidesDir), 'utf8');
}

const catalogToolNames = (): Set<string> => {
  const { readTools, localTools, writeTools } = getProfileToolSpecs('full');
  return new Set([...readTools, ...localTools, ...writeTools].map(({ name }) => name));
};

describe('배포 가이드가 언급하는 MCP 도구', () => {
  const fileNames = guideFileNames();

  it('스캔 대상에서 도구 이름을 하나 이상 추출한다', () => {
    const extracted = fileNames.flatMap((fileName) => extractMcpToolNames(readGuide(fileName)));
    console.info(`[guide-mcp-tool-smoke] extracted=${new Set(extracted).size}`);
    expect(extracted.length).toBeGreaterThan(0);
  });

  it.each(fileNames)('%s가 언급한 도구는 모두 실제 카탈로그에 있다', (fileName) => {
    const catalog = catalogToolNames();
    const unknown = extractMcpToolNames(readGuide(fileName)).filter((name) => !catalog.has(name));
    expect({ fileName, unknown }).toEqual({ fileName, unknown: [] });
  });

  it('카탈로그에 없는 이름을 넣으면 잡아낸다', () => {
    const catalog = catalogToolNames();
    const unknown = extractMcpToolNames('See `agentteams_bogus_tool` and `agentteams_document_create`.').filter(
      (name) => !catalog.has(name),
    );
    expect(unknown).toEqual(['agentteams_bogus_tool']);
  });

  it('엔티티 ID 접두사는 도구 이름으로 세지 않는다', () => {
    expect(extractMcpToolNames('id는 agentteams_pln_f62762fc 형태다.')).toEqual([]);
  });
});

describe('MCP 쓰기가 열린 레코드 종류의 가이드', () => {
  // `GUIDE_RECORD_KINDS`가 전 가이드로 넓어진 뒤로 이 단언의 대상은 그 부분집합이다. 읽기 전용
  // 가이드(plan-template-*, linear, sentry 등)에는 쓰기 절이 없는 게 정상이다.
  it.each([...WRITE_ENABLED_GUIDE_RECORD_KINDS])('%s 가이드는 Writing via MCP 절을 갖는다', (recordKind) => {
    const fileName = GUIDE_FILE_NAMES[recordKind];
    expect(readGuide(fileName)).toContain(MCP_SECTION_HEADING);
  });

  // 이름으로 못 여는 가이드가 있으면 convention.md가 다시 라우팅 표를 들고 와야 한다.
  // 서버 레지스트리(api/src/services/platformGuides.ts `platformGuideMetas`)와의 미러 쌍 가드다.
  it('플랫폼이 배포하는 모든 가이드 파일이 recordKind 하나로 열린다', () => {
    const mapped = new Set(GUIDE_RECORD_KINDS.map((kind) => GUIDE_FILE_NAMES[kind]));
    const shipped = readdirSync(guidesDir).filter((name) => name.endsWith('.md'));
    expect(shipped.filter((name) => !mapped.has(name))).toEqual([]);
    expect([...mapped].filter((name) => !shipped.includes(name))).toEqual([]);
  });

  it('각 discovery domain의 실제 쓰기 도구를 대응 가이드가 모두 언급한다', () => {
    const { writeTools } = getProfileToolSpecs('full');
    const missing: Array<{ name: string; domain: string; fileName: string | null }> = [];

    for (const { name, discovery } of writeTools) {
      const fileName = guideFileNameByWriteDomain[discovery.domain];
      if (!fileName) {
        missing.push({ name, domain: discovery.domain, fileName: null });
        continue;
      }

      if (!extractMcpToolNames(readGuide(fileName)).includes(name)) {
        missing.push({ name, domain: discovery.domain, fileName });
      }
    }

    expect(missing).toEqual([]);
  });
});
