export type SchedulePagination = {
    page?: number;
    pageSize?: number;
};
export declare function listSchedules(apiUrl: string, projectId: string, headers: Record<string, string>, params: SchedulePagination): Promise<unknown>;
export declare function getSchedule(apiUrl: string, projectId: string, headers: Record<string, string>, id: string): Promise<unknown>;
export declare function listScheduleRuns(apiUrl: string, projectId: string, headers: Record<string, string>, id: string, params: SchedulePagination): Promise<unknown>;
//# sourceMappingURL=schedule.d.ts.map