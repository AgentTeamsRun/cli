import { Command } from './shared.js';
/**
 * 액션 인벤토리: list/get/create/update/delete/download/cleanup/takeaway-list/takeaway-create/takeaway-update/takeaway-delete/history/link-plan/unlink-plan/link-completion-report/unlink-completion-report/link-post-mortem/unlink-post-mortem.
 * 각 leaf는 handler가 읽는 옵션만 선언하며 --limit 별칭은 제거합니다.
 */
export declare function registerCoactionCommand(program: Command): void;
//# sourceMappingURL=coaction.d.ts.map