export type OutputFormat = 'json' | 'text';
export interface OutputPolicyContext {
    resource?: string;
    action?: string;
    format: OutputFormat;
    formatExplicit?: boolean;
    outputFile?: string;
    verbose?: boolean;
}
export declare function shouldPrintSummary(context: OutputPolicyContext): boolean;
export declare function createSummaryLines(result: unknown, context: Pick<OutputPolicyContext, 'resource' | 'action'>): string[];
//# sourceMappingURL=outputPolicy.d.ts.map