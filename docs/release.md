# Release process

How to cut a release of `dsh-plugin-yolo`. The whole flow is manual-but-scripted:
one version bump, one publish, one tag.

## Prerequisites

- npm account with publish rights to the `dsh-plugin-yolo` package
  (first publish claims the name; `publishConfig.access` is already `public`).
- `pnpm build` green and `pnpm check` / `pnpm test:run` green on main
  (CI confirms this on both Linux and Windows).

## Steps

```bash
# 1. make sure main is clean and CI is green
git checkout main && git pull

# 2. close the Unreleased section in CHANGELOG.md:
#    rename "## [Unreleased]" -> "## [<new version>] — <today>"
#    and add the compare links at the bottom

# 3. bump the version (updates package.json, commits, tags)
npm version 0.2.0          # or: pnpm version 0.2.0

# 4. build + sanity-check the artifact
pnpm build
npm pack --dry-run         # verify the file list (dist/, bundle yml, schema.sql, docs)

# 5. publish
npm publish --access public

# 6. push commits + tag
git push --follow-tags
```

After publishing, start a fresh `## [Unreleased]` section at the top of the
CHANGELOG.

## What gets published

Controlled by the `files` whitelist in `package.json`:

- `dist/` — built host plugins (ESM) + wrapped client bundle (CJS) + `schema.sql`
- `cordis.bundle.yml` — the plugin bundle manifest the host reads
- `README.md`, `LICENSE`, `CHANGELOG.md`

Not published: source, tests, docs/, scripts/ (consumers only need the
runtime artifacts).

## Installing a published plugin (for users)

Once published, a deepseek-harness profile can resolve the plugin by package
name instead of a repo checkout — the patch overlay entries already use
package-name subpaths (`dsh-plugin-yolo/dist/src/storage`, …), so installing
the tarball into the profile's `node_modules` is sufficient:

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
npm install --prefix ~/.dsh/profiles/web dsh-plugin-yolo
```

Then reference the same `cordis.dev.local.yml`-style entries (see
[architecture.md](architecture.md#design-decision-why-not-dynamic-cordis-plugins)
for why YOLO uses the patch-overlay path, and
[modules.md](modules.md#构建契约host-如何发现并加载-bundle) for the runtime patch
format).

## Versioning policy

- `0.x` — the dsh platform itself is `0.1.0-rc`; breaking changes are allowed
  in minor bumps, note them in the CHANGELOG.
- Patch bumps for fixes only; minor bumps for feature drops
  (memory foundation → `0.2.0`, stateful plan + reply-to-act → `0.3.0`, …).
- Peer dep on `@deepseek-ai/cordis` stays `*` — the host provides it.
