export declare function listCoActions(apiUrl: string, projectId: string, headers: any, params?: Record<string, string | number>): Promise<any>;
export declare function getCoAction(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function createCoAction(apiUrl: string, projectId: string, headers: any, body: Record<string, unknown>): Promise<any>;
export declare function updateCoAction(apiUrl: string, projectId: string, headers: any, id: string, body: Record<string, unknown>): Promise<any>;
export declare function deleteCoAction(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function listCoActionTakeaways(apiUrl: string, projectId: string, headers: any, coActionId: string, params?: Record<string, string | number>): Promise<any>;
export declare function createCoActionTakeaway(apiUrl: string, projectId: string, headers: any, coActionId: string, body: Record<string, unknown>): Promise<any>;
export declare function updateCoActionTakeaway(apiUrl: string, projectId: string, headers: any, coActionId: string, takeawayId: string, body: Record<string, unknown>): Promise<any>;
export declare function deleteCoActionTakeaway(apiUrl: string, projectId: string, headers: any, coActionId: string, takeawayId: string): Promise<any>;
export declare function listCoActionHistories(apiUrl: string, projectId: string, headers: any, coActionId: string, params?: Record<string, string | number>): Promise<any>;
export declare function linkPlanToCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, planId: string): Promise<any>;
export declare function unlinkPlanFromCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, planId: string): Promise<any>;
export declare function linkCompletionReportToCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, completionReportId: string): Promise<any>;
export declare function unlinkCompletionReportFromCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, completionReportId: string): Promise<any>;
export declare function linkPostMortemToCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, postMortemId: string): Promise<any>;
export declare function unlinkPostMortemFromCoAction(apiUrl: string, projectId: string, headers: any, coActionId: string, postMortemId: string): Promise<any>;
//# sourceMappingURL=coaction.d.ts.map