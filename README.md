# @rlarua/agentteams-cli

[![GitHub](https://img.shields.io/badge/GitHub-rlarua%2FAgentTeams--cli-blue?logo=github)](https://github.com/rlarua/AgentTeams-cli)
[![Issues](https://img.shields.io/github/issues/rlarua/AgentTeams-cli)](https://github.com/rlarua/AgentTeams-cli/issues)

A CLI for working with the AgentTeams API from your terminal.
It supports convention sync and plan/comment/report management.

## Installation

```bash
npm install -g @rlarua/agentteams-cli
```

## Quick Start

### 1. Initialize

```bash
agentteams init
```

The `init` command:

- Opens a browser for OAuth authentication
- Creates `.agentteams/config.json`
- Optionally selects a default project repository (saved as `repositoryId` in config)
- Saves the convention template to `.agentteams/convention.md`
- Syncs convention files into `.agentteams/<category>/*.md`

In SSH/remote environments, open the URL printed in the terminal manually.

### Service URLs (Defaults and Overrides)

The CLI talks to two services:

- Web app (OAuth flow): defaults to `https://agentteams.run`

### 2. Protect Sensitive Data

`.agentteams` may contain API keys, so do not commit it to git.

```gitignore
# AgentTeams CLI config (contains API keys)
.agentteams
```

### 3. Use Conventions

```bash
agentteams convention list
agentteams convention show
agentteams convention download
agentteams convention create --file .agentteams/rules/new-rule.md
agentteams convention update --file .agentteams/rules/context.md
agentteams convention update --file .agentteams/rules/context.md --apply
agentteams convention delete --file .agentteams/rules/context.md
agentteams convention delete --file .agentteams/rules/context.md --apply
```

## Core Commands

### `init`

Initialize the CLI via OAuth and download conventions.

```bash
agentteams init
```

### `convention`

Manage project conventions.

```bash
agentteams convention list
agentteams convention show
agentteams convention download
agentteams convention create --file .agentteams/rules/new-rule.md
agentteams convention update --file .agentteams/rules/context.md
agentteams convention update --file .agentteams/rules/context.md --apply
agentteams convention delete --file .agentteams/rules/context.md
agentteams convention delete --file .agentteams/rules/context.md --apply
```

`convention download` saves files by category in `.agentteams/<category>/`.
If file names collide within the same category, suffixes like `-2`, `-3` are added.

#### `convention create`

Create a new convention.

- The input file must be under `.agentteams/<category>/*.md`, and `<category>` is inferred from the path.
- Frontmatter is optional. Supported fields: `trigger`, `description`, `title` (optional). Use `# AGENT_RULES` in the document body instead of the deprecated `agentInstruction` frontmatter field.
- After creation, the CLI immediately updates `.agentteams/conventions.manifest.json`, so you can `update/delete` the same file right away.
- Run `agentteams convention download` if you want to refresh `convention.md` and the server-normalized (downloadable) markdown.

Examples:

```bash
agentteams convention create --file .agentteams/rules/new-rule.md
```

#### `convention update` / `convention delete`

- By default, `update` and `delete` run in **dry-run** mode. They print a diff/plan and do not modify the server.
- Use `--apply` to actually update/delete the server resource.
- Only files produced by `agentteams convention download` are allowed. The CLI uses `.agentteams/conventions.manifest.json` to map local files to server conventions.

Examples:

```bash
# Preview changes (dry-run)
agentteams convention update --file .agentteams/rules/context.md

# Apply update to server
agentteams convention update --file .agentteams/rules/context.md --apply

# Preview deletion (dry-run)
agentteams convention delete --file .agentteams/rules/context.md

# Apply deletion to server
agentteams convention delete --file .agentteams/rules/context.md --apply
```

Common errors:

- `403 Forbidden`: the server rejected the operation due to missing write permissions.
- `409 Conflict`: optimistic-lock conflict (someone else updated the convention). Download again and retry.

### `sync`

Resync convention files.

```bash
agentteams sync
```

### `plan`

Manage plans.

Note: Plans are always created as `DRAFT`. Even if you pass `--status` to `plan create`, the server will ignore it. Use `plan update` to change status after creation.

```bash
agentteams plan list
agentteams plan get --id <plan-id>
agentteams plan get --id <plan-id> --include-deps --format text
agentteams plan show --id <plan-id>  # alias of get
agentteams plan status --id <plan-id>
agentteams plan set-status --id <plan-id> --status <status>

agentteams plan create \
  --title "Implement feature" \
  --content "Detailed content" \
  --type FEATURE \
  --priority HIGH

# optional checklist template for create
agentteams plan create \
  --title "Refactor module" \
  --template "refactor-minimal"

  # repository linkage
  # - `plan create` uses `.agentteams/config.json` -> `repositoryId` when present.

agentteams plan quick --title "Quick task" --content "Implemented X and verified with tests" --type CHORE
agentteams plan update --id <plan-id> --status PENDING
agentteams plan update --id <plan-id> --status IN_PROGRESS
agentteams plan assign --id <plan-id> --agent "agent-name"
agentteams plan download --id <plan-id>
agentteams plan cleanup --id <plan-id>
agentteams plan delete --id <plan-id>
```

Status values: `DRAFT`, `PENDING`, `ASSIGNED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`

Types: `FEATURE`, `BUG_FIX`, `ISSUE`, `REFACTOR`, `CHORE`

Priorities: `LOW`, `MEDIUM`, `HIGH`

Plan template values (create): `refactor-minimal`, `quick-minimal`

`plan quick` behavior:

- Creates a plan with `--content` as the plan body (`--content` or `--file` is required)
- Uses `LOW` as the default priority (override with `--priority`)
- Starts and finishes the plan in one flow
- Does not attach a completion report; use the full plan workflow for detailed reporting

`--include-deps` (get/show): also fetches dependency data and appends a `Dependencies` section in text output; in json output it adds `data.dependencies` with `blocking` and `dependents` arrays.

### `comment`

Manage plan comments.

```bash
agentteams comment list --plan-id <plan-id>

agentteams comment create \
  --plan-id <plan-id> \
  --type GENERAL \
  --content "Work completed"

agentteams comment update --id <comment-id> --content "Updated content"
agentteams comment delete --id <comment-id>
```

Types: `RISK`, `MODIFICATION`, `GENERAL`

### `dependency`

Manage plan dependencies.

```bash
agentteams dependency list --plan-id <plan-id>
agentteams dependency create --plan-id <plan-id> --blocking-plan-id <blocking-plan-id>
agentteams dependency delete --plan-id <plan-id> --dep-id <dependency-id>
```

### `agent-config`

View or delete agent configurations.

```bash
agentteams agent-config list
agentteams agent-config get --id <config-id>
agentteams agent-config delete --id <config-id>
```

### `report`

Manage completion reports.

Tip: Include reproducible verification evidence (commands + outcomes), but keep outcomes short: `pass/fail + 1–3 lines of summary`. Do not paste long raw logs into the report body.

```bash
agentteams report list

agentteams report create \
  --title "AgentTeams completion report" \
  --file ./report.md \
  --status COMPLETED

# repository linkage
# - `report create` uses `.agentteams/config.json` -> `repositoryId` when present.

# with metrics (auto + manual)
agentteams report create \
  --title "CLI metrics report" \
  --file ./report.md \
  --files-modified 5 \
  --lines-added 120 \
  --lines-deleted 30 \
  --quality-score 95

# disable git auto collection
agentteams report create \
  --title "Manual metrics report" \
  --file ./report.md \
  --no-git
```

Status values: `COMPLETED`, `FAILED`, `PARTIAL`

Metrics behavior:

- Auto-collected on `report create` (unless `--no-git`): `commitHash`, `branchName`, `filesModified`, `linesAdded`, `linesDeleted`
- Manual only: `durationSeconds`, `commitStart`, `commitEnd`, `pullRequestId`
- Manual options always override auto-collected values

### `postmortem`

Manage post mortems.

Tip: If you have platform guides downloaded under `.agentteams/platform/guides/`, prefer the template in `post-mortem-guide.md`.

```bash
agentteams postmortem list

agentteams postmortem create \
  --title "Deployment incident analysis" \
  --content "## Root cause\n- Missing configuration" \
  --action-items "Automate rollback,Pre-release checklist" \
  --status RESOLVED

# repository linkage
# - `postmortem create` uses `.agentteams/config.json` -> `repositoryId` when present.
```

Status values: `OPEN`, `IN_PROGRESS`, `RESOLVED`

### `config`

```bash
agentteams config whoami
agentteams config whoami --format text
```

`config whoami` prints current environment variable values for `AGENTTEAMS_API_KEY` and `AGENTTEAMS_API_URL`.

## Configuration

Configuration is merged in this priority order (highest first):

1. CLI options
2. Environment variables (`AGENTTEAMS_*`)
3. Project config (`.agentteams/config.json`)
4. Global config (`~/.agentteams/config.json`)

### Config File Example

```json
{
  "teamId": "team_xxx",
  "projectId": "proj_xxx",
  "repositoryId": "repo_xxx",
  "agentName": "my-agent",
  "apiKey": "key_xxx",
  "apiUrl": "https://api.agentteams.run"
}
```

### Environment Variable Example

```bash
export AGENTTEAMS_API_KEY="key_your_api_key_here"
export AGENTTEAMS_API_URL="https://api.agentteams.run"
export AGENTTEAMS_TEAM_ID="team_xxx"
export AGENTTEAMS_PROJECT_ID="proj_xxx"
export AGENTTEAMS_AGENT_NAME="my-agent"
```

## Output Format

Most resource commands support `--format json|text`.

Output behavior by default:

- `plan create|update|start|finish|quick`: prints short summary lines on stdout by default.
- `plan list|get` and other read-oriented commands: keep full output by default.
- `--verbose`: always prints full output to stdout.
- `--output-file <path>`: always writes full output to file and keeps stdout short.

Compatibility note:

- If you need full JSON on stdout for automation, pass `--format json` explicitly.

```bash
agentteams plan list --format json
agentteams plan list --format text
agentteams plan update --id <plan-id> --status IN_PROGRESS --format json
```

Note: `convention` does not support `--format`.

## Error Guide

The API may include an optional machine-readable `errorCode` in error responses:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Cross-project access denied",
  "errorCode": "CROSS_PROJECT_ACCESS_DENIED"
}
```

The CLI prioritizes `errorCode` when present and falls back to message/status-based handling for older API responses.

| Error | Meaning | Resolution |
|---|---|---|
| `401 Unauthorized` | Invalid API key | Check `apiKey` or `AGENTTEAMS_API_KEY` |
| `403 Forbidden` | No access to project | Verify `projectId` |
| `404 Not Found` | Resource does not exist | Verify ID or create the resource |
| Network error | Cannot reach server | Check `apiUrl` and server status |
| Missing config | Config file/env vars not found | Run `agentteams init` |

## License

Apache-2.0

This license applies to the CLI code distributed in this package.
Use of the AgentTeams service/API may require credentials and is governed by separate service terms/policies.
