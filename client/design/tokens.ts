// YOLO design system — v5「宿主原生」host-native tokens (frontend-redesign-v5-native.md).
// The CSS text below is injected once per document by design/style.ts under
// the `#yolo-design-system` <style> element. Every selector is scoped to
// `.yolo-scope` so nothing leaks into the host UI; keyframes carry the
// `yolo-` prefix for the same reason.
//
// v5: YOLO is a first-class surface of the dsh host, so it consumes the host's
// `--dsw-*` semantic tokens instead of a self-made palette. Every `--y-*`
// COLOR token below bridges to a host alias (appendix A of the spec) and the
// host flips them with its light/dark theme automatically — there is NO
// `[data-y-theme="dark"]` token override anymore. Only geometry / motion /
// font tokens stay local. The one self-owned accent is the host's warn-amber
// (`--dsw-alias-state-warn-primary`), used sparingly for the
// 「关注/进行中/现在」 semantic point.

/** Geometry / motion constants the TS side occasionally needs. */
export const yoloTokens = {
  radiusSm: 'var(--y-r-sm)',
  radiusMd: 'var(--y-r-md)',
  duration1: 'var(--y-dur-1)',
  duration2: 'var(--y-dur-2)',
  duration3: 'var(--y-dur-3)',
  /** Side chat width — 4.2⑧: 340px base, clamped so narrow panels still show the board. */
  sideChatWidth: 'min(340px, 45%)',
  /** Below this panel width the side chat opens full-screen instead (4.3 Compact). */
  compactBreakpoint: 480,
  /** Full-screen chat content column (4.2⑨). */
  chatMaxWidth: 720,
} as const

export const YOLO_CSS = `
/* ===== base + host token bridge ===== */
.yolo-scope {
  --y-r-sm: 6px; --y-r-md: 9px; --y-r-lg: 13px;
  --y-e1: 0 4px 14px rgba(0,0,0,.10);
  --y-dur-1: 100ms; --y-dur-2: 150ms; --y-dur-3: 200ms;
  --y-ease-out: cubic-bezier(.2,0,0,1);
  --y-ease-in: cubic-bezier(.4,0,1,1);
  --y-font-ui: "Segoe UI Variable Text", -apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --y-font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;

  /* —— structural layer: inherited straight from the host, zero self-made —— */
  --y-bg: var(--dsw-alias-bg-base);
  --y-surface: var(--dsw-alias-bg-layer-1);
  --y-surface-2: var(--dsw-alias-bg-layer-2);
  --y-surface-3: var(--dsw-alias-bg-layer-3);
  --y-line: var(--dsw-alias-border-l1);
  --y-line-strong: var(--dsw-alias-border-l2);
  --y-text-1: var(--dsw-alias-label-primary);
  --y-text-2: var(--dsw-alias-label-secondary);
  --y-text-3: var(--dsw-alias-label-tertiary);
  --y-caption: var(--dsw-alias-label-caption);
  --y-hover: var(--dsw-alias-interactive-bg-hover);
  --y-active: var(--dsw-alias-interactive-bg-active);
  --y-menu: var(--dsw-specific-menu);
  --y-toast: var(--dsw-alias-toast-bg);
  --y-tooltip: var(--dsw-alias-tooltip-bg);

  /* —— semantic status: all host state-*, visible only where the state occurs —— */
  --y-danger: var(--dsw-alias-state-error-primary);
  --y-ok: var(--dsw-alias-state-success-primary);
  --y-focus: var(--dsw-alias-state-business-primary); /* focus ring: host brand blue */

  /* —— the one self-owned accent: host warn-amber, only for 关注/进行中 —— */
  --y-accent: var(--dsw-alias-state-warn-primary);
  --y-accent-fill: var(--dsw-alias-state-warn-primary);
  --y-accent-soft: var(--dsw-alias-state-warn-tertiary);
  --y-accent-ink: var(--dsw-static-neutral-bluish-1000);
  /* Readable amber FOR TEXT: raw warn-amber is ≈1.9–2.1:1 on its own soft fill
     or on white — far below WCAG AA. Mixing toward ink keeps the hue readable.
     Dark theme re-mixes toward white (see the [data-y-theme] rule below). */
  --y-accent-text: color-mix(in srgb, var(--y-accent) 65%, var(--dsw-static-neutral-bluish-1000));
  /* Toast text follows the theme-flipping --y-toast background instead of a
     static white that goes invisible when the host inverts the surface. */
  --y-toast-ink: var(--dsw-static-neutral-bluish-00);

  font-family: var(--y-font-ui);
  font-size: 13px;
  line-height: 1.4;
  color: var(--y-text-1);
  background: var(--y-bg);
}
.yolo-scope *, .yolo-scope *::before, .yolo-scope *::after { box-sizing: border-box; }
.yolo-scope [hidden] { display: none !important; }
.yolo-scope button { font-family: inherit; }
.yolo-scope .mono { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope ::selection { background: var(--y-accent-soft); }
.yolo-scope :focus-visible { outline: 2px solid var(--y-focus); outline-offset: 2px; }
.yolo-scope ::-webkit-scrollbar { width: 11px; height: 11px; }
.yolo-scope ::-webkit-scrollbar-thumb { background: var(--y-surface-3); border-radius: 6px; border: 3px solid var(--y-bg); }
.yolo-scope ::-webkit-scrollbar-track { background: transparent; }
.yolo-scope svg.ic { display: block; }
.yolo-scope input, .yolo-scope select, .yolo-scope textarea { font-family: inherit; }
.yolo-scope input[type="date"] { color-scheme: light; }
.yolo-scope[data-y-theme="dark"] input[type="date"] { color-scheme: dark; }
.yolo-scope[data-y-theme="dark"] { --y-accent-text: color-mix(in srgb, var(--y-accent) 55%, #FFFFFF); --y-toast-ink: var(--dsw-static-neutral-bluish-1000); }

/* ===== drawer shell ===== */
.yolo-scope.panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--y-bg); animation: yolo-panel-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-panel-in { from { opacity: 0; } }

/* header row: product identity · 对话 · 通知 · 更多 · 关闭 */
.yolo-scope .p-head { flex: none; position: relative; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 16px; }
.yolo-scope .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.yolo-scope .brand .mark { color: var(--y-accent); display: grid; place-items: center; }
.yolo-scope .brand-name { font-size: 15px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.yolo-scope .surface-name { padding-left: 8px; border-left: 1px solid var(--y-line-strong); color: var(--y-text-2); font-size: 13px; white-space: nowrap; }
.yolo-scope .p-date { font-size: 12px; color: var(--y-text-2); white-space: nowrap; }
.yolo-scope .p-head-acts { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.yolo-scope .hbtn { width: 34px; height: 34px; border-radius: var(--y-r-sm); border: none; background: none; color: var(--y-text-3); display: grid; place-items: center; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); }
.yolo-scope .hbtn:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .hbtn.spin svg { animation: yolo-spin var(--y-dur-3) linear; }
@keyframes yolo-spin { to { transform: rotate(360deg); } }

/* Head actions share one geometry; chat alone receives primary emphasis. */
.yolo-scope .head-primary, .yolo-scope .head-secondary { min-width: 36px; height: 36px; padding: 0 11px; border-radius: var(--y-r-sm); display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1), border-color var(--y-dur-1); }
.yolo-scope .head-primary { border: 1px solid var(--y-text-1); background: var(--y-text-1); color: var(--y-bg); }
.yolo-scope .head-primary:hover { opacity: .88; }
.yolo-scope .head-primary.on { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--y-bg) 30%, transparent); }
.yolo-scope .head-secondary { border: 1px solid var(--y-line-strong); background: var(--y-surface); color: var(--y-text-2); }
.yolo-scope .head-secondary:hover, .yolo-scope .head-secondary.on { background: var(--y-surface-2); color: var(--y-text-1); }

/* bell — unhandled-notification signal + jump to today's cards */
.yolo-scope .bell { position: relative; }
.yolo-scope .bell .bnum { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope .bell .bdot { position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 999px; background: var(--y-danger); border: 1.5px solid var(--y-surface); }

/* secondary menu */
.yolo-scope .more-wrap { position: relative; }
.yolo-scope .more-trigger { min-width: 62px; }
.yolo-scope .more-menu { position: absolute; top: 42px; right: 0; width: 218px; padding: 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); background: var(--y-menu); box-shadow: var(--y-e1); z-index: 70; }
.yolo-scope .more-menu button { width: 100%; min-height: 38px; padding: 7px 9px; border: none; border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); display: flex; align-items: center; gap: 9px; text-align: left; font-size: 13px; cursor: pointer; }
.yolo-scope .more-menu button:hover, .yolo-scope .more-menu button:focus-visible, .yolo-scope .more-menu button.on { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .more-menu button:disabled { opacity: .55; cursor: wait; }
.yolo-scope .more-menu button.refreshing svg { animation: yolo-spin var(--y-dur-3) linear; }
.yolo-scope .more-separator { display: block; height: 1px; margin: 5px 4px; background: var(--y-line); }

/* refresh sweep — the system's one signature motion: runs only when polled
   data actually changed (solid accent bar, no gradient). */
.yolo-scope .sweep { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--y-accent); transform: scaleX(0); transform-origin: left; opacity: 0; pointer-events: none; }
.yolo-scope .sweep.run { animation: yolo-sweep var(--y-dur-3) linear; }
@keyframes yolo-sweep { 0% { transform: scaleX(0); opacity: 1; } 70% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

/* horizontal view tabs (replace the old vertical nav / preset seg) */
.yolo-scope .y-tabs { flex: none; display: flex; align-items: stretch; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--y-line); overflow-x: auto; scrollbar-width: none; }
.yolo-scope .y-tabs::-webkit-scrollbar { display: none; }
.yolo-scope .ytab { position: relative; display: flex; align-items: center; gap: 7px; height: 42px; padding: 0 13px; border: none; background: none; color: var(--y-text-2); font-size: 13.5px; cursor: pointer; transition: color var(--y-dur-1); white-space: nowrap; }
.yolo-scope .ytab:hover { color: var(--y-text-1); }
.yolo-scope .ytab svg { width: 15px; height: 15px; flex: none; }
.yolo-scope .ytab .nnum { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--y-text-3); }
.yolo-scope .ytab.on { color: var(--y-text-1); font-weight: 650; }
.yolo-scope .ytab.on::after { content: ""; position: absolute; left: 11px; right: 11px; bottom: -1px; height: 3px; background: var(--y-accent); border-radius: 3px 3px 0 0; }
.yolo-scope .ytab.on .nnum { color: var(--y-accent-text); }

/* list-context toolbar + filter */
.yolo-scope .list-tools { flex: none; min-height: 42px; padding: 5px 16px; border-bottom: 1px solid var(--y-line); background: var(--y-bg); display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
.yolo-scope .flt-wrap { position: relative; }
.yolo-scope .flt { display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 10px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-2); font-size: 12.5px; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); white-space: nowrap; }
.yolo-scope .flt:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .flt .chev { display: grid; place-items: center; }
.yolo-scope .flt-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--y-accent); opacity: 0; transition: opacity var(--y-dur-1); }
.yolo-scope .flt.has-filters .flt-dot { opacity: 1; }
.yolo-scope .range-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border: none; border-radius: var(--y-r-sm); background: var(--y-accent-soft); color: var(--y-accent-text); font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .range-chip:hover { filter: brightness(.95); }
.yolo-scope .range-chip b { font-weight: 500; }

/* filter menu */
.yolo-scope .menu { position: absolute; top: 38px; right: 0; width: 232px; background: var(--y-menu); border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); box-shadow: var(--y-e1); padding: 6px; opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity var(--y-dur-2) var(--y-ease-out), transform var(--y-dur-2) var(--y-ease-out); z-index: 50; }
.yolo-scope .menu.open { opacity: 1; transform: none; pointer-events: auto; }
.yolo-scope .menu-g { padding: 7px 8px 3px; font-size: 11px; color: var(--y-text-3); letter-spacing: .05em; }
.yolo-scope .mrow { display: flex; align-items: center; gap: 8px; height: 31px; padding: 0 8px; border-radius: var(--y-r-sm); font-size: 13px; color: var(--y-text-2); cursor: pointer; }
.yolo-scope .mrow:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .ck { width: 16px; height: 16px; flex: none; border: 1px solid var(--y-line-strong); border-radius: 4px; display: grid; place-items: center; color: transparent; transition: all var(--y-dur-1); }
.yolo-scope .ck.on { background: var(--y-accent); border-color: var(--y-accent); color: var(--y-accent-ink); }
.yolo-scope .ck svg { width: 11px; height: 11px; }
.yolo-scope .minput { width: 100%; height: 31px; margin: 2px 0 4px; padding: 0 9px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 13px; outline: none; }
.yolo-scope .minput:focus { border-color: var(--y-focus); }
.yolo-scope .msel { width: 100%; height: 31px; margin: 2px 0 4px; padding: 0 9px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 13px; outline: none; cursor: pointer; }
.yolo-scope .msel:focus { border-color: var(--y-focus); }
.yolo-scope .range-inputs { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
.yolo-scope .range-tilde { color: var(--y-text-3); font-size: 12px; }
.yolo-scope .mdate { flex: 1; min-width: 0; height: 31px; padding: 0 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 12px; outline: none; }
.yolo-scope .mdate:focus { border-color: var(--y-focus); }
.yolo-scope .menu-clear { padding: 4px 2px 2px; }
.yolo-scope .menu-clear .btn { width: 100%; justify-content: center; height: 28px; font-size: 12px; color: var(--y-text-3); }
.yolo-scope .menu-clear .btn:hover { color: var(--y-text-1); }

/* capture-first command bar (below tabs, above the scroll face) */
.yolo-scope .capture { flex: none; display: flex; align-items: center; padding: 12px 16px 10px; background: var(--y-bg); }
.yolo-scope .capture--top { border-bottom: 1px solid var(--y-line); }
.yolo-scope .capture--foot { border-top: 1px solid var(--y-line); padding: 10px 16px; }
.yolo-scope .capture-in { display: flex; align-items: center; gap: 9px; height: 44px; padding: 0 12px 0 14px; flex: 1; min-width: 0; background: var(--y-surface); border: 1.5px solid var(--y-line-strong); border-radius: var(--y-r-md); transition: border-color var(--y-dur-2), box-shadow var(--y-dur-2); }
.yolo-scope .capture-in.focus { border-color: var(--y-accent); box-shadow: 0 0 0 3px var(--y-accent-soft); }
.yolo-scope .capture-in svg { color: var(--y-text-3); flex: none; }
.yolo-scope .capture-in.focus svg { color: var(--y-accent); }
.yolo-scope .cap-input { flex: 1; min-width: 0; border: none; background: none; color: var(--y-text-1); font-size: 14px; outline: none; }
.yolo-scope .cap-input::placeholder { color: var(--y-text-3); }
.yolo-scope .enter-hint { font-size: 11px; color: var(--y-text-3); transition: color var(--y-dur-1); font-family: var(--y-font-mono); }
.yolo-scope .enter-hint.lit { color: var(--y-accent-text); }
/* full-chat footer keeps a boxed input */
.yolo-scope .capture--foot .cap-input { height: 36px; padding: 0 12px; background: var(--y-surface-2); border: 1px solid transparent; border-radius: var(--y-r-md); transition: all var(--y-dur-2); }
.yolo-scope .capture--foot .cap-input::placeholder { color: var(--y-text-3); }
.yolo-scope .capture--foot .cap-input:focus { background: var(--y-bg); border-color: var(--y-line-strong); box-shadow: 0 0 0 3px var(--y-accent-soft); }

/* ===== body / scroll face ===== */
.yolo-scope .p-body { flex: 1; min-height: 0; overflow-y: auto; }
.yolo-scope .p-main { max-width: 760px; margin: 0 auto; padding: 6px 28px 48px; }
.yolo-scope .p-main--chat { padding: 16px 28px 24px; animation: yolo-chat-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-chat-in { from { opacity: 0; } }

/* view headings (upcoming / done / goals / ledger) */
.yolo-scope .heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 18px 0 4px; }
.yolo-scope .heading h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.yolo-scope .heading .hint { font-size: 12px; color: var(--y-text-2); }

/* today hero */
.yolo-scope .hero { display: flex; align-items: baseline; gap: 12px; padding: 18px 0 4px; }
.yolo-scope .hero h1 { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -.01em; }
.yolo-scope .hero .hdate { font-size: 14px; color: var(--y-text-3); white-space: nowrap; }
.yolo-scope .hero .hcount { margin-left: auto; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--y-text-2); white-space: nowrap; }
.yolo-scope .hero .hcount b { color: var(--y-accent-text); font-size: 18px; font-weight: 650; }

/* focus capsules (quick filters over the open rows) */
.yolo-scope .caps { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 0 2px; }
.yolo-scope .cap { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--y-line-strong); border-radius: 999px; background: none; color: var(--y-text-2); font-size: 12px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .cap:hover { color: var(--y-text-1); border-color: var(--y-text-3); }
.yolo-scope .cap.on { background: var(--y-accent-soft); color: var(--y-accent-text); border-color: color-mix(in srgb, var(--y-accent) 40%, transparent); }
.yolo-scope .cap .num { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; }

/* notification cards — the only surface above the canvas */
.yolo-scope .notif { position: relative; background: var(--y-surface); border: 1px solid var(--y-line); border-radius: var(--y-r-md); box-shadow: var(--y-e1); padding: 12px 14px 11px 15px; margin-bottom: 8px; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .notif::before { content: ""; position: absolute; left: -1px; top: 10px; bottom: 10px; width: 2px; border-radius: 2px; background: var(--y-accent); }
.yolo-scope .notif.reminder::before { background: var(--y-danger); }
.yolo-scope .notif-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; color: var(--y-text-2); }
.yolo-scope .notif-head svg { color: var(--y-text-3); flex: none; }
.yolo-scope .notif-type { font-size: 13px; font-weight: 650; color: var(--y-text-1); }
.yolo-scope .notif-time { font-size: 12px; color: var(--y-text-3); margin-left: auto; }
.yolo-scope .notif-body { font-size: 13.5px; line-height: 20px; color: var(--y-text-1); margin-bottom: 9px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.yolo-scope .notif-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.yolo-scope .notif-more { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; margin-top: 2px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 12px; cursor: pointer; transition: all var(--y-dur-1); }
.yolo-scope .notif-more:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .notif-more svg { color: var(--y-text-3); transition: transform var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .notif-more svg.up { transform: rotate(180deg); }

/* buttons */
.yolo-scope .btn { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 12px; border-radius: var(--y-r-sm); border: 1px solid transparent; font-size: 12.5px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .btn:active { transform: scale(.98); }
.yolo-scope .btn-pri { background: var(--y-accent-fill); color: var(--y-accent-ink); font-weight: 650; }
.yolo-scope .btn-pri:hover { filter: brightness(1.05); }
.yolo-scope .btn-ghost { background: none; color: var(--y-text-2); border-color: var(--y-line-strong); }
.yolo-scope .btn-ghost:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .btn-danger { background: none; color: var(--y-danger); border-color: color-mix(in srgb, var(--y-danger) 40%, transparent); }
.yolo-scope .btn-danger:hover { background: color-mix(in srgb, var(--y-danger) 10%, transparent); }
.yolo-scope .nact { height: 26px; padding: 0 11px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-2); font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .nact:hover { background: var(--y-surface-2); color: var(--y-text-1); border-color: var(--y-text-3); }
.yolo-scope .nact--chat { color: var(--y-accent-text); border-color: color-mix(in srgb, var(--y-accent) 50%, transparent); background: var(--y-accent-soft); }
.yolo-scope .nact--chat:hover { background: var(--y-accent-soft); }
.yolo-scope .nact svg { width: 12px; height: 12px; }

/* sections & task rows — de-carded, hairline-separated */
.yolo-scope .sec { margin-top: 18px; animation: yolo-crossfade var(--y-dur-2) var(--y-ease-out); }
@keyframes yolo-crossfade { from { opacity: .4; } }
.yolo-scope .sec-head { display: flex; align-items: center; gap: 9px; padding-bottom: 8px; }
.yolo-scope .sec-name { font-size: 13.5px; font-weight: 700; color: var(--y-text-1); letter-spacing: .02em; }
.yolo-scope .sec-name .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; background: var(--y-text-3); }
.yolo-scope .sec.danger .sec-name .dot { background: var(--y-danger); }
.yolo-scope .sec.today .sec-name .dot { background: var(--y-accent); }
.yolo-scope .sec-count { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 12px; font-weight: 650; color: var(--y-text-2); }
.yolo-scope .sec.danger .sec-count { color: var(--y-danger); }
.yolo-scope .sec-rule { flex: 1; height: 1px; background: var(--y-line); }
.yolo-scope .row { position: relative; display: flex; gap: 11px; padding: 11px 10px; margin: 0 -10px; border-bottom: 1px solid var(--y-line); min-height: 0; max-height: 480px; transition: background var(--y-dur-1), opacity var(--y-dur-2); }
.yolo-scope .row:hover, .yolo-scope .row:focus-within { background: var(--y-surface-2); border-radius: var(--y-r-sm); }
.yolo-scope .row.retire { opacity: .45; }
.yolo-scope .row.done-row { opacity: .55; }
.yolo-scope .row.retiring { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; overflow: hidden; border-bottom-color: transparent; transition: max-height .45s var(--y-ease-out), opacity .3s var(--y-ease-out), padding .45s var(--y-ease-out); }
.yolo-scope .row[tabindex="0"]:focus { background: var(--y-surface-2); outline: 2px solid var(--y-accent-soft); outline-offset: -2px; }
.yolo-scope .row[tabindex="0"] { cursor: pointer; }
.yolo-scope .ctl { flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%; border: 1.5px solid var(--y-line-strong); background: transparent; color: transparent; cursor: pointer; display: grid; place-items: center; padding: 0; transition: border-color var(--y-dur-2), background var(--y-dur-2); }
.yolo-scope .ctl svg { width: 11px; height: 11px; }
.yolo-scope .row:hover .ctl { border-color: var(--y-text-3); }
.yolo-scope .ctl:hover { border-color: var(--y-accent); box-shadow: 0 0 0 3px var(--y-accent-soft); }
.yolo-scope .row.overdue .ctl { border-color: var(--y-danger); }
/* in-progress: a solid amber half-disc (no gradient) — the 关注/进行中 point */
.yolo-scope .row.inprog .ctl { border-color: var(--y-accent); overflow: hidden; }
.yolo-scope .row.inprog .ctl::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 50%; background: var(--y-accent); }
.yolo-scope .ctl.done { background: var(--y-ok); border-color: var(--y-ok); color: var(--y-bg); }
.yolo-scope .row-main { flex: 1; min-width: 0; }
.yolo-scope .row-title { display: flex; align-items: center; gap: 7px; font-size: 14px; line-height: 20px; color: var(--y-text-1); }
.yolo-scope .row-title svg { flex: none; color: var(--y-text-3); }
.yolo-scope .row-title svg.urgent { color: var(--y-danger); }
.yolo-scope .row-title .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .row-title .tt.done { text-decoration: line-through; }
.yolo-scope .inprog-tag { flex: none; font-size: 11px; font-weight: 650; color: var(--y-accent-text); background: var(--y-accent-soft); padding: 1px 8px; border-radius: 4px; }
.yolo-scope .row-meta { display: flex; align-items: center; gap: 7px; margin-top: 4px; font-size: 12px; line-height: 17px; color: var(--y-text-2); white-space: nowrap; overflow: hidden; }
.yolo-scope .due { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; color: var(--y-text-2); }
.yolo-scope .row.overdue .due { color: var(--y-danger); }
.yolo-scope .sep { color: var(--y-line-strong); }
.yolo-scope .stale-tag { flex: none; font-size: 10px; font-weight: 600; color: var(--y-text-2); background: var(--y-surface-3); padding: 1px 6px; border-radius: 4px; }
.yolo-scope .src { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.yolo-scope .src svg { flex: none; width: 11px; height: 11px; opacity: .7; }
.yolo-scope .src span { overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.yolo-scope .row-acts { flex: none; display: flex; gap: 2px; opacity: 0; transition: opacity var(--y-dur-1); }
.yolo-scope .row:hover .row-acts, .yolo-scope .row:focus-within .row-acts { opacity: 1; }
.yolo-scope .act { width: 30px; height: 30px; border: none; border-radius: var(--y-r-sm); background: none; color: var(--y-text-3); display: grid; place-items: center; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); }
.yolo-scope .act:hover { background: var(--y-surface-3); color: var(--y-text-1); }
.yolo-scope .act:disabled { opacity: .4; cursor: default; }
.yolo-scope .act svg { width: 16px; height: 16px; }
@media (hover: none) {
  .yolo-scope .row-acts { opacity: 1; }
}
@keyframes yolo-row-in { from { opacity: 0; transform: translateY(3px); } }

/* inline editor */
.yolo-scope .edit-form { flex: 1; display: flex; flex-wrap: wrap; gap: 7px; align-items: center; padding: 2px 0; }
.yolo-scope .ef-input { height: 32px; padding: 0 10px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-1); font-size: 14px; outline: none; }
.yolo-scope .ef-input:focus { border-color: var(--y-focus); }
.yolo-scope .ef-title { flex: 1; min-width: 170px; }
.yolo-scope .ef-date { width: 116px; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope .ef-sel { height: 32px; padding: 0 8px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-2); font-size: 12.5px; outline: none; cursor: pointer; }
.yolo-scope .ef-btn { height: 28px; padding: 0 12px; font-size: 12.5px; }
.yolo-scope .confirm-strip { flex-basis: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid color-mix(in srgb, var(--y-danger) 40%, transparent); border-radius: var(--y-r-sm); font-size: 12.5px; color: var(--y-danger); animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }

/* R9 folded remainder (today view) */
.yolo-scope .fold { margin-top: 16px; border-top: 1px solid var(--y-line-strong); }
.yolo-scope .fold-head { display: flex; align-items: center; gap: 8px; height: 38px; cursor: pointer; color: var(--y-text-1); font-size: 13px; font-weight: 700; user-select: none; border: none; background: none; width: 100%; text-align: left; padding: 0 6px; margin: 0 -6px; border-radius: var(--y-r-sm); transition: background var(--y-dur-1), color var(--y-dur-1); }
.yolo-scope .fold-head:hover { color: var(--y-text-1); background: var(--y-surface-2); }
.yolo-scope .fold-head svg { width: 12px; height: 12px; transition: transform var(--y-dur-2) var(--y-ease-out); color: var(--y-text-2); flex: none; }
.yolo-scope .fold.open .fold-head svg { transform: rotate(90deg); }
.yolo-scope .fold-stat { margin-left: auto; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--y-text-2); white-space: nowrap; }
.yolo-scope .fold-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .fold.open .fold-body { grid-template-rows: 1fr; }
.yolo-scope .fold-inner { min-height: 0; overflow: hidden; }
.yolo-scope .fold-pad { min-width: 0; padding-bottom: 10px; }

/* goals — tick-mark progress bar (read-only progress) */
.yolo-scope .goal { padding: 12px 0 8px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .goal:last-child { border-bottom: none; }
.yolo-scope .goal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.yolo-scope .goal-name { font-size: 14px; font-weight: 650; cursor: text; border: none; background: none; color: var(--y-text-1); padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.yolo-scope .goal-name:hover { text-decoration: underline dotted var(--y-text-3); }
.yolo-scope .goal-name-input { height: 30px; padding: 0 8px; border: 1px solid var(--y-focus); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-1); font-size: 14px; font-weight: 650; outline: none; width: 60%; }
.yolo-scope .goal-pct { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 650; color: var(--y-accent-text); flex: none; }
.yolo-scope .goal-track { position: relative; height: 4px; margin: 0 8px 46px; border-radius: 2px; background: var(--y-line-strong); }
.yolo-scope .goal-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--y-accent); transition: width var(--y-dur-3) var(--y-ease-out); }
.yolo-scope .ms-dot { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 9px; height: 9px; border-radius: 50%; background: var(--y-bg); border: 1.5px solid var(--y-line-strong); cursor: pointer; padding: 0; transition: transform var(--y-dur-1); }
.yolo-scope .ms-dot:hover { transform: translate(-50%, -50%) scale(1.25); }
.yolo-scope .ms-dot.done { background: var(--y-ok); border-color: var(--y-ok); }
.yolo-scope .ms-dot.active { background: var(--y-accent); border-color: var(--y-accent); }
.yolo-scope .ms-dot.hl { box-shadow: 0 0 0 3px var(--y-accent-soft); }
.yolo-scope .ms-label { position: absolute; left: 0; transform: translateX(-50%); text-align: center; font-size: 11px; line-height: 14px; color: var(--y-text-3); white-space: nowrap; pointer-events: none; }
.yolo-scope .ms-dot:nth-child(odd) .ms-label { top: 11px; }
.yolo-scope .ms-dot:nth-child(even) .ms-label { top: 26px; }
.yolo-scope .ms-label b { display: block; font-weight: 550; color: var(--y-text-2); max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.yolo-scope .ms-label i { font-style: normal; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope .ms-pop { position: absolute; bottom: 16px; left: var(--x, 50%); transform: translateX(-50%); width: 188px; background: var(--y-surface); border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); box-shadow: var(--y-e1); padding: 8px; z-index: 10; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .ms-pop input { width: 100%; height: 30px; padding: 0 9px; margin-bottom: 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 12px; outline: none; }
.yolo-scope .ms-pop input:focus { border-color: var(--y-focus); }
.yolo-scope .ms-pop-row { display: flex; gap: 4px; }
.yolo-scope .ms-st { flex: 1; height: 25px; border: none; border-radius: 4px; background: var(--y-surface-2); color: var(--y-text-2); font-size: 11px; cursor: pointer; }
.yolo-scope .ms-st:hover { background: var(--y-surface-3); color: var(--y-text-1); }
.yolo-scope .ms-st.on { background: var(--y-accent-soft); color: var(--y-accent-text); }

/* ledger */
.yolo-scope .lg-row { display: flex; align-items: center; gap: 9px; height: 34px; border-bottom: 1px solid var(--y-line); font-size: 13.5px; }
.yolo-scope .lg-row:last-child { border-bottom: none; }
.yolo-scope .lg-row .ic-ok { width: 13px; height: 13px; color: var(--y-ok); flex: none; }
.yolo-scope .lg-time { width: 46px; flex: none; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 12px; color: var(--y-text-3); }
.yolo-scope .lg-type { width: 42px; flex: none; font-size: 12px; color: var(--y-text-2); }
.yolo-scope .lg-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--y-text-1); }
.yolo-scope .lg-row.is-done .lg-sum { color: var(--y-text-2); }
.yolo-scope .lg-src { flex: none; display: flex; align-items: center; gap: 4px; max-width: 150px; font-size: 12px; color: var(--y-text-3); }
.yolo-scope .lg-src svg { width: 11px; height: 11px; flex: none; opacity: .7; }
.yolo-scope .lg-src span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .lg-src-btn { flex: none; display: inline-flex; align-items: center; gap: 3px; max-width: 150px; border: none; background: none; padding: 1px 4px; margin-right: -4px; border-radius: 4px; font-size: 12px; color: var(--y-text-3); cursor: pointer; transition: all var(--y-dur-1); }
.yolo-scope .lg-src-btn:hover { color: var(--y-accent); background: var(--y-accent-soft); }
.yolo-scope .lg-src-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* empty / skeleton */
.yolo-scope .empty { padding: 48px 16px; text-align: center; }
.yolo-scope .empty h4 { margin: 0 0 6px; font-size: 16px; font-weight: 650; color: var(--y-text-1); }
.yolo-scope .empty p { margin: 0; font-size: 12.5px; color: var(--y-text-3); }
.yolo-scope .err-line { display: flex; align-items: center; gap: 10px; padding: 12px 2px 0; color: var(--y-danger); font-size: 13px; }
/* loop loader — shimmer is a persistent loading affordance, deliberately
   exempt from the ≤200ms micro-interaction rule (covered by reduced-motion) */
.yolo-scope .skel-notif, .yolo-scope .skel-row, .yolo-scope .skel-head { background: var(--y-surface-2); border-radius: var(--y-r-sm); background-image: linear-gradient(100deg, transparent 40%, var(--y-surface-3) 50%, transparent 60%); background-size: 200% 100%; animation: yolo-shimmer 1.5s infinite; }
.yolo-scope .skel-notif { height: 88px; margin: 14px 0 8px; }
.yolo-scope .skel-row { height: 40px; margin: 8px 0; }
.yolo-scope .skel-head { height: 12px; width: 90px; margin: 18px 0 6px; }
@keyframes yolo-shimmer { to { background-position: -200% 0; } }

/* messages (chat) */
.yolo-scope .msgs { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 16px; }
.yolo-scope .msg { max-width: 78%; font-size: 13.5px; line-height: 20px; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .msg.ai { align-self: flex-start; color: var(--y-text-1); white-space: pre-wrap; word-break: break-word; }
.yolo-scope .msg.me { align-self: flex-end; background: var(--y-surface-2); border-radius: var(--y-r-md); padding: 8px 11px; white-space: pre-wrap; word-break: break-word; }
.yolo-scope .msg .who { font-size: 10px; color: var(--y-text-3); margin-bottom: 3px; }

/* side chat dock — surface, hairline left, NO shadow (docked ≠ floating) */
.yolo-scope .dock { flex: none; width: min(340px, 45%); background: var(--y-surface); border-left: 1px solid var(--y-line); display: flex; flex-direction: column; min-width: 0; animation: yolo-dock-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-dock-in { from { opacity: 0; transform: translateX(12px); } }
.yolo-scope .dock-head { flex: none; height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .dock-tag { font-size: 12px; font-weight: 600; flex: none; }
.yolo-scope .dock-ctx { font-size: 11px; color: var(--y-accent-text); border-left: 2px solid var(--y-accent); padding-left: 8px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .dact { height: 24px; padding: 0 9px; margin-left: auto; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 11.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .dact:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .dact .tico { display: grid; place-items: center; }
.yolo-scope .dact .tico svg { width: 11px; height: 11px; }
.yolo-scope .dock-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px; }
.yolo-scope .dock-input { flex: none; display: flex; align-items: center; padding: 10px 12px; border-top: 1px solid var(--y-line); }
.yolo-scope .dock-input input { flex: 1; height: 36px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--y-r-md); background: var(--y-surface-2); color: var(--y-text-1); font-size: 13.5px; outline: none; transition: all var(--y-dur-2); }
.yolo-scope .dock-input input::placeholder { color: var(--y-text-3); }
.yolo-scope .dock-input input:focus { background: var(--y-bg); border-color: var(--y-line-strong); box-shadow: 0 0 0 3px var(--y-accent-soft); }

/* full-screen chat anchor strip */
.yolo-scope .fs-anchor { margin: 14px 0 0; padding: 6px 10px; border-left: 2px solid var(--y-accent); font-size: 11px; color: var(--y-text-2); }

/* toast (5.1); completion toast carries the 4s 撤销 window */
.yolo-scope .toast { position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 8px); opacity: 0; pointer-events: none; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--y-toast); color: var(--y-toast-ink); border-radius: var(--y-r-md); box-shadow: var(--y-e1); font-size: 13px; z-index: 60; transition: transform var(--y-dur-2) var(--y-ease-out), opacity var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .toast.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
.yolo-scope .toast button { border: none; background: none; color: inherit; font-size: 13px; font-weight: 650; cursor: pointer; padding: 0; text-decoration: underline; }

/* narrow panel (4.3 Compact) */
.yolo-scope.compact .p-date { display: none; }
.yolo-scope.compact .brand-wide { display: none; }
.yolo-scope.compact .p-head { height: 54px; gap: 5px; padding: 0 8px; }
.yolo-scope.compact .brand { gap: 5px; }
.yolo-scope.compact .brand-name { font-size: 14px; }
.yolo-scope.compact .p-head-acts { gap: 3px; }
.yolo-scope.compact .head-primary, .yolo-scope.compact .head-secondary { height: 34px; padding: 0 7px; gap: 4px; font-size: 12.5px; }
.yolo-scope.compact .more-trigger { min-width: 55px; }
.yolo-scope.compact .hbtn { width: 32px; height: 32px; }
.yolo-scope.compact .hero h1 { font-size: 24px; }
.yolo-scope.compact .p-main { padding: 6px 16px 32px; }
.yolo-scope.compact .y-tabs { width: 100%; padding: 0 8px; gap: 0; overflow: hidden; }
.yolo-scope.compact .ytab { flex: 1 1 0; min-width: 0; justify-content: center; height: 44px; padding: 0 5px; gap: 5px; }
.yolo-scope.compact .ytab.on::after { left: 8px; right: 8px; }
.yolo-scope.compact .list-tools { padding-inline: 12px; }

/* reduced motion — everything degrades to instant swaps (6.3);
   the ROOT element itself is included so the panel entrance also stops */
@media (prefers-reduced-motion: reduce) {
  .yolo-scope, .yolo-scope *, .yolo-scope *::before, .yolo-scope *::after { animation: none !important; transition: none !important; }
}
`
