#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createProgram } from './program/index.js';
import { compareVersions, formatUpdateMessage, readCache, startUpdateCheck } from './utils/updateCheck.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const program = createProgram(pkg.version);
startUpdateCheck(pkg.version);
program.parse();
process.on('beforeExit', () => {
    const cache = readCache();
    if (cache && compareVersions(pkg.version, cache.latestVersion)) {
        process.stderr.write(formatUpdateMessage(pkg.version, cache.latestVersion));
    }
});
//# sourceMappingURL=index.js.map