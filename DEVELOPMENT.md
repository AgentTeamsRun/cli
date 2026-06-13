# AgentTeams CLI - Development Guide

This guide is for contributors and developers who want to work on the CLI itself.

## Prerequisites

- Node.js 24+
- npm 10+
- Access to a running AgentTeams API server

## Local Setup

### 1. Prepare API Endpoint

Use an available AgentTeams API endpoint for local development.

Default local endpoint example: `http://localhost:3001`

### 2. Install CLI Dependencies

```bash
npm install
```

### 3. Set Local Environment

Create a `.env` file or export environment variables:

```bash
export AGENTTEAMS_API_URL="http://localhost:3001"
export AGENTTEAMS_WEB_URL="http://localhost:3000"  # For OAuth init flow
export AGENTTEAMS_API_KEY="dev-test-key"  # Optional for testing
```

Or create `cli/.env`:

```env
AGENTTEAMS_API_URL=http://localhost:3001
AGENTTEAMS_WEB_URL=http://localhost:3000
```

### 4. Build and Run

```bash
# Build TypeScript
npm run build

# Run locally
node dist/index.js --help

# Or link for global testing
npm link
agentteams --help
```

## Development Workflow

### Running Tests

```bash
npm test
```

### Type Checking

```bash
npm run build  # TypeScript will check types during build
```

### Testing Commands

```bash
# Test init command
node dist/index.js init

# Test with local config
node dist/index.js status list --format text

# Test with environment variable override
AGENTTEAMS_API_URL=http://localhost:3001 node dist/index.js config whoami
```

## Configuration Priority (Development)

When developing, you can override config with environment variables:

1. **CLI options** (command-line arguments)
2. **Environment variables** (`AGENTTEAMS_*`) ← Use this for local testing
3. **Project config** (`.agentteams/config.json`)
4. **Global config** (`~/.agentteams/config.json`)

### Example: Testing with Different API URLs

```bash
# Test against local server
AGENTTEAMS_API_URL=http://localhost:3001 \
AGENTTEAMS_WEB_URL=http://localhost:3000 \
node dist/index.js status list

# Test init with local web
AGENTTEAMS_WEB_URL=http://localhost:3000 node dist/index.js init

# Test against production
AGENTTEAMS_API_URL=https://api.agentteams.run \
AGENTTEAMS_WEB_URL=https://agentteams.run \
node dist/index.js status list
```

## Project Structure

```
cli/
├── src/
│   ├── commands/       # Command implementations
│   │   ├── init.ts
│   │   ├── convention.ts
│   │   ├── agentConfig.ts
│   │   └── index.ts    # Command router
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utilities
│   │   ├── config.ts   # Config loading/merging
│   │   ├── authServer.ts  # OAuth local server
│   │   └── errors.ts   # Error handling
│   └── index.ts        # CLI entry point
├── test/               # Integration tests
├── dist/               # Compiled JavaScript (gitignored)
├── package.json
├── tsconfig.json
├── README.md           # User-facing documentation (for npm)
└── DEVELOPMENT.md      # This file (for contributors)
```

## Common Development Tasks

### Adding a New Command

1. Create command file in `src/commands/`:

   ```typescript
   // src/commands/myCommand.ts
   export async function myCommand(config: Config) {
     // Implementation
   }
   ```

2. Add route in `src/commands/index.ts`
3. Register in `src/index.ts`:
   ```typescript
   program
     .command('my-command')
     .description('...')
     .action(async () => {
       // ...
     });
   ```

### Debugging API Calls

Enable verbose logging:

```bash
# Add console.log in src/commands/index.ts or use a debugger
node --inspect dist/index.js status list
```

### Testing OAuth Flow

OAuth `init` command requires:

- Local API server running at `http://localhost:3001`
- Available port for OAuth callback (default: 7777)

```bash
node dist/index.js init
# Browser will open for authentication
```

## Publishing (Maintainers Only)

See `README.md` in this repository for install and usage details.

For development testing, use `npm link` instead of publishing:

```bash
npm link
agentteams --version  # Should show current version from package.json
```

## Troubleshooting

### "Cannot connect to server"

Check if local API is running:

```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok"}
```

### "Config not found"

The CLI looks for config in this order:

1. `.agentteams/config.json` (current dir or parent dirs)
2. `~/.agentteams/config.json` (global)
3. Environment variables

For development, use environment variables:

```bash
export AGENTTEAMS_API_URL=http://localhost:3001
export AGENTTEAMS_API_KEY=test-key
```

### TypeScript errors after changes

Rebuild:

```bash
npm run build
```

## Contributing

1. Create a feature branch
2. Make changes
3. Run tests: `npm test`
4. Build: `npm run build`
5. Test manually with `node dist/index.js`
6. Commit with conventional commit messages
7. Open a pull request

## Questions?

- Check `README.md` for overall CLI usage and configuration
- Confirm your API endpoint is reachable and correctly configured in environment variables
- Open an issue on GitHub
