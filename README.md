# @agentteams/cli

[![GitHub](https://img.shields.io/badge/GitHub-AgentTeamsRun%2Fcli-blue?logo=github)](https://github.com/AgentTeamsRun/cli)
[![Issues](https://img.shields.io/github/issues/AgentTeamsRun/cli)](https://github.com/AgentTeamsRun/cli/issues)

A CLI for working with the AgentTeams API from your terminal.
It supports convention sync and plan/comment/report management.

## Installation

```bash
npm install -g @agentteams/cli
```

## Quick Start

### 1. Initialize

```bash
agentteams init
```

The `init` command:

- Opens a browser for OAuth authentication
- Creates `.agentteams/config.json`
- Stores `teamId`, `projectId`, `apiKey`, and a non-default `apiUrl` when needed
- Saves the convention template to `.agentteams/convention.md`
- Syncs convention files into `.agentteams/<category>/*.md`

In SSH/remote environments, open the URL printed in the terminal manually.

### Service URLs (Defaults and Overrides)

The CLI talks to two services:

- Web app (OAuth flow): defaults to `https://agentteams.run`
- API: defaults to `https://api.agentteams.run`; `init` only writes `apiUrl` when the authorized API URL is different

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

Note: Plans are always created as `BACKLOG`. Even if you pass `--status` to `plan create`, the server will ignore it. Use `plan update` to change status after creation.

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
  --complexity FULL \
  --priority HIGH

# optional checklist template for create
agentteams plan create \
  --title "Refactor module" \
  --template "refactor-minimal"

  # repository linkage
  # - `plan create` sends the current git origin URL by default.
  # - Use `--repository-remote-url <url>` to override it.

# quick log: record already-done work (creates a plan + report in one shot)
agentteams plan quick --title "Quick task" --content "Implemented X and verified with tests" --type CHORE
agentteams plan update --id <plan-id> --status TODO
agentteams plan update --id <plan-id> --status IN_PROGRESS
agentteams plan download --id <plan-id>
agentteams plan cleanup --id <plan-id>
agentteams plan delete --id <plan-id>
```

Status values: `BACKLOG`, `TODO`, `ASSIGNED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`

Types: `FEATURE`, `BUG_FIX`, `ISSUE`, `REFACTOR`, `CHORE`

Complexity: `MINIMAL`, `STANDARD`, `FULL` — required for `plan create` (`--complexity`). MINIMAL = 1 task / 1–2 files / single domain; STANDARD = 2–3 tasks / known scope; FULL = 4+ tasks, multi-wave, or risk signals (schema/auth/billing/quota/deployment, cross-workspace, large diff, unfamiliar domain). Changing complexity on update (`--complexity` with optional `--complexity-reason`) records a `MODIFICATION` comment.

Priorities: `LOW`, `MEDIUM`, `HIGH`

Plan template values (create): `refactor-minimal`, `quick-minimal`

`plan quick` (quick log) behavior — the path for recording work you already finished without a pre-existing plan:

- Creates a plan with `--content` as the plan body (`--content` or `--file` is required)
- Uses `LOW` as the default priority (override with `--priority`)
- Defaults to `MINIMAL` complexity (override with `--complexity`)
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

A completion report is always tied to a plan, so `report create` **requires `--plan-id`** — there is no standalone (plan-less) report. To record work you already finished without a pre-existing plan, use a quick log (`agentteams plan quick`) instead.

Tip: Include reproducible verification evidence (commands + outcomes), but keep outcomes short: `pass/fail + 1–3 lines of summary`. Do not paste long raw logs into the report body.

```bash
agentteams report list

agentteams report create \
  --plan-id <plan-id> \
  --title "AgentTeams completion report" \
  --file ./report.md \
  --status COMPLETED

# repository linkage
# - `report create` sends the current git origin URL by default.
# - Use `--repository-remote-url <url>` to override it.

# with metrics (auto + manual)
agentteams report create \
  --plan-id <plan-id> \
  --title "CLI metrics report" \
  --file ./report.md \
  --files-modified 5 \
  --lines-added 120 \
  --lines-deleted 30 \
  --quality-score 95

# disable git auto collection
agentteams report create \
  --plan-id <plan-id> \
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
# - `postmortem create` sends the current git origin URL by default.
# - Use `--repository-remote-url <url>` to override it.
```

Status values: `OPEN`, `IN_PROGRESS`, `RESOLVED`

### `search`

Search across all entity types in a project.

```bash
# Basic search
agentteams search --query "login feature"

# Filter by entity types
agentteams search --query "auth" --types PLAN,CO_ACTION

# Limit results and token budget (useful for agents)
agentteams search --query "deployment" --limit 5 --max-tokens 4000

# JSON output for automation
agentteams search --query "refactor" --format json
```

Searchable entity types: `PLAN`, `CO_ACTION`, `COMPLETION_REPORT`, `POST_MORTEM`, `CONVENTION`

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
  "apiKey": "key_xxx"
}
```

`apiUrl` is omitted for the default API. When `init` is completed against a non-default API
such as dev, self-hosted, or localhost, the CLI persists that `apiUrl` so later commands keep
using the same API.

### Environment Variable Example

```bash
export AGENTTEAMS_API_KEY="key_your_api_key_here"
export AGENTTEAMS_API_URL="https://api.agentteams.run"
export AGENTTEAMS_TEAM_ID="team_xxx"
export AGENTTEAMS_PROJECT_ID="proj_xxx"
```

## Output Format

Most resource commands support `--format json|text`.

Output behavior by default:

- `plan create|update|start|finish|quick`: prints short summary lines on stdout by default.
- `report|postmortem|coaction create|update` and `document create|update`: print short meta-only summary lines by default (the full record body — e.g. the document content — is **not** echoed to stdout).
- `plan list|get` and other read-oriented commands: keep full output by default.
- `--verbose`: always prints full output to stdout.
- `--format json` (explicit): prints the full structured result, keeping existing automation consumers intact.
- `--output-file <path>`: always writes full output to file and keeps stdout short.

### Prefixed entity IDs

Entity references copied from the AgentTeams web UI carry a type prefix (e.g. `agentteams_pln_<uuid>`). Any `--id`/`--plan-id`/`--completion-report-id`/etc. value is normalized to its bare id automatically, so you can paste a prefixed id directly:

```bash
agentteams plan get --id agentteams_pln_f62762fc-730a-4201-8586-e2541505ed1b
# resolves to plan f62762fc-730a-4201-8586-e2541505ed1b
```

### Legacy V1 Plan HTML Preview

V2 plans render structured sections and tasks directly in the web UI and do not display uploaded HTML previews. Do not pass `--html-file` or `--html-stdin` for V2 plan workflows.

The optional HTML inputs and standalone `plan upload-html` action remain for legacy V1 plans that expose the visualization tab:

```bash
agentteams plan upload-html \
  --id <plan-id> \
  --file .agentteams/cli/temp/plan-summary.html
```

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

| Error              | Meaning                        | Resolution                             |
| ------------------ | ------------------------------ | -------------------------------------- |
| `401 Unauthorized` | Invalid API key                | Check `apiKey` or `AGENTTEAMS_API_KEY` |
| `403 Forbidden`    | No access to project           | Verify `projectId`                     |
| `404 Not Found`    | Resource does not exist        | Verify ID or create the resource       |
| Network error      | Cannot reach server            | Check `apiUrl` and server status       |
| Missing config     | Config file/env vars not found | Run `agentteams init`                  |

## License

Apache-2.0

This license applies to the CLI code distributed in this package.
Use of the AgentTeams service/API may require credentials and is governed by separate service terms/policies.
