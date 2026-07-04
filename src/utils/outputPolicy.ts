export type OutputFormat = 'json';

export interface OutputPolicyContext {
  resource?: string;
  action?: string;
  format: OutputFormat;
  formatExplicit?: boolean;
  outputFile?: string;
  verbose?: boolean;
}

const summaryDefaultActions: Record<string, Set<string>> = {
  plan: new Set(['create', 'update', 'start', 'finish']),
  task: new Set(['start', 'finish']),
  report: new Set(['create', 'update']),
  postmortem: new Set(['create', 'update']),
  coaction: new Set(['create', 'update']),
  // document create/update echo the full body in their response; keep stdout
  // meta-only by default so agents are not flooded with the document content.
  document: new Set(['create', 'update']),
  linear: new Set(['comment-create']),
};

const nextActionHints: Record<string, Record<string, string[]>> = {
  plan: {
    create: ['Next: agentteams plan start --id <id>'],
    finish: ['Next: agentteams report create --plan-id <id>'],
  },
};

export function shouldPrintSummary(context: OutputPolicyContext): boolean {
  if (context.verbose) return false;

  if (typeof context.outputFile === 'string' && context.outputFile.trim().length > 0) {
    return true;
  }

  if (!context.resource || !context.action) return false;

  if (context.formatExplicit) {
    return false;
  }

  const actions = summaryDefaultActions[context.resource];
  if (!actions) return false;
  return actions.has(context.action);
}

export function createSummaryLines(
  result: unknown,
  context: Pick<OutputPolicyContext, 'resource' | 'action'>,
): string[] {
  const lines: string[] = [];

  // Commands attach a human-readable `message` at the top level (alongside the
  // nested `data` payload), so prefer that before the nested candidate.
  const message = extractTopLevelString(result, 'message') ?? extractString(result, 'message');
  if (message) {
    lines.push(message);
  } else {
    const resource = context.resource ?? 'command';
    const action = context.action ?? 'run';
    lines.push(`Success: ${resource} ${action}`);
  }

  const id = extractString(result, 'id');
  const title = extractString(result, 'title');
  const count = extractCount(result);

  if (id && title) {
    lines.push(`id: ${id}, title: ${title}`);
  } else if (id) {
    lines.push(`id: ${id}`);
  } else if (title) {
    lines.push(`title: ${title}`);
  } else if (typeof count === 'number') {
    lines.push(`count: ${count}`);
  }

  const webUrl = extractString(result, 'webUrl');
  if (webUrl) {
    lines.push(`webUrl: ${webUrl}`);
  }

  const planWebUrl = extractTopLevelString(result, 'planWebUrl');
  if (planWebUrl) {
    lines.push(`planWebUrl: ${planWebUrl}`);
  }

  const hintLines = resolveNextActionHints(id, result, context);
  for (const hintLine of hintLines) {
    lines.push(hintLine);
  }

  return lines;
}

function resolveNextActionHints(
  id: string | undefined,
  result: unknown,
  context: Pick<OutputPolicyContext, 'resource' | 'action'>,
): string[] {
  if (!context.resource || !context.action) return [];

  if (context.resource === 'plan' && context.action === 'finish') {
    const cr = extractCompletionReportFromResult(result);
    if (cr !== null && cr !== undefined) return [];
  }

  const actionMap = nextActionHints[context.resource];
  if (!actionMap) return [];
  const entries = actionMap[context.action];
  if (!entries) return [];

  const resolvedId = id ?? extractDeepId(result);
  if (!resolvedId) return [];

  const lines: string[] = [];
  for (const template of entries) {
    if (!template) continue;
    lines.push(template.replace('<id>', resolvedId));
  }
  return lines;
}

function extractCompletionReportFromResult(result: unknown): Record<string, unknown> | null | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const dataObj = data as Record<string, unknown>;
  if (!('completionReport' in dataObj)) return undefined;
  const cr = dataObj.completionReport;
  if (cr === null) return null;
  if (typeof cr === 'object' && !Array.isArray(cr)) return cr as Record<string, unknown>;
  return undefined;
}

function extractDeepId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;
  const data = obj.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const dataObj = data as Record<string, unknown>;
  for (const value of Object.values(dataObj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const nestedData = nested.data;
      if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
        const id = (nestedData as Record<string, unknown>).id;
        if (typeof id === 'string' && id.length > 0) return id;
      }
    }
  }
  return undefined;
}

function extractTopLevelString(result: unknown, key: string): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = (result as Record<string, unknown>)[key];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function extractCandidate(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;
  const data = obj.data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  return obj;
}

function extractString(result: unknown, key: string): string | undefined {
  const candidate = extractCandidate(result);
  if (!candidate) return undefined;
  const value = candidate[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function extractCount(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;

  if (Array.isArray(obj.data)) {
    return obj.data.length;
  }

  const candidate = extractCandidate(result);
  if (!candidate) return undefined;

  const nestedData = candidate.data;
  if (Array.isArray(nestedData)) {
    return nestedData.length;
  }

  return undefined;
}
