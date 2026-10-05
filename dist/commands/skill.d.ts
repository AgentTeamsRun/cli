import { SKILL_ENTRY_FILE, SKILL_PACKAGE_DIR, SkillPackageError, validateSkillPackageFiles } from '../utils/skillPackage.js';
type SkillOptions = Record<string, any>;
export declare function executeSkillCommand(apiUrl: string, projectId: string, headers: Record<string, string>, action: string, options?: SkillOptions): Promise<any>;
export { SKILL_ENTRY_FILE, SKILL_PACKAGE_DIR, SkillPackageError, validateSkillPackageFiles };
//# sourceMappingURL=skill.d.ts.map