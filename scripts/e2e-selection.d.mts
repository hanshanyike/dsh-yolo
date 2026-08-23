export interface E2ESelectionOptions {
  spec?: string
  suite?: string
  root: string
  fileExists?: (path: string) => boolean
}

export function resolveE2ESelection(options: E2ESelectionOptions): string[]
