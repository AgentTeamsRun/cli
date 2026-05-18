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
export declare function formatPlanWithDependenciesText(planData: Record<string, unknown>, dependencies: {
    blocking: any[];
    dependents: any[];
}): string;
export declare function appendLineIfExists(lines: string[], key: string, value: unknown): void;
export declare function renderDependencyLine(label: 'BLOCKING' | 'DEPENDENT', plan: unknown): string;
//# sourceMappingURL=planFormat.d.ts.map