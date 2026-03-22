# NethackNarrated Agent Notes

This repository already maintains its primary agent guidance in [CLAUDE.md](./CLAUDE.md).

If you are an automated coding agent working in this repo:

- Read `CLAUDE.md` first and treat it as the main project instruction file.
- Follow the workspace conventions described there for the sibling `neth4ck-monorepo`.
- Prefer updating shared NetHack/WASM behavior in `@neth4ck/api` when the logic is frontend-agnostic.
- Keep this file minimal; add durable Codex-specific notes here only when they are not a good fit for `CLAUDE.md`.

Codex-specific defaults for this repo:

- Inspect both `NethackNarrated` and the sibling `neth4ck-monorepo` before deciding where a behavior change belongs.
- If a task touches NetHack C code or WASM packaging, handle the WSL build and local reinstall yourself instead of leaving that step to the user.
- Rebuild both WASM versions when shared C code changes affect both, and run independent builds/tests in parallel when possible.
- After changing `@neth4ck/api` behavior that this app consumes, verify whether this repo needs a reinstall, rebuild, or smoke test to pick up the change.
- Prefer small handoff summaries that mention any required cross-repo follow-up, especially when edits span this repo and the monorepo.

In case of conflict, repository-level user/developer instructions provided in the current session override this file.
