# Contract: Bun toolchain

## Canonical declaration

The repository MUST expose this single JavaScript/TypeScript toolchain:

~~~json
{
  "packageManager": "bun@1.4.0",
  "engines": { "bun": "1.4.0" },
  "workspaces": ["apps/*", "packages/*"]
}
~~~

`bun.lock` MUST be committed at the repository root. `bunfig.toml` MUST force
package executables to run with Bun so a Node shebang cannot silently select an
installed host runtime.

## Supported operations

| Operation | Canonical command |
| --- | --- |
| Frozen clean install | `bun ci` |
| Toolchain policy | `bun run toolchain:check` |
| Development stack | `bun run dev` |
| Type checking | `bun run typecheck` |
| Production builds | `bun run build` |
| Complete pre-push gate | `bun run checks:local` |
| Database migration | `bun run db:migrate` |
| Administration | `bun run admin -- <command>` |
| Production dependency audit | `bun audit --prod --audit-level=high` |
| Production license inventory | `bun pm licenses --prod --json` |

Every command MUST return the underlying failure code. A missing or unavailable
tool MUST fail rather than produce a skipped success.

## Version behavior

1. `Bun.version === "1.4.0"` MUST pass.
2. Any other exact version MUST fail `toolchain:check` with the expected
   version in the message.
3. The same exact value MUST be used by local metadata, GitHub Actions and
   Docker.
4. The presence of `node`, `npm`, Yarn or pnpm on the host MUST NOT alter a
   successful command or make a failing command pass.

## Lock behavior

1. `bun ci` MUST install every workspace without changing `bun.lock`.
2. Changing a dependency manifest without changing `bun.lock` MUST make
   `bun ci` fail.
3. Repeating `bun ci` MUST keep the lockfile byte-identical.
4. An install on macOS and Linux MUST NOT add platform-specific lockfile
   differences.

## Forbidden active artifacts

The final branch MUST reject:

- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `bun.lockb`;
- a package manager declaration other than exact Bun 1.4.0;
- `actions/setup-node` and `pnpm/action-setup` in maintained project jobs;
- a Node base image for a first-party build or runtime;
- active repository commands invoking `node`, `npx`, `npm`, `yarn`, `pnpm`,
  `corepack` or `tsx`;
- esbuild or Vite as a first-party production build path.
- an alias, patch or direct dependency that forces the npm `ws` implementation
  instead of Bun's built-in `ws` compatibility module.

Historical prose MAY name the removed toolchain when clearly describing old
behavior. It MUST NOT present a runnable current procedure.

## Allowed specialized tools

TypeScript, Biome, Vitest, Istanbul, Playwright, Vite development server,
Workbox, Tailwind, Docker, PostgreSQL, nginx, ShellCheck, shfmt and security
scanners MAY remain. They MUST be installed or launched by Bun when they are
JavaScript tools and MUST NOT create a second lockfile or application runtime.

Vite's allowed scope is strictly development server, React HMR and same-origin
HTTP/WebSocket proxy. `apps/web` production artifacts MUST come from
`Bun.build()`.

## Acceptance probes

- Run the policy under Bun 1.4.0 and assert success.
- Feed the policy fixtures for a wrong version, foreign lockfile, forbidden
  command, Node image and setup-node action; assert one actionable failure per
  fixture.
- Record the hash of `bun.lock`, run `bun ci` twice, and assert the hash is
  unchanged.
- Run canonical commands with a PATH that contains Bun and required system
  tools but no Node/pnpm executables.
- Assert `Bun.resolveSync("ws", repositoryRoot) === "ws"` and run the realtime
  contracts through a real loopback listener.
