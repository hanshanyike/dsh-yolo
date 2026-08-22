// Mono design system — single source of truth (frontend-redesign.md v2.1, ch.3).
// The CSS text below is injected once per document by design/style.ts under
// the `#yolo-design-system` <style> element. Every selector is scoped to
// `.yolo-scope` so nothing leaks into the host UI; keyframes carry the
// `yolo-` prefix for the same reason. Light tokens are the default, dark is
// an override on [data-y-theme="dark"] (ch.7: dark is the first-class theme,
// both ship with equal parity via the same semantic tokens).

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
/* ===== base ===== */
.yolo-scope {
  --y-r-sm: 6px; --y-r-md: 8px;
  --y-e1: 0 4px 12px rgba(0,0,0,.08);
  --y-dur-1: 100ms; --y-dur-2: 150ms; --y-dur-3: 200ms;
  --y-ease-out: cubic-bezier(.2,0,0,1);
  --y-ease-in: cubic-bezier(.4,0,1,1);
  --y-font-ui: "Segoe UI Variable Text", -apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --y-font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;

  --y-bg: #FAFAFA; --y-surface: #FFFFFF; --y-surface-2: #F4F4F5; --y-surface-3: #EBEBEF;
  --y-line: #E9E9EC; --y-line-strong: #D6D6DB;
  --y-text-1: #18181B; --y-text-2: #52525B; --y-text-3: #71717A;
  --y-accent-text: #4F46E5; --y-accent-fill: #5B5BD6; --y-accent-soft: rgba(91,91,214,.10);
  --y-danger-text: #BE3A31; --y-ok-text: #1F7A53; --y-scrim: rgba(0,0,0,.20);

  font-family: var(--y-font-ui);
  font-size: 13px;
  line-height: 1.4;
  color: var(--y-text-1);
  background: var(--y-bg);
}
.yolo-scope[data-y-theme="dark"] {
  --y-bg: #0A0A0B; --y-surface: #111113; --y-surface-2: #17171A; --y-surface-3: #1E1E22;
  --y-line: #1F1F23; --y-line-strong: #2A2A30;
  --y-text-1: #F4F4F5; --y-text-2: #A1A1A8; --y-text-3: #909098;
  --y-accent-text: #9E9CF5; --y-accent-fill: #5B5BD6; --y-accent-soft: rgba(110,107,232,.16);
  --y-danger-text: #F0716B; --y-ok-text: #52C58F; --y-scrim: rgba(0,0,0,.44);
  --y-e1: 0 4px 12px rgba(0,0,0,.40);
}
.yolo-scope *, .yolo-scope *::before, .yolo-scope *::after { box-sizing: border-box; }
.yolo-scope [hidden] { display: none !important; }
.yolo-scope button { font-family: inherit; }
.yolo-scope .mono { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope ::selection { background: var(--y-accent-soft); }
.yolo-scope :focus-visible { outline: 2px solid var(--y-accent-text); outline-offset: 2px; }
.yolo-scope ::-webkit-scrollbar { width: 10px; height: 10px; }
.yolo-scope ::-webkit-scrollbar-thumb { background: var(--y-surface-3); border-radius: 5px; border: 2px solid var(--y-bg); }
.yolo-scope ::-webkit-scrollbar-track { background: transparent; }
.yolo-scope svg.ic { display: block; }
.yolo-scope input, .yolo-scope select, .yolo-scope textarea { font-family: inherit; }
.yolo-scope input[type="date"] { color-scheme: light; }
.yolo-scope[data-y-theme="dark"] input[type="date"] { color-scheme: dark; }

/* ===== panel shell ===== */
/* compound selector (no space): the root element carries BOTH classes, so a
   descendant selector would never match it and the flex column would be lost. */
.yolo-scope.panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--y-bg); animation: yolo-panel-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-panel-in { from { opacity: 0; transform: translateY(4px); } }

/* header (48px) */
.yolo-scope .p-head { flex: none; height: 48px; display: flex; align-items: center; gap: 14px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.yolo-scope .brand-name { font-size: 13px; font-weight: 600; letter-spacing: .02em; }
.yolo-scope .p-date { font-size: 11px; color: var(--y-text-3); }
.yolo-scope .p-head-acts { margin-left: auto; display: flex; gap: 2px; align-items: center; }
.yolo-scope .hbtn { width: 30px; height: 30px; border-radius: var(--y-r-sm); border: none; background: none; color: var(--y-text-3); display: grid; place-items: center; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); }
.yolo-scope .hbtn:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .hbtn.spin svg { animation: yolo-spin .6s linear; }
@keyframes yolo-spin { to { transform: rotate(360deg); } }

/* chat toggle (header) */
.yolo-scope .ctoggle { height: 28px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .ctoggle:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .ctoggle.on { background: var(--y-accent-soft); color: var(--y-accent-text); }
.yolo-scope .ctoggle .tico { display: grid; place-items: center; }
.yolo-scope .ctoggle .tico svg { width: 13px; height: 13px; }

/* toolbar (40px) */
.yolo-scope .p-toolbar { flex: none; position: relative; display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 16px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .seg { display: flex; height: 100%; }
.yolo-scope .seg-btn { position: relative; height: 100%; padding: 0 9px; font-size: 13px; color: var(--y-text-3); background: none; border: none; cursor: pointer; transition: color var(--y-dur-1); }
.yolo-scope .seg-btn:hover { color: var(--y-text-2); }
.yolo-scope .seg-btn.on { color: var(--y-text-1); font-weight: 600; }
.yolo-scope .seg-btn.on::after { content: ""; position: absolute; left: 9px; right: 9px; bottom: 0; height: 2px; background: var(--y-accent-fill); border-radius: 1px 1px 0 0; }
.yolo-scope .tb-spacer { flex: 1; }
.yolo-scope .caps { display: flex; gap: 6px; }
.yolo-scope .cap { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 11px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .cap:hover { color: var(--y-text-1); border-color: var(--y-text-3); }
.yolo-scope .cap.on { background: var(--y-accent-soft); color: var(--y-accent-text); border-color: transparent; }
.yolo-scope .cap .num { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; }
.yolo-scope .flt-wrap { position: relative; }
.yolo-scope .flt { display: flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border: none; border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 11px; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); white-space: nowrap; }
.yolo-scope .flt:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .flt .chev { display: grid; place-items: center; }
.yolo-scope .flt-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--y-accent-fill); opacity: 0; transition: opacity var(--y-dur-1); }
.yolo-scope .flt.has-filters .flt-dot { opacity: 1; }

/* refresh sweep — the system's one signature motion (6.2): runs only when
   polled data actually changed. */
.yolo-scope .sweep { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: linear-gradient(90deg, transparent, var(--y-accent-fill) 30%, var(--y-accent-fill) 70%, transparent); transform: scaleX(0); transform-origin: left; pointer-events: none; }
.yolo-scope .sweep.run { animation: yolo-sweep var(--y-dur-3) linear; }
@keyframes yolo-sweep { 0% { transform: scaleX(0); opacity: 1; } 70% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

/* range chip (toolbar, conditional) */
.yolo-scope .range-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border: none; border-radius: var(--y-r-sm); background: var(--y-accent-soft); color: var(--y-accent-text); font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .range-chip:hover { filter: brightness(.95); }
.yolo-scope .range-chip b { font-weight: 500; }

/* filter menu */
.yolo-scope .menu { position: absolute; top: 32px; right: 0; width: 216px; background: var(--y-surface); border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); box-shadow: var(--y-e1); padding: 6px; opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity var(--y-dur-2) var(--y-ease-out), transform var(--y-dur-2) var(--y-ease-out); z-index: 40; }
.yolo-scope .menu.open { opacity: 1; transform: none; pointer-events: auto; }
.yolo-scope .menu-g { padding: 7px 8px 3px; font-size: 10px; color: var(--y-text-3); letter-spacing: .04em; }
.yolo-scope .mrow { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border-radius: var(--y-r-sm); font-size: 12px; color: var(--y-text-2); cursor: pointer; }
.yolo-scope .mrow:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .ck { width: 14px; height: 14px; flex: none; border: 1px solid var(--y-line-strong); border-radius: 4px; display: grid; place-items: center; color: transparent; transition: all var(--y-dur-1); }
.yolo-scope .ck.on { background: var(--y-accent-fill); border-color: var(--y-accent-fill); color: #fff; }
.yolo-scope .ck svg { width: 10px; height: 10px; }
.yolo-scope .minput { width: 100%; height: 28px; margin: 2px 0 4px; padding: 0 8px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 12px; outline: none; }
.yolo-scope .minput:focus { border-color: var(--y-accent-text); }
.yolo-scope .msel { width: 100%; height: 28px; margin: 2px 0 4px; padding: 0 8px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 12px; outline: none; cursor: pointer; }
.yolo-scope .msel:focus { border-color: var(--y-accent-text); }
.yolo-scope .range-inputs { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
.yolo-scope .range-tilde { color: var(--y-text-3); font-size: 11px; }
.yolo-scope .mdate { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; outline: none; }
.yolo-scope .mdate:focus { border-color: var(--y-accent-text); }
.yolo-scope .menu-clear { padding: 4px 2px 2px; }
.yolo-scope .menu-clear .btn { width: 100%; justify-content: center; height: 26px; font-size: 11px; color: var(--y-text-3); }
.yolo-scope .menu-clear .btn:hover { color: var(--y-text-1); }

/* ===== body ===== */
.yolo-scope .p-body { flex: 1; min-height: 0; overflow-y: auto; }
.yolo-scope .p-main { max-width: 720px; margin: 0 auto; padding: 4px 16px 24px; }
.yolo-scope .p-main--chat { padding: 16px 16px 24px; animation: yolo-chat-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-chat-in { from { opacity: 0; } }

/* notifications — the only surface above the canvas (5.3) */
.yolo-scope .notif { position: relative; background: var(--y-surface); border: 1px solid var(--y-line); border-radius: var(--y-r-md); padding: 10px 12px 10px 15px; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .notif::before { content: ""; position: absolute; left: -1px; top: 9px; bottom: 9px; width: 2px; border-radius: 2px; background: var(--y-accent-fill); }
.yolo-scope .notif.reminder::before { background: var(--y-danger-text); }
.yolo-scope .notif-head { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; color: var(--y-text-2); }
.yolo-scope .notif-head svg { color: var(--y-text-3); flex: none; }
.yolo-scope .notif-type { font-size: 12px; font-weight: 600; color: var(--y-text-1); }
.yolo-scope .notif-time { font-size: 11px; color: var(--y-text-3); margin-left: auto; }
.yolo-scope .notif-body { font-size: 13px; line-height: 19px; color: var(--y-text-1); margin-bottom: 9px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.yolo-scope .notif-acts { display: flex; gap: 6px; }

/* buttons */
.yolo-scope .btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 12px; border-radius: var(--y-r-sm); border: 1px solid transparent; font-size: 12px; cursor: pointer; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .btn:active { transform: scale(.98); }
.yolo-scope .btn-pri { background: var(--y-accent-fill); color: #fff; }
.yolo-scope .btn-pri:hover { filter: brightness(1.08); }
.yolo-scope .btn-ghost { background: none; color: var(--y-text-2); }
.yolo-scope .btn-ghost:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .btn-danger { background: none; color: var(--y-danger-text); border-color: color-mix(in srgb, var(--y-danger-text) 40%, transparent); }
.yolo-scope .btn-danger:hover { background: color-mix(in srgb, var(--y-danger-text) 10%, transparent); }
.yolo-scope .nact { height: 24px; padding: 0 10px; border: none; border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .nact:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .nact--chat { color: var(--y-accent-text); border: 1px solid color-mix(in srgb, var(--y-accent-text) 45%, transparent); }
.yolo-scope .nact--chat:hover { background: var(--y-accent-soft); }
.yolo-scope .nact svg { width: 12px; height: 12px; }

/* sections & task rows — de-carded, hairline-separated (4.2④) */
.yolo-scope .sec { margin-top: 14px; animation: yolo-crossfade var(--y-dur-2) var(--y-ease-out); }
@keyframes yolo-crossfade { from { opacity: .4; } }
.yolo-scope .sec-head { display: flex; align-items: center; gap: 8px; height: 32px; }
.yolo-scope .sec-name { font-size: 11px; font-weight: 500; color: var(--y-text-3); letter-spacing: .02em; }
.yolo-scope .sec-count { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--y-text-3); }
.yolo-scope .sec-count.danger { color: var(--y-danger-text); }
.yolo-scope .sec-rule { flex: 1; height: 1px; background: var(--y-line); }
.yolo-scope .row { position: relative; display: flex; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--y-line); min-height: 0; transition: background var(--y-dur-1), opacity var(--y-dur-2); }
.yolo-scope .row:hover, .yolo-scope .row:focus-within { background: var(--y-surface-2); }
.yolo-scope .row.retire { opacity: .45; }
.yolo-scope .row.done-row { opacity: .55; }
.yolo-scope .ctl { flex: none; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; border: 1.5px solid var(--y-line-strong); background: transparent; color: transparent; cursor: pointer; display: grid; place-items: center; padding: 0; transition: border-color var(--y-dur-2), background var(--y-dur-2); }
.yolo-scope .ctl svg { width: 9px; height: 9px; }
.yolo-scope .row:hover .ctl { border-color: var(--y-text-3); }
.yolo-scope .ctl:hover { border-color: var(--y-accent-fill); }
.yolo-scope .row.overdue .ctl { border-color: var(--y-danger-text); }
.yolo-scope .row.inprog .ctl { border-color: var(--y-accent-fill); background: linear-gradient(to top, var(--y-accent-fill) 50%, transparent 50%); }
.yolo-scope .ctl.done { background: var(--y-ok-text); border-color: var(--y-ok-text); color: #fff; }
.yolo-scope .row-main { flex: 1; min-width: 0; }
.yolo-scope .row-title { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 18px; color: var(--y-text-1); }
.yolo-scope .row-title svg { flex: none; color: var(--y-text-3); }
.yolo-scope .row-title svg.urgent { color: var(--y-danger-text); }
.yolo-scope .row-title .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .row-title .tt.done { text-decoration: line-through; }
.yolo-scope .inprog-tag { flex: none; font-size: 10px; font-weight: 500; color: var(--y-accent-text); }
.yolo-scope .row-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 11px; line-height: 16px; color: var(--y-text-3); white-space: nowrap; overflow: hidden; }
.yolo-scope .due { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; color: var(--y-text-2); }
.yolo-scope .row.overdue .due { color: var(--y-danger-text); }
.yolo-scope .sep { color: var(--y-line-strong); }
.yolo-scope .src { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.yolo-scope .src svg { flex: none; width: 11px; height: 11px; opacity: .7; }
.yolo-scope .src span { overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.yolo-scope .row-acts { flex: none; display: flex; gap: 2px; opacity: 0; transition: opacity var(--y-dur-1); }
.yolo-scope .row:hover .row-acts, .yolo-scope .row:focus-within .row-acts { opacity: 1; }
.yolo-scope .act { width: 24px; height: 24px; border: none; border-radius: var(--y-r-sm); background: none; color: var(--y-text-3); display: grid; place-items: center; cursor: pointer; transition: background var(--y-dur-1), color var(--y-dur-1); }
.yolo-scope .act:hover { background: var(--y-surface-3); color: var(--y-text-1); }
.yolo-scope .act:disabled { opacity: .4; cursor: default; }
.yolo-scope .act svg { width: 14px; height: 14px; }
@keyframes yolo-row-in { from { opacity: 0; transform: translateY(4px); } }

/* inline editor */
.yolo-scope .edit-form { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 2px 0; }
.yolo-scope .ef-input { height: 28px; padding: 0 8px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-1); font-size: 12px; outline: none; }
.yolo-scope .ef-input:focus { border-color: var(--y-accent-text); }
.yolo-scope .ef-title { flex: 1; min-width: 160px; }
.yolo-scope .ef-date { width: 110px; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope .ef-sel { height: 28px; padding: 0 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-2); font-size: 11px; outline: none; cursor: pointer; }
.yolo-scope .ef-btn { height: 24px; padding: 0 10px; font-size: 11px; }
.yolo-scope .confirm-strip { flex-basis: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid color-mix(in srgb, var(--y-danger-text) 40%, transparent); border-radius: var(--y-r-sm); font-size: 11px; color: var(--y-danger-text); animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }

/* folds (36px/row) */
.yolo-scope .fold { margin-top: 16px; border-top: 1px solid var(--y-line); }
.yolo-scope .fold-head { display: flex; align-items: center; gap: 8px; height: 36px; cursor: pointer; color: var(--y-text-2); font-size: 13px; user-select: none; border: none; background: none; width: 100%; text-align: left; padding: 0; }
.yolo-scope .fold-head:hover { color: var(--y-text-1); }
.yolo-scope .fold-head svg { width: 12px; height: 12px; transition: transform var(--y-dur-2) var(--y-ease-out); color: var(--y-text-3); flex: none; }
.yolo-scope .fold.open .fold-head svg { transform: rotate(90deg); }
.yolo-scope .fold-stat { margin-left: auto; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--y-text-3); white-space: nowrap; }
.yolo-scope .fold-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .fold.open .fold-body { grid-template-rows: 1fr; }
.yolo-scope .fold-inner { min-height: 0; overflow: hidden; }

/* goals — tick-mark progress bar (5.5) */
.yolo-scope .goal { padding: 10px 0 6px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .goal:last-child { border-bottom: none; }
.yolo-scope .goal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.yolo-scope .goal-name { font-size: 13px; font-weight: 600; cursor: text; border: none; background: none; color: var(--y-text-1); padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.yolo-scope .goal-name:hover { text-decoration: underline dotted var(--y-text-3); }
.yolo-scope .goal-name-input { height: 26px; padding: 0 8px; border: 1px solid var(--y-accent-text); border-radius: var(--y-r-sm); background: var(--y-surface); color: var(--y-text-1); font-size: 13px; font-weight: 600; outline: none; width: 60%; }
.yolo-scope .goal-pct { font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 12px; font-weight: 600; color: var(--y-accent-text); flex: none; }
.yolo-scope .goal-track { position: relative; height: 4px; margin: 0 8px 46px; border-radius: 2px; background: var(--y-line-strong); }
.yolo-scope .goal-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--y-accent-fill); transition: width var(--y-dur-3) var(--y-ease-out); }
.yolo-scope .ms-dot { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 9px; height: 9px; border-radius: 50%; background: var(--y-bg); border: 1.5px solid var(--y-line-strong); cursor: pointer; padding: 0; transition: transform var(--y-dur-1); }
.yolo-scope .ms-dot:hover { transform: translate(-50%, -50%) scale(1.25); }
.yolo-scope .ms-dot.done { background: var(--y-ok-text); border-color: var(--y-ok-text); }
.yolo-scope .ms-dot.active { background: var(--y-accent-fill); border-color: var(--y-accent-fill); }
.yolo-scope .ms-dot.hl { box-shadow: 0 0 0 3px var(--y-accent-soft); }
.yolo-scope .ms-label { position: absolute; left: 0; transform: translateX(-50%); text-align: center; font-size: 10px; line-height: 13px; color: var(--y-text-3); white-space: nowrap; pointer-events: none; }
.yolo-scope .ms-dot:nth-child(odd) .ms-label { top: 11px; }
.yolo-scope .ms-dot:nth-child(even) .ms-label { top: 26px; }
.yolo-scope .ms-label b { display: block; font-weight: 500; color: var(--y-text-2); max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.yolo-scope .ms-label i { font-style: normal; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; }
.yolo-scope .ms-pop { position: absolute; bottom: 16px; left: var(--x, 50%); transform: translateX(-50%); width: 168px; background: var(--y-surface); border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); box-shadow: var(--y-e1); padding: 8px; z-index: 10; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .ms-pop input { width: 100%; height: 26px; padding: 0 8px; margin-bottom: 6px; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: var(--y-surface-2); color: var(--y-text-1); font-size: 11px; outline: none; }
.yolo-scope .ms-pop input:focus { border-color: var(--y-accent-text); }
.yolo-scope .ms-pop-row { display: flex; gap: 4px; }
.yolo-scope .ms-st { flex: 1; height: 22px; border: none; border-radius: 4px; background: var(--y-surface-2); color: var(--y-text-2); font-size: 10px; cursor: pointer; }
.yolo-scope .ms-st:hover { background: var(--y-surface-3); color: var(--y-text-1); }
.yolo-scope .ms-st.on { background: var(--y-accent-soft); color: var(--y-accent-text); }

/* ledger (5.6) */
.yolo-scope .lg-row { display: flex; align-items: center; gap: 8px; height: 28px; border-bottom: 1px solid var(--y-line); font-size: 12px; }
.yolo-scope .lg-row:last-child { border-bottom: none; }
.yolo-scope .lg-row .ic-ok { width: 12px; height: 12px; color: var(--y-ok-text); flex: none; }
.yolo-scope .lg-time { width: 40px; flex: none; font-family: var(--y-font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--y-text-3); }
.yolo-scope .lg-type { width: 36px; flex: none; font-size: 11px; color: var(--y-text-2); }
.yolo-scope .lg-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--y-text-1); }
.yolo-scope .lg-row.is-done .lg-sum { color: var(--y-text-2); }
.yolo-scope .lg-src { flex: none; display: flex; align-items: center; gap: 4px; max-width: 150px; font-size: 11px; color: var(--y-text-3); }
.yolo-scope .lg-src svg { width: 10px; height: 10px; flex: none; opacity: .7; }
.yolo-scope .lg-src span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .lg-src-btn { flex: none; display: inline-flex; align-items: center; gap: 3px; max-width: 150px; border: none; background: none; padding: 1px 4px; margin-right: -4px; border-radius: 4px; font-size: 11px; color: var(--y-text-3); cursor: pointer; transition: all var(--y-dur-1); }
.yolo-scope .lg-src-btn:hover { color: var(--y-accent-text); background: var(--y-accent-soft); }
.yolo-scope .lg-src-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* empty / skeleton (5.7) */
.yolo-scope .empty { padding: 40px 16px; text-align: center; }
.yolo-scope .empty h4 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: var(--y-text-2); }
.yolo-scope .empty p { margin: 0; font-size: 12px; color: var(--y-text-3); }
.yolo-scope .err-line { display: flex; align-items: center; gap: 10px; padding: 12px 2px 0; color: var(--y-danger-text); font-size: 13px; }
.yolo-scope .skel-notif, .yolo-scope .skel-row, .yolo-scope .skel-head { background: var(--y-surface-2); border-radius: var(--y-r-sm); background-image: linear-gradient(100deg, transparent 40%, var(--y-surface-3) 50%, transparent 60%); background-size: 200% 100%; animation: yolo-shimmer 1.5s infinite; }
.yolo-scope .skel-notif { height: 88px; margin: 14px 0 8px; }
.yolo-scope .skel-row { height: 40px; margin: 8px 0; }
.yolo-scope .skel-head { height: 12px; width: 90px; margin: 18px 0 6px; }
@keyframes yolo-shimmer { to { background-position: -200% 0; } }

/* capture bar (52px) */
.yolo-scope .capture { flex: none; height: 52px; display: flex; align-items: center; padding: 0 16px; background: var(--y-bg); border-top: 1px solid var(--y-line); }
.yolo-scope .cap-input { flex: 1; height: 36px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--y-r-md); background: var(--y-surface-2); color: var(--y-text-1); font-size: 13px; outline: none; transition: all var(--y-dur-2); }
.yolo-scope .cap-input::placeholder { color: var(--y-text-3); }
.yolo-scope .cap-input:focus { background: var(--y-surface); border-color: var(--y-line-strong); box-shadow: 0 0 0 3px var(--y-accent-soft); }
.yolo-scope .enter-hint { margin-left: 10px; font-size: 11px; color: var(--y-text-3); transition: color var(--y-dur-1); font-family: var(--y-font-mono); }
.yolo-scope .enter-hint.lit { color: var(--y-accent-text); }

/* messages (chat) */
.yolo-scope .msgs { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 16px; }
.yolo-scope .msg { max-width: 78%; font-size: 13px; line-height: 19px; animation: yolo-row-in var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .msg.ai { align-self: flex-start; color: var(--y-text-1); white-space: pre-wrap; word-break: break-word; }
.yolo-scope .msg.me { align-self: flex-end; background: var(--y-surface-2); border-radius: var(--y-r-md); padding: 8px 11px; white-space: pre-wrap; word-break: break-word; }
.yolo-scope .msg .who { font-size: 10px; color: var(--y-text-3); margin-bottom: 3px; }

/* side chat dock (4.2⑧) — surface, hairline left, NO shadow (docked ≠ floating) */
.yolo-scope .dock { flex: none; width: min(340px, 45%); background: var(--y-surface); border-left: 1px solid var(--y-line); display: flex; flex-direction: column; min-width: 0; animation: yolo-dock-in var(--y-dur-3) var(--y-ease-out); }
@keyframes yolo-dock-in { from { opacity: 0; transform: translateX(12px); } }
.yolo-scope .dock-head { flex: none; height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--y-line); }
.yolo-scope .dock-tag { font-size: 12px; font-weight: 600; flex: none; }
.yolo-scope .dock-ctx { font-size: 11px; color: var(--y-accent-text); border-left: 2px solid var(--y-accent-fill); padding-left: 8px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yolo-scope .dact { height: 22px; padding: 0 8px; margin-left: auto; border: 1px solid var(--y-line-strong); border-radius: var(--y-r-sm); background: none; color: var(--y-text-2); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all var(--y-dur-1); white-space: nowrap; }
.yolo-scope .dact:hover { background: var(--y-surface-2); color: var(--y-text-1); }
.yolo-scope .dact .tico { display: grid; place-items: center; }
.yolo-scope .dact .tico svg { width: 11px; height: 11px; }
.yolo-scope .dock-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; }
.yolo-scope .dock-input { flex: none; display: flex; align-items: center; padding: 10px 12px; border-top: 1px solid var(--y-line); }
.yolo-scope .dock-input input { flex: 1; height: 34px; padding: 0 11px; border: 1px solid transparent; border-radius: var(--y-r-md); background: var(--y-surface-2); color: var(--y-text-1); font-size: 13px; outline: none; transition: all var(--y-dur-2); }
.yolo-scope .dock-input input::placeholder { color: var(--y-text-3); }
.yolo-scope .dock-input input:focus { background: var(--y-bg); border-color: var(--y-line-strong); }

/* footer (28px) */
.yolo-scope .p-foot { flex: none; height: 28px; display: flex; align-items: center; padding: 0 16px; border-top: 1px solid var(--y-line); font-size: 10px; color: var(--y-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* full-screen chat anchor strip (4.2⑨) */
.yolo-scope .fs-anchor { margin: 14px 0 0; padding: 6px 10px; border-left: 2px solid var(--y-accent-fill); font-size: 11px; color: var(--y-text-2); }

/* toast (5.1) */
.yolo-scope .toast { position: fixed; bottom: 64px; left: 50%; transform: translate(-50%, 4px); opacity: 0; pointer-events: none; display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: var(--y-surface); border: 1px solid var(--y-line-strong); border-radius: var(--y-r-md); box-shadow: var(--y-e1); font-size: 12px; color: var(--y-text-1); z-index: 60; transition: transform var(--y-dur-2) var(--y-ease-out), opacity var(--y-dur-2) var(--y-ease-out); }
.yolo-scope .toast.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
.yolo-scope .toast button { border: none; background: none; color: var(--y-accent-text); font-size: 12px; font-weight: 500; cursor: pointer; padding: 0; }

/* narrow panel (4.3 Compact) */
.yolo-scope.compact .p-date { display: none; }
.yolo-scope.compact .p-toolbar { height: auto; flex-wrap: wrap; padding: 6px 12px; row-gap: 6px; }
.yolo-scope.compact .seg { height: 28px; }
.yolo-scope.compact .seg-btn.on::after { bottom: auto; top: 24px; }

/* reduced motion — everything degrades to instant swaps (6.3) */
@media (prefers-reduced-motion: reduce) {
  .yolo-scope *, .yolo-scope *::before, .yolo-scope *::after { animation: none !important; transition: none !important; }
}
`
