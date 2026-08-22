/**
 * Resolve a path through the platform-native filesystem implementation.
 *
 * On Windows, Git can report a long path while Node inherits the equivalent
 * 8.3 short path from the environment. The native realpath implementation
 * expands both spellings to the same filesystem path, which makes repository
 * boundary checks deterministic.
 */
export declare function canonicalizePath(path: string): string;
export declare function isSamePath(left: string, right: string): boolean;
//# sourceMappingURL=path.d.ts.map