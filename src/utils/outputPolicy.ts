export type OutputFormat = 'json' | 'text';

export interface OutputPolicyContext {
  resource?: string;
  action?: string;
  format: OutputFormat;
  formatExplicit?: boolean;
  outputFile?: string;
  verbose?: boolean;
}

export interface SummaryHints {
  bodyChanged?: boolean;
}

export const SUMMARY_HINTS = Symbol.for('agentteams.cli.summaryHints');

export function attachSummaryHints<T>(result: T, hints: SummaryHints): T {
  if (!result || typeof result !== 'object') return result;
  Object.defineProperty(result as object, SUMMARY_HINTS, {
    value: hints,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return result;
}

const summaryDefaultActions: Record<string, Set<string>> = {
  plan: new Set(['create', 'update', 'start', 'finish']),
  report: new Set(['create', 'update']),
  postmortem: new Set(['create', 'update']),
  coaction: new Set(['create', 'update']),
  linear: new Set(['comment-create']),
};

type HintEntry =
  | string
  | ((context: { hints: SummaryHints | undefined }) => string | undefined);

const nextActionHints: Record<string, Record<string, HintEntry[]>> = {
  plan: {
    create: [
      'Next: agentteams plan start --id <id>',
      'Next: agentteams plan upload-html --id <id> --file <html-file>  # upload an HTML preview that summarizes the plan body',
    ],
    update: [
      ({ hints }) => hints?.bodyChanged
        ? 'Next: agentteams plan upload-html --id <id> --file <html-file>  # plan body changed; regenerate and upload the HTML preview'
        : undefined,
    ],
    finish: ['Next: agentteams report create --plan-id <id>'],
  },
};

export function shouldPrintSummary(context: OutputPolicyContext): boolean {
  if (context.verbose) return false;

  if (typeof context.outputFile === 'string' && context.outputFile.trim().length > 0) {
    return true;
  }

  if (!context.resource || !context.action) return false;

  if (context.format === 'json' && context.formatExplicit) {
    return false;
  }

  const actions = summaryDefaultActions[context.resource];
  if (!actions) return false;
  return actions.has(context.action);
}

export function createSummaryLines(result: unknown, context: Pick<OutputPolicyContext, 'resource' | 'action'>): string[] {
  const lines: string[] = [];

  const message = extractString(result, 'message');
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
  context: Pick<OutputPolicyContext, 'resource' | 'action'>
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

  const hints = readSummaryHints(result);
  const lines: string[] = [];
  for (const entry of entries) {
    const template = typeof entry === 'function' ? entry({ hints }) : entry;
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

function readSummaryHints(result: unknown): SummaryHints | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = (result as Record<symbol, unknown>)[SUMMARY_HINTS];
  if (!value || typeof value !== 'object') return undefined;
  return value as SummaryHints;
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
