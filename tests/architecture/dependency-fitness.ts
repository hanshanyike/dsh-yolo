import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import ts from 'typescript'

export type DependencyRuleId =
  | 'shared-must-not-depend-on-ui'
  | 'host-features-must-not-depend-on-ui-session'
  | 'client-must-use-contracts'

export interface DependencyEdge {
  source: string
  target: string
  specifier: string
}

export interface DependencyViolation extends DependencyEdge {
  rule: DependencyRuleId
}

export type LegacyDependencyException = Pick<DependencyViolation, 'rule' | 'source' | 'target'>

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

function toRepoPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).replaceAll('\\', '/')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

function moduleSpecifiers(sourceText: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const values: string[] = []
  const add = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) values.push(node.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0])
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return values
}

function resolveRelativeTarget(root: string, source: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  return toRepoPath(root, resolve(root, dirname(source), specifier))
}

export function violatedRule(edge: DependencyEdge): DependencyRuleId | undefined {
  if (edge.source.startsWith('src/shared/') && edge.target.startsWith('src/ui/')) {
    return 'shared-must-not-depend-on-ui'
  }

  if (
    /^src\/(?:extract|memory|reminder)\//u.test(edge.source)
    && edge.target === 'src/ui/session.ts'
  ) {
    return 'host-features-must-not-depend-on-ui-session'
  }

  if (
    edge.source.startsWith('client/')
    && (
      edge.target === 'src/storage/types.ts'
      || edge.target === 'src/shared/actions.ts'
      || edge.target === 'src/ui/config.ts'
    )
  ) {
    return 'client-must-use-contracts'
  }

  return undefined
}

export function collectDependencyViolations(root: string): DependencyViolation[] {
  return ['src', 'client']
    .flatMap((directory) => sourceFiles(resolve(root, directory)))
    .flatMap((absoluteSource) => {
      const source = toRepoPath(root, absoluteSource)
      return moduleSpecifiers(readFileSync(absoluteSource, 'utf8'), absoluteSource)
        .map((specifier): DependencyEdge | undefined => {
          const target = resolveRelativeTarget(root, source, specifier)
          return target ? { source, target, specifier } : undefined
        })
        .filter((edge): edge is DependencyEdge => edge !== undefined)
    })
    .map((edge): DependencyViolation | undefined => {
      const rule = violatedRule(edge)
      return rule ? { ...edge, rule } : undefined
    })
    .filter((violation): violation is DependencyViolation => violation !== undefined)
    .sort((left, right) => fitnessKey(left).localeCompare(fitnessKey(right)))
}

export function fitnessKey(edge: LegacyDependencyException): string {
  return `${edge.rule}:${edge.source}->${edge.target}`
}

/**
 * Tightening interface: delete an entry from the passed allowlist as soon as
 * its compatibility import is migrated. New violations are never learned or
 * rewritten automatically, and stale entries fail the audit as well.
 */
export function auditDependencyFitness(
  root: string,
  legacyAllowlist: readonly LegacyDependencyException[],
): { unexpected: DependencyViolation[]; staleAllowlist: LegacyDependencyException[] } {
  const violations = collectDependencyViolations(root)
  const allowed = new Set(legacyAllowlist.map(fitnessKey))
  const actual = new Set(violations.map(fitnessKey))
  return {
    unexpected: violations.filter((violation) => !allowed.has(fitnessKey(violation))),
    staleAllowlist: legacyAllowlist.filter((exception) => !actual.has(fitnessKey(exception))),
  }
}
