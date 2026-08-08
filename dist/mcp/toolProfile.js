import { TOOL_PROFILES } from '@agentteams/context-tools';
export function parseToolProfile(value) {
    if (value === undefined || value === null || value === '')
        return 'full';
    if (typeof value === 'string' && TOOL_PROFILES.some((profile) => profile === value))
        return value;
    throw new Error(`Unsupported tool profile: ${String(value)}. Use ${TOOL_PROFILES.join(', ')}.`);
}
//# sourceMappingURL=toolProfile.js.map