import type { Config } from "../types/index.js";
type ConventionCommandOptions = {
    cwd?: string;
    config?: Config;
};
type ConventionUploadOptions = ConventionCommandOptions & {
    file: string | string[];
    apply?: boolean;
};
type ConventionDeleteOptions = ConventionCommandOptions & {
    file: string | string[];
    apply?: boolean;
};
type ConventionCreateOptions = ConventionCommandOptions & {
    file: string | string[];
};
export type ConventionFreshnessChange = {
    id: string;
    type: "new" | "updated" | "deleted";
    title?: string;
    fileName?: string;
};
export type ConventionFreshnessResult = {
    platformGuidesChanged: boolean;
    conventionChanges: ConventionFreshnessChange[];
};
export declare function conventionShow(): Promise<any>;
export declare function checkConventionFreshness(apiUrl: string, projectId: string, headers: Record<string, string>, projectRoot: string): Promise<ConventionFreshnessResult>;
export declare function conventionList(): Promise<any>;
export declare function conventionDownload(options?: ConventionCommandOptions): Promise<string>;
export declare function conventionCreate(options: ConventionCreateOptions): Promise<string>;
export declare function conventionUpdate(options: ConventionUploadOptions): Promise<string>;
export declare function conventionDelete(options: ConventionDeleteOptions): Promise<string>;
export {};
//# sourceMappingURL=convention.d.ts.map