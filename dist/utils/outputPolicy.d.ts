export type OutputFormat = 'json';
/**
 * 요약 라인 문구는 resource/action에만 의존합니다. 요약을 출력할지 말지는
 * printCommandResult가 --output-file 유무로 결정하므로 여기에는 그 축이 없습니다.
 */
export interface SummaryContext {
    resource?: string;
    action?: string;
}
export declare function createSummaryLines(result: unknown, context: SummaryContext): string[];
//# sourceMappingURL=outputPolicy.d.ts.map