export function normalizeDependencies(raw) {
    if (!raw || typeof raw !== 'object') {
        return { blocking: [], dependents: [] };
    }
    const root = raw;
    const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
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
//# sourceMappingURL=planFormat.js.map