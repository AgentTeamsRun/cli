export declare function normalizeDependencies(raw: unknown): {
    blocking: any[];
    dependents: any[];
};
export declare function mergePlanWithDependencies(rawPlanResponse: unknown, dependencies: {
    blocking: any[];
    dependents: any[];
}): {
    data: Record<string, unknown>;
};
//# sourceMappingURL=planFormat.d.ts.map