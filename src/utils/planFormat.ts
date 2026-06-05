export function normalizeDependencies(raw: unknown): { blocking: any[]; dependents: any[] } {
  if (!raw || typeof raw !== 'object') {
    return { blocking: [], dependents: [] };
  }

  const root = raw as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' && !Array.isArray(root.data))
    ? (root.data as Record<string, unknown>)
    : root;

  const blocking = Array.isArray(data.blocking) ? data.blocking : [];
  const dependents = Array.isArray(data.dependents) ? data.dependents : [];

  return { blocking, dependents };
}

export function mergePlanWithDependencies(
  rawPlanResponse: unknown,
  dependencies: { blocking: any[]; dependents: any[] }
): { data: Record<string, unknown> } {
  const fallback: Record<string, unknown> = {
    dependencies,
  };

  if (!rawPlanResponse || typeof rawPlanResponse !== 'object') {
    return { data: fallback };
  }

  const root = rawPlanResponse as Record<string, unknown>;
  const rawData = root.data;
  const planData =
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? { ...(rawData as Record<string, unknown>) }
      : {};

  planData.dependencies = dependencies;

  return {
    ...root,
    data: planData,
  } as { data: Record<string, unknown> };
}
