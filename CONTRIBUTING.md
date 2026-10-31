# Contributing to AgentTeams CLI

Thanks for your interest in contributing.

This repository is managed as a public mirror of the CLI source-of-truth in the main monorepo.

## Scope

- Issues are welcome for bugs, feature requests, and questions.
- Pull requests are welcome for docs fixes, typo fixes, and small bug fixes.
- For major behavior/API changes, open an issue first and align on scope before sending a PR.

## Mirror Policy

- This repository may be updated by automated sync from the source monorepo.
- Maintainers can close or re-home PRs that conflict with the source-of-truth workflow.
- If needed, maintainers may re-implement accepted changes in the source monorepo before syncing back.

## Development

- Runtime: Node.js 26+
- Package manager: npm 10+

```bash
npm ci
npm run build
npm test
```

## Pull Request Checklist

1. Keep scope focused and minimal.
2. Add or update tests for behavior changes.
3. Ensure `npm run build` and `npm test` pass.
4. Describe why the change is needed.

## Code of Conduct

By participating in this project, you agree to follow `CODE_OF_CONDUCT.md`.
