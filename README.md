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

### Choosing a login method

The browser callback is always the default. Nothing is auto-detected — you pick a
method by what you type.

| Situation                                                    | What to run                                                             | How it authenticates                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Local machine with a browser (default)                       | `agentteams init` / `agentteams auth login`                             | The browser calls back to a temporary port on **this** machine                |
| Remote or headless shell (SSH, container, WSL, no `DISPLAY`) | `agentteams init --device-auth` / `agentteams auth login --device-auth` | A short code you approve in a browser on **any other** device — no local port |
| CI and unattended automation                                 | `AGENTTEAMS_API_KEY`, or a project service token                        | No human approval step at all                                                 |

> The default path opens a local port and waits for the browser to call back. Over
> SSH the browser runs on your laptop, so the callback reaches your laptop's
> `localhost` and never the remote shell — that is the case `--device-auth` exists
> for. Device authorization is **not** a CI mechanism: it always requires a person
> to approve the request.

#### `--device-auth`

```bash
# Log in only
agentteams auth login --device-auth

# Initialize a project (team/project/agent are chosen on the approval screen)
agentteams init --device-auth
```

The terminal prints a verification URL and an 8-character code. Open the URL on any
device, sign in, check that the code on screen matches the one in your terminal, and
approve. The CLI stores the login and continues.

To avoid typing the flag on every command on a remote machine, declare it once for
that machine:

```bash
# Persist it in ~/.agentteams/config.json (never in a project config)
agentteams auth login --device-auth --set-default

# Or per shell / per service unit
export AGENTTEAMS_DEVICE_AUTH=1
```

`agentteams auth status` reports whether this machine defaults to device
authorization. To turn it back off, remove `"deviceAuth"` from
`~/.agentteams/config.json` and unset `AGENTTEAMS_DEVICE_AUTH`.

#### Where the login is stored

The personal login is a refresh token, and it has to survive the command that
created it — otherwise the next command is signed out again.

The CLI always prefers the OS credential store: macOS Keychain, Windows Credential
Manager, or libsecret (Secret Service) on Linux. When that store cannot keep the
token, the CLI falls back to a **permission-protected file** under
`~/.agentteams/credentials`, one file per API server:

- POSIX: directory `0700`, file `0600`, and the CLI refuses to read or write the
  file if it is a symlink, is owned by another user, or is reachable by group or
  other.
- Windows: `icacls` removes inheritance and grants only the current account. If
  that cannot be applied or verified, the file backend is **not** used at all.

The fallback is triggered by the OS store failing, not by which platform you are
on, because the three platforms fail at different moments. On Linux the failure is
visible up front; on macOS and Windows the availability check passes and only the
write fails, which is why an SSH login there used to be revoked _after_ you had
already approved it on another device.

A protected file is weaker than an OS keyring: it is not encrypted, so anyone who
can read your files or gain root on that machine can read the token.
`agentteams auth status` always names the backend that actually holds the token and
repeats that warning. To forbid the fallback — the login then fails before asking
you to approve anything, exactly as it did before:

```bash
export AGENTTEAMS_DISABLE_FILE_CREDENTIALS=1
```

This applies to `init --device-auth` and `auth login --device-auth` on Linux, macOS
and Windows alike, including machines you only ever reach over SSH.

The variable stops the CLI **writing** a credential file. A file written before you
set it stays readable and removable, so `agentteams auth logout` can still revoke
that token and delete it — otherwise setting the variable would strand a live login
on disk with no command left that could reach it.

`auth status` names the reason the OS store was skipped when this process is the one
that discovered it — always on Linux, where the failure shows up before the login.
On macOS and Windows the failure is only visible at the moment of a write, so a
later `auth status` reports the backend without repeating why; re-run the login (or
`auth logout` and back in) to see the OS store's own error again.

#### Troubleshooting

| Message                                                              | Cause                                                                   | What to do                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OAuth callback timed out after 60 seconds.`                         | The default flow was used from a shell the browser cannot call back to  | Re-run with `--device-auth`                                                                                                                                                                                                      |
| `does not support device authorization`                              | The server is an older AgentTeams API                                   | Re-run **without** `--device-auth`, or upgrade the server                                                                                                                                                                        |
| `device authorization turned off because the server has no APP_URL`  | Server configuration                                                    | Ask the operator to set `APP_URL`; use the default flow meanwhile                                                                                                                                                                |
| `The device code expired before it was approved`                     | The code is valid for 15 minutes                                        | Run the command again for a new code                                                                                                                                                                                             |
| `The sign-in request was denied in the browser`                      | Deny was clicked                                                        | Run the command again if that was a mistake                                                                                                                                                                                      |
| `Cannot start device authorization: ... credential store`            | Neither the OS credential store nor the file fallback can keep a login  | Read the reason in brackets — it names both halves. Unset `AGENTTEAMS_DISABLE_FILE_CREDENTIALS` if you set it, or fix the OS store (install/unlock libsecret, unlock the macOS login keychain, sign in interactively on Windows) |
| `Store: protected file (~/.agentteams/credentials)` in `auth status` | The OS credential store was unavailable, so the file fallback is in use | Nothing is broken. Fix the OS store if you want the stronger backend; on Linux the message after it names the reason, on macOS and Windows only the run that first fell back can show it                                         |

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

## Breaking Changes

Every resource command is now `<resource> <action>` with its own subcommand, so each action's `--help` lists only the
options it actually reads. The following public arguments were removed in that move. Passing one fails at argument
parsing with `unknown option` / `unknown command`, and the CLI prints a `hint:` line with the replacement.

| Removed                                              | Replacement                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--format`                                           | Nothing — output is already JSON. Still available on `init`/`auth`/`sync`/`doctor`. |
| `--api-key`                                          | `--api-key-file <path>` or `AGENTTEAMS_API_KEY`                                     |
| `--team-id`                                          | `AGENTTEAMS_TEAM_ID` or the `teamId` config field                                   |
| `--limit` (report/postmortem/coaction/document list) | `--page-size` (`search --limit` is unchanged)                                       |
| `plan show`, `code-review show`, `task show`         | `get`                                                                               |
| `plan issue`                                         | `plan link-issue` (`issue` stays as an alias for one release)                       |

If an agent in your project still passes `--format json`, its convention copy is stale — run
`agentteams convention download` to refresh it.

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
agentteams plan get --id <plan-id> --include-deps
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

# Output is JSON by default, so it pipes straight into jq
agentteams search --query "refactor"
```

Searchable entity types: `PLAN`, `CO_ACTION`, `COMPLETION_REPORT`, `POST_MORTEM`, `CONVENTION`

### `resolve`

Resolve one entity reference. Pass the reference token exactly as it appears — `resolve` works out the type, strips the id prefix, and fetches the entity for you, so you do not have to pick the right per-type command yourself.

```bash
agentteams resolve "plan:agentteams_pln_f62762fc-730a-4201-8586-e2541505ed1b"
agentteams resolve "agentteams_doc_f62762fc-730a-4201-8586-e2541505ed1b"
agentteams resolve "convention:<id>:.agentteams/rules/context.md"
agentteams resolve "codeReview:<reviewId>:<findingId>"
agentteams resolve "GITHUB_ISSUE:owner/repo#12"

# A whole markdown link works too
agentteams resolve "[Safari pull-to-refresh](plan:agentteams_pln_<uuid>)"
```

Accepted forms: `type:id`, `type:id:path`, a bare prefixed id, an external marker (`LINEAR_ISSUE`, `GITHUB_ISSUE`, `GITHUB_PR`, `GITLAB_ISSUE`, `GITLAB_MERGE_REQUEST`, `BITBUCKET_ISSUE`, `BITBUCKET_PR`), or any of those wrapped in a `[label](...)` link. Three-part references are read by their parent type: `convention:id:path` carries a local path, while `codeReview:reviewId:findingId` and `plan:planId:taskId` address a child entity.

The response `kind` tells you what to do next:

| `kind`      | Types                                                            | What to do                                                  |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `file`      | `plan`, `completionReport`, `postMortem`, `coAction`, `document` | Read `filePath` — the body was downloaded as a local `.md`. |
| `record`    | `codeReview`, `codeReviewFinding`, `planTask`, `LINEAR_ISSUE`    | Use `record`, the structured payload returned inline.       |
| `localFile` | `convention` with a path                                         | Read `filePath` (no network call was made).                 |
| `external`  | `GITHUB_*`, `GITLAB_*`, `BITBUCKET_*`                            | Open `url` or run `suggestedCommand` (`gh` / `glab`).       |

`filePath` is always absolute, so it opens the same way from any working directory.

References are user-authored text, so `resolve` validates them before acting: an AgentTeams id (and the parent id of a three-part reference) must be a bare UUID, otherwise the reference is rejected instead of being sent to the API. The path in a `convention:id:path` reference must resolve inside the project's `.agentteams/` directory; anything else falls back to the server record rather than nominating a local file to read.

External references are never fetched for you: `resolve` derives the URL and the `gh`/`glab` command from the locator and stops there. GitLab references return a command but no URL, because a self-managed GitLab host cannot be derived from the project path.

Every response also carries `fallbackCommand`, the equivalent per-type command (`report download --id`, `code-review get --finding-id`, `task get --task-id`, `linear issue get --issue-id`, …) for older CLI versions that do not ship `resolve`.

Agents connected over MCP get the same dispatch as the `agentteams_resolve` tool (`full` profile only), so they can resolve a reference without shelling out. One difference: there is no `file` kind — a plan or report body comes back inline as a `record` rather than downloaded, since an MCP server has no working-directory contract. A `localFile` result still carries an absolute `filePath`, plus the reference's project-root-relative `path`; when the MCP session is not bound to a local checkout only `path` comes back, and — as with the command — a path that does not exist under `.agentteams/` degrades to the server record.

### `config`

```bash
agentteams config whoami
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

`apiUrl` is omitted for the default API. When `AGENTTEAMS_API_URL` points somewhere else — a
local API or the dev environment — `init` persists that value so later commands keep using the
same API. The API destination comes from the CLI's own environment only; the browser callback
never supplies it.

### Environment Variable Example

```bash
export AGENTTEAMS_API_KEY="key_your_api_key_here"
export AGENTTEAMS_API_URL="https://api.agentteams.run"
export AGENTTEAMS_TEAM_ID="team_xxx"
export AGENTTEAMS_PROJECT_ID="proj_xxx"
```

## Output Format

리소스·자동화 명령은 기본적으로 전체 구조화 결과를 stdout에 JSON으로 출력합니다. 따라서 별도의 포맷
옵션 없이도 기본 출력을 `JSON.parse`, `jq` 등의 파이프라인 소비자에 안전하게 전달할 수 있습니다.

출력 계약은 다음과 같습니다.

- 기본: 리소스·자동화 명령의 전체 JSON 결과를 stdout에 출력합니다.
- 사람용 예외: `init`, `auth`, `sync`, `doctor`는 사람이 읽기 쉬운 기본 출력을 유지합니다. 기계가 읽을 수
  있는 결과가 필요하면 **이 네 명령에 한해** `--format json`을 전달합니다. 다른 명령에는 `--format`이
  없습니다(기본 출력이 이미 JSON입니다).
- `--output-file <path>`: 전체 결과를 파일에 저장한 뒤, 저장 경로와 간결한 요약을 stdout에 출력합니다.
- `--verbose`: 전체 raw 결과를 stdout에 출력합니다. `--output-file`과 함께 사용하면 저장 경로 요약 뒤에
  전체 결과도 이어서 출력합니다.

### Prefixed entity IDs

Entity references copied from the AgentTeams web UI carry a type prefix (e.g. `agentteams_pln_<uuid>`). Any `--id`/`--plan-id`/`--completion-report-id`/etc. value is normalized to its bare id automatically, so you can paste a prefixed id directly:

```bash
agentteams plan get --id agentteams_pln_f62762fc-730a-4201-8586-e2541505ed1b
# resolves to plan f62762fc-730a-4201-8586-e2541505ed1b
```

This normalization only removes the prefix — you still choose the command that matches the entity type. [`resolve`](#resolve) sits one level above it: give it the whole reference token and it works out the type as well, then dispatches to the right lookup.

### Legacy V1 Plan HTML Preview

V2 plans render structured sections and tasks directly in the web UI and do not display uploaded HTML previews. Do not pass `--html-file` or `--html-stdin` for V2 plan workflows.

The optional HTML inputs and standalone `plan upload-html` action remain for legacy V1 plans that expose the visualization tab:

```bash
agentteams plan upload-html \
  --id <plan-id> \
  --file .agentteams/cli/temp/plan-summary.html
```

```bash
agentteams plan list
agentteams plan update --id <plan-id> --status IN_PROGRESS
```

Note: `--format` exists only on `init`, `auth`, `sync`, and `doctor`. Every other command already prints JSON.

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
