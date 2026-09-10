/**
 * Staged form over the `yolo` settings namespace.
 *
 * Mirrors the contract the shipped plugin cards use (`CardShell`, `CardFieldState`,
 * `CardActions` from the settings-plugins surface) so YOLO's card behaves exactly
 * like bash / agent-loop / web-search: edits are staged locally, a save is the
 * single write point, a field's presence in the namespace's raw user layer — not
 * its value — marks it overridden, and a reset stages a clear so the field falls
 * back to the composition layer.
 *
 * The one structural difference: YOLO's namespace section is nested
 * (`reminder.checkIntervalSec`), so the form plans ordered path ops and writes
 * them in ONE revision-fenced mutation (as the shipped subagent card does for
 * its two coupled fields), instead of one whole-section write per field.
 *
 * The host is the only authority on whether a write was accepted, so a save is
 * verified by reading the user layer back rather than predicted here.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardActions, CardFieldState, CardShell } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { hasPath, readPath, sameValue, type SwitchFieldSpec, type ValueFieldSpec, type YoloFieldSpec, type YoloSettings } from './model.ts'

/** What one staged edit asks for. */
type StagedEdit =
  /** Draft text for a value field; `parse` decides what it means at plan time. */
  | { kind: 'text'; text: string }
  /** A switch's chosen position. */
  | { kind: 'value'; value: unknown }
  /** Reset: drop the user-layer entry so the field re-inherits the composition layer. */
  | { kind: 'clear' }

/** One planned write; `op` is undefined when the draft is not a value the field accepts. */
interface PlanItem {
  field: string
  op: SettingsPathOpView | undefined
}

/** A switch as the card renders it. */
export interface SwitchFieldState {
  value: boolean
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
}

/** The switch half of the save actions, alongside the shared {@link CardActions}. */
export interface YoloCardActions extends CardActions {
  /** Stage a switch position. */
  setSwitch: (field: string, value: boolean) => void
}

/** Staged form over one settings namespace. */
export class YoloCardForm {
  private readonly scope: SettingsScope<YoloSettings>
  private readonly specs: Map<string, YoloFieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false
  /**
   * Namespace revision the first staged edit read. Every write in that draft is
   * fenced on it, so a document that moved underneath is refused rather than
   * overwritten with values the user never saw.
   */
  private fence: number | undefined

  constructor(scope: SettingsScope<YoloSettings>, specs: readonly YoloFieldSpec[]) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /** Publish a projection of this form; rebuilt whenever the scope or a draft changes. */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /** Card-level state: what the host serves and what a save would do. */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** One value field as its control renders it. */
  field(field: string): CardFieldState {
    const spec = this.valueSpec(field)
    const plan = this.planned(field)
    if (plan !== undefined) {
      return { text: this.stagedText(field, spec), overridden: plan.op?.op === 'set', invalid: plan.op === undefined }
    }
    return { text: spec.format(this.effective(spec)), overridden: this.stored(spec), invalid: false }
  }

  /** One switch field as its control renders it. */
  switchState(field: string): SwitchFieldState {
    const spec = this.switchSpec(field)
    const staged = this.staged.get(field)
    if (staged?.kind === 'clear') return { value: spec.isOn(readPath(this.snapshotOf().base, spec.path)), overridden: this.planned(field)?.op?.op === 'set' }
    if (staged?.kind === 'value') return { value: spec.isOn(staged.value), overridden: this.planned(field)?.op?.op === 'set' }
    return { value: spec.isOn(readPath(this.snapshotOf().value, spec.path)), overridden: this.stored(spec) }
  }

  /** The edit / reset / save / discard actions the card's slot entry injects. */
  actions(): YoloCardActions {
    return {
      edit: (field, text) => { this.stage(field, { kind: 'text', text }) },
      setSwitch: (field, value) => {
        const spec = this.switchSpec(field)
        this.stage(field, { kind: 'value', value: value ? spec.on : spec.off })
      },
      resetField: (field) => { this.stage(field, { kind: 'clear' }) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** Drop every staged edit and any failure marker. */
  discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.fence = undefined
    this.failed = false
    this.publish()
  }

  /**
   * Write every staged edit as one fenced mutation, then verify the read-back.
   * A save that did not land keeps its drafts so the user can correct them.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    const ops = plan.flatMap((item) => (item.op === undefined ? [] : [item.op]))
    if (plan.length === 0 || this.saving || ops.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      await this.scope.mutate(ops, this.fence)
      landed = plan.every((item) => this.landed(item))
    } catch {
      landed = false
    }
    if (landed) {
      this.staged.clear()
      this.fence = undefined
    } else {
      // Keep the drafts but re-fence the NEXT attempt on the current revision:
      // a rejected save has already been read back, so fencing the retry on the
      // stale revision the user started from could never succeed. The drafts
      // are enough for the user to see what did not land; pressing save again
      // is the explicit acknowledgement that the newer document is what they
      // are writing over.
      this.fence = undefined
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private planned(field: string): PlanItem | undefined {
    return this.plan().find((item) => item.field === field)
  }

  /** Every staged edit a save would write, in the order it was staged. */
  private plan(): PlanItem[] {
    const plan: PlanItem[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (spec.control === 'switch') {
        if (staged.kind === 'clear') {
          if (this.stored(spec)) plan.push({ field, op: { op: 'unset', path: [...spec.path] } })
          continue
        }
        if (staged.kind === 'text') continue
        if (spec.isOn(staged.value) === spec.isOn(this.effective(spec))) continue
        plan.push({ field, op: { op: 'set', path: [...spec.path], value: jsonValue(staged.value) } })
        continue
      }
      if (staged.kind === 'value') continue
      if (staged.kind === 'clear') {
        if (this.stored(spec)) plan.push({ field, op: { op: 'unset', path: [...spec.path] } })
        continue
      }
      if (staged.text === spec.format(this.effective(spec))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, op: undefined })
      else if (write.kind === 'clear') {
        if (this.stored(spec)) plan.push({ field, op: { op: 'unset', path: [...spec.path] } })
      } else plan.push({ field, op: { op: 'set', path: [...spec.path], value: jsonValue(write.value) } })
    }
    return plan
  }

  /** Whether a planned write actually reached the namespace's raw user layer. */
  private landed(item: PlanItem): boolean {
    const op = item.op
    if (op === undefined) return false
    const user = this.snapshotOf().user
    if (op.op === 'unset') return !hasPath(user, op.path)
    return sameValue(readPath(user, op.path), op.value)
  }

  private stored(spec: YoloFieldSpec): boolean {
    return hasPath(this.snapshotOf().user, spec.path)
  }

  /** The value the field would show with no user-layer entry: user layer over composition base over schema default. */
  private effective(spec: YoloFieldSpec): unknown {
    return readPath(this.snapshotOf().value, spec.path)
  }

  private stagedText(field: string, spec: ValueFieldSpec): string {
    const staged = this.staged.get(field)
    if (staged === undefined) return spec.format(this.effective(spec))
    if (staged.kind === 'clear') return spec.format(readPath(this.snapshotOf().base, spec.path))
    if (staged.kind === 'value') return spec.format(staged.value)
    return staged.text
  }

  private stage(field: string, edit: StagedEdit): void {
    this.spec(field)
    if (this.staged.size === 0) this.fence = this.snapshotOf().revision
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): YoloFieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`yolo card has no field ${field}`)
    return spec
  }

  private valueSpec(field: string): ValueFieldSpec {
    const spec = this.spec(field)
    if (spec.control !== 'value') throw new Error(`yolo card field ${field} is not a value field`)
    return spec
  }

  private switchSpec(field: string): SwitchFieldSpec {
    const spec = this.spec(field)
    if (spec.control !== 'switch') throw new Error(`yolo card field ${field} is not a switch`)
    return spec
  }

  private snapshotOf(): ReturnType<SettingsScope<YoloSettings>['getSnapshot']> {
    return this.scope.getSnapshot()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

/** The wire admits JSON data only; every value this card writes already is one. */
function jsonValue(value: unknown): JsonValue {
  return value as JsonValue
}
