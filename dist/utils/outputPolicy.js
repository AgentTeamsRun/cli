const summaryDefaultActions = {
    plan: new Set(['create', 'update', 'start', 'finish']),
    report: new Set(['create', 'update']),
    postmortem: new Set(['create', 'update']),
    coaction: new Set(['create', 'update']),
    linear: new Set(['comment-create']),
};
const nextActionHints = {
    plan: {
        create: 'Next: agentteams plan start --id <id>',
        finish: 'Next: agentteams report create --plan-id <id>',
    },
};
export function shouldPrintSummary(context) {
    if (context.verbose)
        return false;
    if (typeof context.outputFile === 'string' && context.outputFile.trim().length > 0) {
        return true;
    }
    if (!context.resource || !context.action)
        return false;
    if (context.format === 'json' && context.formatExplicit) {
        return false;
    }
    const actions = summaryDefaultActions[context.resource];
    if (!actions)
        return false;
    return actions.has(context.action);
}
export function createSummaryLines(result, context) {
    const lines = [];
    const message = extractString(result, 'message');
    if (message) {
        lines.push(message);
    }
    else {
        const resource = context.resource ?? 'command';
        const action = context.action ?? 'run';
        lines.push(`Success: ${resource} ${action}`);
    }
    const id = extractString(result, 'id');
    const title = extractString(result, 'title');
    const count = extractCount(result);
    if (id && title) {
        lines.push(`id: ${id}, title: ${title}`);
    }
    else if (id) {
        lines.push(`id: ${id}`);
    }
    else if (title) {
        lines.push(`title: ${title}`);
    }
    else if (typeof count === 'number') {
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
    const hint = resolveNextActionHint(id, result, context);
    if (hint) {
        lines.push(hint);
    }
    return lines;
}
function resolveNextActionHint(id, result, context) {
    if (!context.resource || !context.action)
        return undefined;
    // plan finish: completionReport가 이미 생성된 경우 힌트 표시 안 함
    if (context.resource === 'plan' && context.action === 'finish') {
        const cr = extractCompletionReportFromResult(result);
        if (cr !== null && cr !== undefined)
            return undefined;
    }
    const actionMap = nextActionHints[context.resource];
    function extractCompletionReportFromResult(result) {
        if (!result || typeof result !== 'object')
            return undefined;
        const data = result.data;
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return undefined;
        const dataObj = data;
        if (!('completionReport' in dataObj))
            return undefined;
        const cr = dataObj.completionReport;
        if (cr === null)
            return null;
        if (typeof cr === 'object' && !Array.isArray(cr))
            return cr;
        return undefined;
    }
    if (!actionMap)
        return undefined;
    const template = actionMap[context.action];
    if (!template)
        return undefined;
    const resolvedId = id ?? extractDeepId(result);
    if (!resolvedId)
        return undefined;
    return template.replace('<id>', resolvedId);
}
function extractDeepId(result) {
    if (!result || typeof result !== 'object')
        return undefined;
    const obj = result;
    const data = obj.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const dataObj = data;
    for (const value of Object.values(dataObj)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const nested = value;
            const nestedData = nested.data;
            if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
                const id = nestedData.id;
                if (typeof id === 'string' && id.length > 0)
                    return id;
            }
        }
    }
    return undefined;
}
function extractTopLevelString(result, key) {
    if (!result || typeof result !== 'object')
        return undefined;
    const value = result[key];
    if (typeof value === 'string' && value.length > 0)
        return value;
    return undefined;
}
function extractCandidate(result) {
    if (!result || typeof result !== 'object')
        return undefined;
    const obj = result;
    const data = obj.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data;
    }
    return obj;
}
function extractString(result, key) {
    const candidate = extractCandidate(result);
    if (!candidate)
        return undefined;
    const value = candidate[key];
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    return undefined;
}
function extractCount(result) {
    if (!result || typeof result !== 'object')
        return undefined;
    const obj = result;
    if (Array.isArray(obj.data)) {
        return obj.data.length;
    }
    const candidate = extractCandidate(result);
    if (!candidate)
        return undefined;
    const nestedData = candidate.data;
    if (Array.isArray(nestedData)) {
        return nestedData.length;
    }
    return undefined;
}
//# sourceMappingURL=outputPolicy.js.map