export type PlanPreviewHtmlSafetyResult = {
    ok: true;
} | {
    ok: false;
    reasons: string[];
};
export declare const validatePlanPreviewHtmlSafety: (html: string) => PlanPreviewHtmlSafetyResult;
//# sourceMappingURL=planPreviewHtmlSafety.d.ts.map