type ScheduleContext = {
    apiUrl: string;
    projectId: string;
    headers: Record<string, string>;
};
export declare function executeScheduleCommand(action: string, options: Record<string, unknown>, withContext: (operation: (context: ScheduleContext) => Promise<unknown>) => Promise<unknown>): Promise<unknown>;
export {};
//# sourceMappingURL=schedule.d.ts.map