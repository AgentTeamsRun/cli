/** One page of `GET /skills`. File bodies are **not** included — only metadata and hashes. */
export declare function listSkills(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
/** Single skill metadata envelope (`GET /skills/:id`). */
export declare function getSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string): Promise<any>;
/** The whole package including file bodies (`GET /skills/:id/download`). */
export declare function downloadSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string): Promise<any>;
export declare function createSkill(apiUrl: string, projectId: string, headers: Record<string, string>, body: {
    slug: string;
    files: {
        relativePath: string;
        content: string;
    }[];
    repositoryId?: string;
    scope?: string;
}): Promise<any>;
export declare function updateSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, body: {
    files: {
        relativePath: string;
        content: string;
    }[];
    updatedAt: string;
    scope?: string;
}): Promise<any>;
export declare function deleteSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string): Promise<any>;
//# sourceMappingURL=skill.d.ts.map