export declare function buildFreshnessNoticeLines(freshness: {
    platformGuidesChanged: boolean;
    conventionChanges: Array<{
        type: 'new' | 'updated' | 'deleted';
        title?: string;
        fileName?: string;
        id: string;
    }>;
}): string[];
export declare function buildUniquePlanRunbookFileName(title: string, planId: string, existingFileNames: string[]): string;
export declare function executePlanCommand(apiUrl: string, projectId: string, headers: any, action: string, options: any): Promise<any>;
//# sourceMappingURL=plan.d.ts.map