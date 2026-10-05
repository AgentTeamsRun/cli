import { omitDocumentEditorMirror, toPlanSummaryResponse } from '@agentteams/context-tools';

const envelope = omitDocumentEditorMirror({
  data: {
    id: 'document-1',
    body: '# Markdown body',
    bodyTiptap: '{"type":"doc","content":[]}',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
});

envelope.data.id satisfies string;
envelope.data.body satisfies string;
envelope.data.updatedAt satisfies string;
// @ts-expect-error MCP document payloads must not promise the removed editor mirror.
void envelope.data.bodyTiptap;

const flatDocument = omitDocumentEditorMirror({
  id: 'document-1',
  body: '# Markdown body',
  bodyTiptap: '{"type":"doc","content":[]}',
});

flatDocument.id satisfies string;
flatDocument.body satisfies string;
// @ts-expect-error Flat document payloads follow the same omission contract.
void flatDocument.bodyTiptap;

omitDocumentEditorMirror('unchanged') satisfies string;

const runbook = {
  data: {
    plan: { id: 'plan-1', title: '플랜', contentMarkdown: '# 실행 지시서' },
    tasks: [
      {
        id: 'task-1',
        number: 1,
        title: '태스크',
        status: 'DONE',
        orderIndex: 0,
        wave: 1,
        dependsOnTaskIds: ['task-0'],
        detail: '상세 실행 지시서',
        category: '구현',
        completionReportId: 'report-1',
        extra: '요약에서 제외',
      },
    ],
    progress: { percent: 100 },
    documentLinks: [{ id: 'document-1' }],
  },
  meta: { requestId: 'request-1' },
};
const planSummary = toPlanSummaryResponse(runbook);

planSummary.data.plan.id satisfies string;
planSummary.data.plan.title satisfies string;
planSummary.data.tasks[0].id satisfies string;
planSummary.data.tasks[0].number satisfies number;
planSummary.data.tasks[0].title satisfies string;
planSummary.data.tasks[0].status satisfies string;
planSummary.data.tasks[0].orderIndex satisfies number;
planSummary.data.tasks[0].wave satisfies number;
planSummary.data.tasks[0].dependsOnTaskIds satisfies string[];
planSummary.data.progress.percent satisfies number;
planSummary.data.documentLinks[0].id satisfies string;
planSummary.meta.requestId satisfies string;
// @ts-expect-error 요약은 제거한 플랜 본문을 반환 타입으로 보장하지 않는다.
void planSummary.data.plan.contentMarkdown.length;
// @ts-expect-error 요약 태스크에는 상세 본문이 없다.
void planSummary.data.tasks[0].detail.length;
// @ts-expect-error 요약 태스크에는 분류가 없다.
void planSummary.data.tasks[0].category;
// @ts-expect-error 요약 태스크에는 완료보고서 연결이 없다.
void planSummary.data.tasks[0].completionReportId;
// @ts-expect-error 허용한 태스크 메타데이터 외 임의 필드도 제외한다.
void planSummary.data.tasks[0].extra;
runbook.data.plan.contentMarkdown satisfies string;
runbook.data.tasks[0].detail satisfies string;

const partialSummary = toPlanSummaryResponse({ data: { tasks: [{ title: '태스크' }] } });
partialSummary.data.tasks[0].title satisfies string;
// @ts-expect-error 입력에 없던 키를 요약이 새로 보장하지 않는다.
void partialSummary.data.tasks[0].id;

function checkOptionalRunbook(payload: {
  data?: { plan?: { id: string; contentMarkdown: string } | null; tasks?: { id: string; detail: string }[] };
}) {
  const summary = toPlanSummaryResponse(payload);
  summary.data?.plan?.id satisfies string | undefined;
  summary.data?.tasks?.[0].id satisfies string | undefined;
  // @ts-expect-error 선택적·nullable 응답에서도 본문은 제외한다.
  void summary.data?.plan?.contentMarkdown;
  // @ts-expect-error 선택적 태스크 목록에서도 상세 본문은 제외한다.
  void summary.data?.tasks?.[0].detail;
}
void checkOptionalRunbook;

const readonlySummary = toPlanSummaryResponse({
  data: { tasks: [{ id: 'task-1', detail: '본문' }, null, ['그대로 통과']] },
} as const);
readonlySummary.data.tasks[0].id satisfies 'task-1';
readonlySummary.data.tasks[1] satisfies null;
readonlySummary.data.tasks[2] satisfies readonly ['그대로 통과'];
// @ts-expect-error readonly 태스크도 객체 항목의 상세 본문은 제외한다.
void readonlySummary.data.tasks[0].detail;

toPlanSummaryResponse(null) satisfies null;
toPlanSummaryResponse('그대로 통과') satisfies string;
toPlanSummaryResponse({ data: null }).data satisfies null;
toPlanSummaryResponse({ data: [] }).data satisfies never[];
toPlanSummaryResponse([{ contentMarkdown: '그대로 통과' }])[0].contentMarkdown satisfies string;
