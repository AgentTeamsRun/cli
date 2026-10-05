import type { Command } from 'commander';
export declare function addJsonResourceLeaf(parent: Command, resource: string, action: string, description: string, configure?: (command: Command) => Command, options?: {
    connection?: boolean;
    commandAction?: string;
}): Command;
//# sourceMappingURL=resource.d.ts.map