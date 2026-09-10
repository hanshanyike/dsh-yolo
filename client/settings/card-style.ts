// Stylesheet for the YOLO plugin-configuration card.
//
// dsh 0.1.5 ships the plugin card chrome inside
// `@deepseek-ai/dsh-client-ui-settings-plugins`, but that package's browser
// bundle exports only `apply`/`inject` — the card chrome (`PluginCard`,
// `ValueField`, `CardForm`) is not reachable from another plugin at runtime.
// The atoms it builds on ARE shared: `@deepseek-ai/dsh-client-ui-primitives`
// is part of the client module baseline (Tag, Switch, icons), so YOLO uses
// those directly and reproduces the chrome's declarations here with its own
// class names.
//
// Every declaration below is a faithful copy of the shipped
// `PluginCard.module.css` / `fields.module.css` / `SubagentModelSelectionCard.module.css`
// declarations, so YOLO's card matches the shipped cards rather than merely
// resembling them. Colors come from the host's `--dsw-alias-*` tokens, so the
// card follows the host light/dark theme with no local theme switch.
//
// Known upstream gap, reproduced deliberately: the error declarations below use
// `--dsw-alias-label-error`, which dsh 0.1.5-rc.1 references but never defines
// (verified — it appears only in the settings-plugins bundle and in no token
// set), so the shipped cards' error copy inherits the normal label color. YOLO
// keeps the same alias rather than substituting `--dsw-alias-state-error-primary`,
// because a card that suddenly paints red would be the odd one out again; if the
// host ever defines the alias, both follow it with no change here.

const STYLE_ID = 'yolo-plugin-card'

const CSS = `
.yolo-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.yolo-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.yolo-card.is-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.yolo-card__header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.yolo-card__header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.yolo-card__head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.yolo-card__name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.yolo-card__description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.yolo-card__chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.yolo-card__chevron.is-open{transform:rotate(180deg)}
.yolo-card__body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.yolo-card__read-only{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.yolo-card__pending{flex:none}
.yolo-card__footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.yolo-card__failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.yolo-card__discard,.yolo-card__save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.yolo-card__discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.yolo-card__discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.yolo-card__save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.yolo-card__discard:disabled,.yolo-card__save:disabled{opacity:.4;cursor:default}
.yolo-card__discard:focus-visible,.yolo-card__save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.yolo-card__meta{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.yolo-card__group+.yolo-card__group{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:2px}
.yolo-card__group-title{color:var(--dsw-alias-label-tertiary);margin:0;padding:14px 0 0;font-size:11px;font-weight:500;letter-spacing:.02em}
.yolo-card__field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.yolo-card__field+.yolo-card__field,.yolo-card__field+.yolo-card__toggle,.yolo-card__toggle+.yolo-card__field,.yolo-card__toggle+.yolo-card__toggle{border-top:.5px solid var(--dsw-alias-border-l2)}
.yolo-card__toggle{gap:6px;padding:12px 0;display:grid}
.yolo-card__toggle-row{color:var(--dsw-alias-label-primary);justify-content:space-between;align-items:flex-start;gap:16px;font-size:13px;line-height:1.5;display:flex}
.yolo-card__toggle-label{flex:1;min-width:0;align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.yolo-card__head{align-items:center;gap:8px;display:flex}
.yolo-card__label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.yolo-card__badges{align-items:center;gap:8px;display:inline-flex}
.yolo-card__reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
.yolo-card__reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.yolo-card__reset:disabled{cursor:default}
.yolo-card__input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.yolo-card__input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.yolo-card__input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.yolo-card__input.is-invalid{border-color:var(--dsw-alias-label-error)}
.yolo-card__hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.yolo-card__invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
`

/**
 * Mount the card stylesheet once and return the disposer that removes it, so
 * the style tag belongs to the plugin fiber like every other side effect.
 * @returns idempotent disposer.
 */
export function mountYoloCardStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.dataset.plugin = 'dsh-plugin-yolo'
  el.dataset.pluginCss = 'dsh-plugin-yolo/plugin-card.css'
  el.textContent = CSS
  document.head.appendChild(el)
  return () => { el.remove() }
}
