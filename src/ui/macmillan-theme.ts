/**
 * Styles of the in-page panel. The values are taken from Macmillan Education Everywhere's own stylesheet
 * (--theme-color-*, 4px/8px radii, Open Sans, 2px bordered buttons that turn black on hover, its shadow and status
 * colours), so the panel reads as part of the site. It lives in a shadow root, so nothing leaks in or out.
 */
export const MACMILLAN_THEME_CSS = `
:host { all: initial; }

.sp {
  --blue-50: #ECF1FB; --blue-100: #D8E2F6; --blue-500: #3C6ED2; --blue-700: #24427E;
  --n-50: #F1F1F1; --n-100: #E3E3E3; --n-200: #C7C7C7; --n-700: #444444; --n-900: #171717;
  --green: #0D842F; --green-50: #E7F3EA; --green-100: #CFE6D5; --green-700: #084F1C;
  --red: #DC2636; --red-50: #FCE9EB; --red-100: #F8D4D7; --red-700: #841720;
  --yellow-50: #FFFAEC; --yellow-200: #FDECB1; --yellow-800: #645318;
  --shadow: 0 2px 4px #00000040;

  position: fixed;
  right: 20px;
  bottom: 96px;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-family: 'Open Sans', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--n-900);
  box-sizing: border-box;
}
.sp *, .sp *::before, .sp *::after { box-sizing: border-box; }
.sp [hidden] { display: none !important; }
.sp button { font: inherit; cursor: pointer; margin: 0; }
.sp button:focus-visible, .sp input:focus-visible { outline: 2px solid #000; outline-offset: 2px; }

/* ---- dock: the "fast solve" button and the panel toggle ---- */
.sp-dock { display: flex; box-shadow: var(--shadow); border-radius: 4px; }
.sp-fast, .sp-toggle {
  display: flex; align-items: center; gap: 8px;
  background: var(--blue-500); color: #fff;
  border: 2px solid var(--blue-500);
  font-weight: 600;
}
.sp-fast { padding: 10px 16px; border-radius: 4px 0 0 4px; min-width: 150px; justify-content: center; }
.sp-toggle { padding: 10px 10px; border-radius: 0 4px 4px 0; border-left-color: rgba(255, 255, 255, 0.45); }
.sp-fast:hover:not(:disabled), .sp-toggle:hover:not(:disabled) { background: #000; border-color: #000; }
.sp-fast:disabled { cursor: progress; background: var(--blue-700); border-color: var(--blue-700); }
.sp[data-open="true"] .sp-toggle svg { transform: rotate(180deg); }
.sp-icon { width: 16px; height: 16px; flex: none; }

/* ---- optional "solve everything" section ---- */
.sp-series { display: grid; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--n-100); }
.sp-series-title { font-weight: 600; font-size: 13px; }
.sp-series-hint { margin: 0; font-size: 12px; color: var(--n-700); }
.sp-series-row { display: flex; align-items: flex-end; gap: 8px; }
.sp-field { display: grid; gap: 2px; font-size: 11px; color: var(--n-700); }
.sp-number {
  width: 64px; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--n-900);
  background: #fff; border: 1px solid var(--n-200); border-radius: 4px;
}
.sp-number:focus { border-color: var(--blue-500); }
.sp-series-start { flex: 1; }
.sp-confirm { padding: 8px 10px; border: 1px solid var(--yellow-200); border-radius: 4px; background: var(--yellow-50); }
.sp-confirm-text { margin: 0 0 8px; font-size: 12px; color: var(--yellow-800); }
.sp-stop { color: var(--red); border-color: var(--red); }
.sp-stop:hover:not(:disabled) { background: var(--red); border-color: var(--red); color: #fff; }

/* ---- small bubble with the latest message while the panel is closed ---- */
.sp-toast {
  max-width: min(340px, calc(100vw - 40px));
  padding: 10px 14px; border-radius: 8px; box-shadow: var(--shadow);
  background: #fff; border: 1px solid var(--n-100); border-left: 4px solid var(--blue-500);
  font-size: 13px;
}
.sp-toast[data-tone="success"] { border-left-color: var(--green); background: var(--green-50); color: var(--green-700); }
.sp-toast[data-tone="error"] { border-left-color: var(--red); background: var(--red-50); color: var(--red-700); }
.sp-toast[data-tone="warning"] { border-left-color: #FBD03D; background: var(--yellow-50); color: var(--yellow-800); }

/* ---- panel ---- */
.sp-panel {
  display: flex; flex-direction: column;
  width: min(380px, calc(100vw - 40px));
  max-height: min(70vh, 560px);
  background: #fff;
  border: 1px solid var(--n-100); border-radius: 8px;
  box-shadow: 0 4px 8px #00000040;
  overflow: hidden;
}
.sp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: var(--blue-500); color: #fff; font-weight: 600;
}
.sp-close { background: transparent; color: #fff; border: 0; font-size: 20px; line-height: 1; padding: 0 4px; border-radius: 4px; }
.sp-close:hover { background: rgba(255, 255, 255, 0.2); }

.sp-status {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; font-size: 13px;
  background: var(--blue-50); border-bottom: 1px solid var(--blue-100); color: var(--blue-700);
}
.sp-status[data-tone="success"] { background: var(--green-50); border-bottom-color: var(--green-100); color: var(--green-700); }
.sp-status[data-tone="error"] { background: var(--red-50); border-bottom-color: var(--red-100); color: var(--red-700); }
.sp-status[data-tone="warning"] { background: var(--yellow-50); border-bottom-color: var(--yellow-200); color: var(--yellow-800); }
.sp-spinner {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: sp-spin 0.8s linear infinite;
}
@keyframes sp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sp-spinner { animation: none; } }

.sp-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.sp-item {
  display: grid; grid-template-columns: 24px 1fr 20px; gap: 8px; align-items: start;
  padding: 10px 16px; border-bottom: 1px solid var(--n-50);
}
.sp-num {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--blue-50); color: var(--blue-700); font-weight: 600; font-size: 12px;
}
.sp-prompt { margin: 0 0 6px; font-size: 12px; color: var(--n-700); overflow-wrap: anywhere; }
.sp-answer {
  width: 100%; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--n-900);
  background: #fff; border: 1px solid var(--n-200); border-radius: 4px;
}
.sp-answer:focus { border-color: var(--blue-500); }
.sp-answer::placeholder { color: var(--n-200); }
.sp-why { margin: 4px 0 0; font-size: 12px; color: var(--n-700); }
.sp-error { margin: 4px 0 0; font-size: 12px; color: var(--red-700); }
.sp-mark { font-weight: 700; text-align: center; }
.sp-item[data-status="filled"] .sp-mark { color: var(--green); }
.sp-item[data-status="failed"] .sp-mark { color: var(--red); }
.sp-empty { padding: 16px; font-size: 13px; color: var(--n-700); }

.sp-actions { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--n-100); }
.sp-btn {
  flex: 1; padding: 8px 10px; font-weight: 600;
  background: #fff; color: var(--blue-500);
  border: 2px solid var(--blue-500); border-radius: 4px;
}
.sp-btn:hover:not(:disabled) { background: #000; border-color: #000; color: #fff; }
.sp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;
