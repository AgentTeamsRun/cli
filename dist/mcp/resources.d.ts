import type { McpToolContext } from './context.js';
/**
 * SDK-agnostic resource-template description. The handler receives the URI
 * template variables and returns the matching tool payload; only the SDK adapter
 * (`server.ts`) may build `ResourceTemplate` instances or the `contents`
 * envelope. Entity-specific tool projections still apply, so document reads
 * omit the derived editor-only `bodyTiptap` mirror.
 */
export interface McpResourceSpec {
    name: string;
    toolName: string;
    uriTemplate: string;
    title: string;
    description: string;
    handler: (variables: Record<string, string>, context: McpToolContext) => Promise<unknown>;
}
/** The three single-entity URI templates. Full enumeration is intentionally not offered. */
export declare function getResourceSpecs(): McpResourceSpec[];
//# sourceMappingURL=resources.d.ts.map