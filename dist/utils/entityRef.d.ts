/**
 * How a resolved reference is delivered back to the caller.
 *
 * - `file`       body-bearing AgentTeams entity → downloaded to a local `.md`
 * - `record`     structured record → returned inline as JSON
 * - `localFile`  the reference already carries a local path → read it directly
 * - `external`   non-AgentTeams system → url / suggested command only
 */
export type EntityRefKind = 'file' | 'record' | 'localFile' | 'external';
export interface EntityRefDescriptor {
    /** Reference token type, exactly as it is serialized into markdown. */
    refType: string;
    /**
     * Short code inside the canonical `agentteams_<code>_` id prefix, used to
     * infer the type back from a bare prefixed id. Absent for external markers,
     * whose ids never carry an AgentTeams prefix.
     */
    prefixCode?: string;
    kind: EntityRefKind;
    /** Reference points at a system outside AgentTeams (no prefix normalization). */
    external?: boolean;
    /** Equivalent command for older CLIs that do not ship `resolve`. */
    resolver: string;
}
export interface ParsedEntityRef {
    /** Input as received, after trimming. */
    raw: string;
    /** Link text, when the input was a whole `[label](target)` markdown link. */
    label?: string;
    refType: string;
    /** Bare id (AgentTeams prefix stripped) or, for external markers, the locator. */
    id: string;
    kind: EntityRefKind;
    external: boolean;
    /** Parent id of a sub-entity reference (`codeReview:R:F`, `plan:P:T`). */
    parentId?: string;
    /** Local file path carried by a `convention:id:path` reference. */
    path?: string;
    /** Equivalent command for older CLIs that do not ship `resolve`. */
    fallbackCommand: string;
    /** Web URL of an external reference, when it can be derived from the locator. */
    url?: string;
    /** CLI command that fetches an external reference (`gh`/`glab`). */
    suggestedCommand?: string;
}
export declare const SUPPORTED_REF_FORMS: string;
/**
 * Parse an entity reference token into the type, bare id, and resolution kind.
 * Pure: no filesystem, no network.
 */
export declare function parseEntityRef(input: string): ParsedEntityRef;
//# sourceMappingURL=entityRef.d.ts.map