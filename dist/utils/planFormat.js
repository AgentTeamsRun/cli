export function normalizeDependencies(raw) {
    if (!raw || typeof raw !== 'object') {
        return { blocking: [], dependents: [] };
    }
    const root = raw;
    const data = (root.data && typeof root.data === 'object' && !Array.isArray(root.data))
        ? root.data
        : root;
    const blocking = Array.isArray(data.blocking) ? data.blocking : [];
    const dependents = Array.isArray(data.dependents) ? data.dependents : [];
    return { blocking, dependents };
}
export function mergePlanWithDependencies(rawPlanResponse, dependencies) {
    const fallback = {
        dependencies,
    };
    if (!rawPlanResponse || typeof rawPlanResponse !== 'object') {
        return { data: fallback };
    }
    const root = rawPlanResponse;
    const rawData = root.data;
    const planData = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? { ...rawData }
        : {};
    planData.dependencies = dependencies;
    return {
        ...root,
        data: planData,
    };
}
export function formatPlanWithDependenciesText(planData, dependencies) {
    const lines = [];
    appendLineIfExists(lines, 'id', planData.id);
    appendLineIfExists(lines, 'title', planData.title);
    appendLineIfExists(lines, 'status', planData.status);
    appendLineIfExists(lines, 'type', planData.type);
    appendLineIfExists(lines, 'priority', planData.priority);
    appendLineIfExists(lines, 'updatedAt', planData.updatedAt);
    appendLineIfExists(lines, 'createdAt', planData.createdAt);
    const ignoredKeys = new Set(['id', 'title', 'status', 'type', 'priority', 'updatedAt', 'createdAt', 'dependencies']);
    for (const [key, value] of Object.entries(planData)) {
        if (ignoredKeys.has(key) || value === null || value === undefined) {
            continue;
        }
        lines.push(`${key}: ${String(value)}`);
    }
    lines.push('---');
    lines.push('## Dependencies');
    const rendered = [
        ...dependencies.blocking.map((plan) => renderDependencyLine('BLOCKING', plan)),
        ...dependencies.dependents.map((plan) => renderDependencyLine('DEPENDENT', plan)),
    ];
    if (rendered.length === 0) {
        lines.push('No dependencies.');
    }
    else {
        lines.push(...rendered);
    }
    return lines.join('\n');
}
export function appendLineIfExists(lines, key, value) {
    if (value === null || value === undefined) {
        return;
    }
    const normalized = String(value).trim();
    if (normalized.length === 0) {
        return;
    }
    lines.push(`${key}: ${normalized}`);
}
export function renderDependencyLine(label, plan) {
    if (!plan || typeof plan !== 'object') {
        return `- [${label}] unknown`;
    }
    const target = plan;
    const id = typeof target.id === 'string' && target.id.length > 0 ? target.id : 'unknown-id';
    const title = typeof target.title === 'string' && target.title.length > 0 ? target.title : '(no title)';
    const status = typeof target.status === 'string' && target.status.length > 0 ? target.status : 'UNKNOWN';
    return `- [${label}] ${id}: ${title} (${status})`;
}
//# sourceMappingURL=planFormat.js.map