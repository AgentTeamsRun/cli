export interface ResolvedSpawnSpec {
    executable: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
}
/**
 * Wrap Windows `.cmd`/`.bat` and `.ps1` shims in `cmd.exe` / `powershell.exe`
 * with `shell: false` so Node never rejects them with EINVAL and callers
 * never expose arguments to blanket shell word-splitting.
 */
export declare function resolveWindowsShimSpawn(executable: string, args: readonly string[], env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): ResolvedSpawnSpec;
//# sourceMappingURL=windowsShim.d.ts.map