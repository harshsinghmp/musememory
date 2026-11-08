/**
 * Studio static assets (Wave 23 / T-453).
 *
 * The inspector used to be one 2,700-line template literal. CSS, markup and the
 * client script now live here as separate modules, each served from a stable
 * route with a strong ETag and a pre-compressed gzip buffer, so repeat loads
 * cost a 304 (or one cached body) instead of re-rendering the whole page.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Store } from "./store.ts";
import { list } from "./store.ts";

export const STUDIO_CSS = `    :root {
      --bg: #0c0a09;
      --bg-alt: #12100d;
      --panel: #17130f;
      --panel-hover: #1f1913;
      --panel-border: rgba(245, 235, 220, 0.10);
      --panel-border-glow: rgba(245, 158, 11, 0.35);
      --text: #f2e9dc;
      --text-muted: #c8b8a4;
      --text-dim: #9c8871;
      --accent: #f59e0b;
      --accent-glow: rgba(245, 158, 11, 0.25);
      --accent-gradient: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
      --cyan: #06b6d4;
      --pink: #ec4899;
      --shadow-sm: 0 2px 8px rgba(0,0,0,0.4);
      --shadow-md: 0 8px 24px rgba(0,0,0,0.6);
      --shadow-glow: 0 0 20px rgba(99,102,241,0.2);
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --radius-full: 9999px;
      --transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'JetBrains Mono', ui-monospace, monospace; }
    code, pre, .mono { font-family: 'JetBrains Mono', monospace; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; -webkit-font-smoothing: antialiased; }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: var(--radius-full); }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
    
    /* Header */
    header { background: rgba(23, 19, 15, 0.92); backdrop-filter: blur(16px); border-bottom: 1px solid var(--panel-border); padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; z-index: 40; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .brand-title { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
    .brand-tag { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: var(--radius-full); background: rgba(99,102,241,0.15); color: #fbbf24; border: 1px solid rgba(99,102,241,0.25); text-transform: uppercase; letter-spacing: 0.04em; }
    
    /* Navigation Tabs */
    .nav-tab { padding: 6px 14px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; transition: var(--transition); display: flex; align-items: center; gap: 6px; border: none; background: transparent; }
    .nav-tab:hover { color: #fff; background: rgba(255,255,255,0.05); }
    .nav-tab.active { color: #fff; background: var(--panel); box-shadow: var(--shadow-sm); border: 1px solid var(--panel-border); }
    
    /* Stats & Quick Actions */
    .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
    .scope-filter { display: flex; align-items: center; gap: 8px; }
    .scope-filter-label { font-size: 10px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    .scope-filter-input { width: 140px; background: #0a0806; border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 6px 10px; color: #fff; font-size: 12px; outline: none; transition: var(--transition); }
    .scope-filter-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .status-badge { font-size: 12px; font-weight: 600; background: rgba(16,185,129,0.12); color: var(--green); padding: 5px 12px; border-radius: var(--radius-full); border: 1px solid rgba(16,185,129,0.25); display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); }
    .btn-icon { background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); color: var(--text-muted); padding: 6px 12px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; transition: var(--transition); display: inline-flex; align-items: center; gap: 6px; }
    .btn-icon:hover { background: rgba(255,255,255,0.09); color: #fff; border-color: rgba(255,255,255,0.18); }
    .btn-refresh { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); color: #fcd34d; }
    .btn-refresh:hover { background: rgba(99, 102, 241, 0.24); color: #fff; border-color: rgba(99, 102, 241, 0.6); }
    .btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }
    .refresh-icon::before { content: "↻"; }
    .optimize-icon::before { content: "◇"; }
    .refresh-icon.spinning { display: inline-block; animation: spin 0.8s linear infinite; }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    .btn-primary { background: var(--accent-gradient); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow-glow); }
    .btn-primary:hover { opacity: 0.92; transform: translateY(-1px); }
    
    /* Main Layout */
    .layout { display: flex; flex: 1; overflow: hidden; position: relative; }
    
    /* Sidebar */
    .sidebar { width: 380px; min-width: 0; background: var(--panel); border-right: 1px solid var(--panel-border); display: flex; flex-direction: column; z-index: 20; }
    .search-box { padding: 12px 16px; border-bottom: 1px solid var(--panel-border); position: relative; }
    .search-input-wrap { position: relative; width: 100%; }
    .search-input-wrap input { width: 100%; background: #0a0806; border: 1px solid var(--panel-border); padding: 9px 12px 9px 34px; border-radius: var(--radius-md); color: #fff; outline: none; font-size: 13px; transition: var(--transition); }
    .search-input-wrap input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-dim); display: flex; align-items: center; pointer-events: none; }
    
    .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--panel-border); font-size: 12px; background: rgba(0,0,0,0.15); }
    .chip { font: inherit; color: inherit; padding: 4px 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); border-radius: var(--radius-full); cursor: pointer; white-space: nowrap; color: var(--text-muted); font-size: 11px; font-weight: 600; transition: var(--transition); }
    .chip:hover { color: #fff; background: rgba(255,255,255,0.08); }
    .chip.active { background: var(--accent); color: #fff; border-color: var(--accent); box-shadow: 0 2px 8px var(--accent-glow); }
    
    .stats-strip { display: flex; justify-content: space-around; padding: 10px 16px; border-bottom: 1px solid var(--panel-border); background: rgba(0,0,0,0.2); font-size: 11px; }
    .stat-item { text-align: center; }
    .stat-val { font-size: 14px; font-weight: 700; color: #fff; }
    .stat-lbl { color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 1px; }
    
    .list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .card { background: rgba(255,255,255,0.025); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; transition: var(--transition); position: relative; }
    .card:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.045); transform: translateY(-1px); }
    .card.selected { border-color: var(--accent); background: rgba(99,102,241,0.08); box-shadow: 0 4px 16px rgba(99,102,241,0.15); }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px; }
    .card-title { font-size: 13px; font-weight: 600; color: #f8f1e7; flex: 1; line-height: 1.35; }
    .card-type { font-size: 10px; padding: 2px 7px; border-radius: var(--radius-full); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    
    .type-fix { background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.25); }
    .type-decision { background: rgba(99,102,241,0.15); color: #fbbf24; border: 1px solid rgba(99,102,241,0.25); }
    .type-constraint { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.25); }
    .type-failure { background: rgba(245,158,11,0.15); color: var(--yellow); border: 1px solid rgba(245,158,11,0.25); }
    .type-architecture { background: rgba(168,85,247,0.15); color: var(--purple); border: 1px solid rgba(168,85,247,0.25); }
    .type-operation { background: rgba(6,182,212,0.15); color: var(--cyan); border: 1px solid rgba(6,182,212,0.25); }
    .type-preference { background: rgba(236,72,153,0.15); color: var(--pink); border: 1px solid rgba(236,72,153,0.25); }
    .type-discovery { background: rgba(148,163,184,0.15); color: #b8a894; border: 1px solid rgba(148,163,184,0.25); }
    .type-session { background: rgba(100,116,139,0.15); color: #b8a894; border: 1px solid rgba(100,116,139,0.25); }
    
    .card-snippet { font-size: 12px; color: var(--text-muted); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 11px; color: var(--text-dim); }
    .card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .card-tag { font-size: 10px; background: rgba(255,255,255,0.03); padding: 1px 5px; border-radius: 3px; }
    
    /* View Panels */
    .view-panel { flex: 1; display: none; flex-direction: column; overflow: hidden; position: relative; }
    .view-panel.active { display: flex; }
    
    /* Graph View */
    .graph-controls { background: rgba(23, 19, 15, 0.82); backdrop-filter: blur(12px); border-bottom: 1px solid var(--panel-border); padding: 10px 18px; display: flex; flex-direction: column; gap: 8px; z-index: 10; }
    .control-row { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
    .control-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
    #timelineSlider { flex: 1; max-width: 320px; accent-color: var(--accent); }
    .cluster-check { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); padding: 3px 8px; cursor: pointer; user-select: none; font-size: 11px; font-weight: 500; transition: var(--transition); }
    .cluster-check:hover { background: rgba(255,255,255,0.07); }
    .cluster-check input { accent-color: var(--accent); cursor: pointer; }
    .graph-container { flex: 1; position: relative; background: radial-gradient(circle at center, #1a1208 0%, #07090e 100%); }
    canvas { width: 100%; height: 100%; display: block; }
    
    .graph-hud { position: absolute; bottom: 16px; left: 16px; background: rgba(23, 19, 15, 0.92); backdrop-filter: blur(10px); border: 1px solid var(--panel-border); padding: 8px 14px; border-radius: var(--radius-md); font-size: 11px; color: var(--text-muted); pointer-events: none; }
    .graph-hud-key { display: inline-block; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-weight: 600; color: #fff; margin-right: 4px; }
    /* T-454: instant graph/list toggle + sortable table */
    .studio-view-switch { display: inline-flex; gap: 2px; background: rgba(0,0,0,0.35); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 3px; }
    .view-btn { font: inherit; padding: 5px 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; }
    .view-btn:hover { color: var(--text); background: rgba(255,235,210,0.05); }
    .view-btn.active { color: #1a1206; background: var(--accent); border-color: var(--accent); }
    .studio-list-view { flex: 1; overflow: auto; padding: 16px 20px; }
    .studio-list-toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .studio-list-toolbar input { background: #0a0806; border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 8px 12px; color: #fff; font: inherit; font-size: 12px; min-width: 240px; }
    .studio-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .studio-table th { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--panel-border); color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; user-select: none; }
    .studio-table th:hover { color: var(--text); }
    .studio-table th[aria-sort="ascending"]::after { content: " ^"; color: var(--accent); }
    .studio-table th[aria-sort="descending"]::after { content: " v"; color: var(--accent); }
    .studio-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--text-muted); }
    .studio-table tbody tr { cursor: pointer; }
    .studio-table tbody tr:hover td { background: rgba(255,235,210,0.04); color: var(--text); }
    .studio-table .mono { font-size: 11px; }
    
    /* Detail Drawer */
    .detail-pane { width: 440px; min-width: 360px; background: var(--panel); border-left: 1px solid var(--panel-border); padding: 24px; overflow-y: auto; display: none; z-index: 30; }
    .detail-pane.open { display: block; }
    .detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
    .detail-title { font-size: 17px; font-weight: 700; color: #fff; line-height: 1.35; }
    .close-btn { background: transparent; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 4px; border-radius: var(--radius-sm); }
    .close-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
    
    .meta-row { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; font-size: 11px; }
    .meta-tag { background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); padding: 3px 8px; border-radius: var(--radius-sm); color: var(--text-muted); }
    .content-box { background: #0a0806; border: 1px solid var(--panel-border); padding: 14px; border-radius: var(--radius-md); font-size: 13px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 20px; color: #eadfce; }
    
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 7px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--panel-border); outline: none; transition: var(--transition); }
    .btn-green { background: rgba(16,185,129,0.15); color: var(--green); border-color: rgba(16,185,129,0.3); }
    .btn-green:hover { background: var(--green); color: #fff; }
    .btn-yellow { background: rgba(245,158,11,0.15); color: var(--yellow); border-color: rgba(245,158,11,0.3); }
    .btn-yellow:hover { background: var(--yellow); color: #fff; }
    .btn-red { background: rgba(239,68,68,0.15); color: var(--red); border-color: rgba(239,68,68,0.3); }
    .btn-red:hover { background: var(--red); color: #fff; }
    
    /* Content Views (Wiki, Constraints, Persona, Retrieval, Audit) */
    .content-view-wrap { padding: 24px 32px; overflow-y: auto; height: 100%; display: flex; flex-direction: column; gap: 24px; max-width: 1100px; margin: 0 auto; width: 100%; }
    .view-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 20px 24px; box-shadow: var(--shadow-md); }
    .card-title-lg { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
    
    /* Handoff banner */
    .handoff-box { background: linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(168,85,247,0.05) 100%); border: 1px solid var(--panel-border-glow); border-radius: var(--radius-lg); padding: 18px 22px; }
    .handoff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 12px; }
    .handoff-cell { font-size: 12px; }
    .handoff-lbl { font-weight: 700; color: var(--text-dim); text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; margin-bottom: 2px; }
    .handoff-val { color: #f8f1e7; font-weight: 600; }
    
    /* Constraints list */
    .constraint-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); margin-bottom: 8px; font-size: 13px; font-family: 'JetBrains Mono', monospace; }
    
    /* Archetype cards */
    .archetype-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .archetype-card { font: inherit; color: inherit; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 14px; cursor: pointer; transition: var(--transition); text-align: center; }
    .archetype-card:hover { border-color: var(--accent); background: rgba(99,102,241,0.05); transform: translateY(-2px); }
    .archetype-card.active { border-color: var(--accent); background: rgba(99,102,241,0.12); box-shadow: 0 0 16px var(--accent-glow); }
    .archetype-icon { display: block; font-size: 24px; margin-bottom: 8px; }
    .archetype-title { font-weight: 700; font-size: 13px; color: #fff; text-transform: capitalize; }
    
    /* Retrieval Sandbox */
    .sandbox-input-grid { display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-bottom: 16px; }
    .code-preview { background: #0a0806; border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 16px; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: #fcd34d; max-height: 380px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; }
    
    /* Audit Table */
    .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .audit-table th { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--panel-border); color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
    .audit-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--text-muted); }
    .audit-table tr:hover td { background: rgba(255,255,255,0.02); color: #fff; }
    .op-badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }

    /* R15 Studio Styles */
    .grade-circle { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; border: 2px solid var(--panel-border); box-shadow: 0 0 20px rgba(0,0,0,0.5); }
    .grade-a { background: rgba(16,185,129,0.15); color: var(--green); border-color: var(--green); box-shadow: 0 0 20px rgba(16,185,129,0.25); }
    .grade-b { background: rgba(99,102,241,0.15); color: #fbbf24; border-color: #fbbf24; box-shadow: 0 0 20px rgba(99,102,241,0.25); }
    .grade-c { background: rgba(245,158,11,0.15); color: var(--yellow); border-color: var(--yellow); box-shadow: 0 0 20px rgba(245,158,11,0.25); }
    .grade-d, .grade-f { background: rgba(239,68,68,0.15); color: var(--red); border-color: var(--red); box-shadow: 0 0 20px rgba(239,68,68,0.25); }
    
    .gate-badge { padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
    .gate-pass { background: rgba(16,185,129,0.2); color: var(--green); border: 1px solid rgba(16,185,129,0.4); }
    .gate-warn { background: rgba(245,158,11,0.2); color: var(--yellow); border: 1px solid rgba(245,158,11,0.4); }
    .gate-fail { background: rgba(239,68,68,0.2); color: var(--red); border: 1px solid rgba(239,68,68,0.4); }
    
    .pillars-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 16px; }
    .pillar-card { background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .pillar-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .pillar-score { font-size: 20px; font-weight: 800; color: #fff; }
    .p-bar-bg { width: 100%; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; margin: 4px 0; }
    .p-bar-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #10b981); border-radius: 3px; transition: width 0.4s ease; }
    .pillar-meta { font-size: 11px; color: var(--text-dim); display: flex; justify-content: space-between; }
    
    .priority-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .priority-critical { background: rgba(239,68,68,0.2); color: var(--red); border: 1px solid rgba(239,68,68,0.4); }
    .priority-high { background: rgba(245,158,11,0.2); color: var(--yellow); border: 1px solid rgba(245,158,11,0.4); }
    .priority-medium { background: rgba(99,102,241,0.2); color: #fbbf24; border: 1px solid rgba(99,102,241,0.4); }
    .priority-low { background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--panel-border); }
    
    .adr-badge { font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: var(--radius-full); text-transform: uppercase; }
    .adr-accepted { background: rgba(16,185,129,0.2); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
    .adr-proposed { background: rgba(99,102,241,0.2); color: #fbbf24; border: 1px solid rgba(99,102,241,0.3); }
    .adr-superseded { background: rgba(168,85,247,0.2); color: var(--purple); border: 1px solid rgba(168,85,247,0.3); }
    .adr-rejected { background: rgba(239,68,68,0.2); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }

    .drift-badge { font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .drift-documented { background: rgba(16,185,129,0.15); color: var(--green); }
    .drift-implemented { background: rgba(99,102,241,0.15); color: #fbbf24; }
    .drift-partial { background: rgba(245,158,11,0.15); color: var(--yellow); }
    .drift-conflicting, .drift-missing { background: rgba(239,68,68,0.15); color: var(--red); }
    .drift-stale { background: rgba(100,116,139,0.2); color: #b8a894; }

    .badge-cause { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .badge-race_condition { background: rgba(239,68,68,0.2); color: var(--red); }
    .badge-type_drift { background: rgba(245,158,11,0.2); color: var(--yellow); }
    .badge-missing_guard { background: rgba(168,85,247,0.2); color: var(--purple); }
    .badge-resource_leak { background: rgba(236,72,153,0.2); color: var(--pink); }
    .badge-architecture_flaw { background: rgba(99,102,241,0.2); color: #fbbf24; }
    .badge-high { background: rgba(239,68,68,0.2); color: var(--red); }
    .badge-medium { background: rgba(245,158,11,0.2); color: var(--yellow); }
    .badge-low { background: rgba(255,255,255,0.05); color: var(--text-muted); }

    .cluster-card { background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; }
    /* T-456: activity heatmap + agent session cards */
    .heatmap { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); gap: 3px; overflow-x: auto; padding-bottom: 6px; }
    .hm-cell { width: 11px; height: 11px; border-radius: 2px; background: rgba(255,255,255,0.05); }
    .hm-cell.level-1 { background: rgba(245,158,11,0.25); }
    .hm-cell.level-2 { background: rgba(245,158,11,0.45); }
    .hm-cell.level-3 { background: rgba(245,158,11,0.7); }
    .hm-cell.level-4 { background: var(--accent); }
    .heatmap-legend { display: flex; gap: 4px; align-items: center; font-size: 10px; color: var(--text-dim); margin: 4px 0 10px; font-family: 'JetBrains Mono', monospace; }
    .session-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .session-card { background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; }
    .session-card-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .session-status { font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: var(--radius-full); }
    .session-status.active { color: var(--green); background: rgba(16,185,129,0.15); }
    .session-status.done { color: var(--text-muted); background: rgba(255,255,255,0.05); }
    .session-meta { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
    .session-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px; color: var(--text-muted); }
    .activity-empty { font-size: 12px; color: var(--text-dim); }
    /* T-463: poster-style About panel */
    .about-poster { padding: 34px 38px; background: linear-gradient(160deg, rgba(245,158,11,0.10) 0%, rgba(0,0,0,0.25) 55%); }
    .about-kicker { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em; color: var(--accent); margin-bottom: 8px; }
    .about-title { font-size: clamp(24px, 4vw, 40px); line-height: 1.05; color: #fff; margin: 0 0 14px; max-width: 16ch; }
    .about-lede { font-size: 14px; line-height: 1.7; color: var(--text-muted); max-width: 62ch; margin-bottom: 24px; }
    .about-lede code { color: #fcd34d; }
    .about-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .about-fact { background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
    .about-fact span { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }
    .about-fact strong { font-size: 16px; color: #fff; }
    .about-privacy { margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--panel-border); font-size: 10px; letter-spacing: 0.1em; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }
    /* T-464: quick-start onboarding */
    .quickstart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .quickstart-card { background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 8px; }
    .quickstart-step { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
    .quickstart-cmd { display: block; background: #0a0806; border: 1px solid var(--panel-border); border-radius: 6px; padding: 8px 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #fcd34d; word-break: break-all; }
    /* T-465: searchable command deck */
    .command-deck { display: flex; flex-direction: column; gap: 8px; }
    .command-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 10px 12px; }
    .command-row code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #fcd34d; word-break: break-all; }
    .command-desc { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    /* T-460: agents hub */
    .agents-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .agent-card { background: rgba(0,0,0,0.25); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
    .agent-card-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .agent-status { font-size: 9px; font-weight: 800; letter-spacing: 0.05em; padding: 2px 6px; border-radius: var(--radius-full); }
    .agent-status.wired { color: var(--green); background: rgba(16,185,129,0.15); }
    .agent-status.unwired { color: var(--yellow); background: rgba(245,158,11,0.15); }
    .agent-status.absent { color: var(--text-dim); background: rgba(255,255,255,0.05); }
    .agent-meta { font-size: 11px; color: var(--text-dim); word-break: break-all; }
    .agent-actions { display: flex; gap: 6px; margin-top: 6px; }
    /* T-458: terrain vault split-pane */
    .terrain-split { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .terrain-tree { width: 220px; min-width: 180px; border-right: 1px solid var(--panel-border); padding: 12px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; background: rgba(0,0,0,0.15); }
    .terrain-tree-item { display: flex; justify-content: space-between; align-items: center; gap: 6px; font: inherit; font-size: 12px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 8px 10px; cursor: pointer; text-align: left; }
    .terrain-tree-item:hover { color: var(--text); background: rgba(255,235,210,0.05); }
    .terrain-tree-item.active { color: #1a1206; background: var(--accent); border-color: var(--accent); }
    .terrain-tree-item.active .gen-badge { color: #1a1206; border-color: rgba(26,18,6,0.4); }
    .gen-badge { font-size: 8px; font-weight: 800; letter-spacing: 0.06em; padding: 1px 5px; border-radius: var(--radius-full); border: 1px solid var(--panel-border-glow); color: var(--accent); }
    .gen-badge.missing { color: var(--text-dim); border-color: var(--panel-border); }
    .terrain-viewer { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; }
    .terrain-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--panel-border); font-size: 12px; color: var(--text-muted); }
    .terrain-content { flex: 1; overflow: auto; padding: 18px 22px; font-size: 12px; line-height: 1.6; color: var(--text-muted); }
    .terrain-content h2 { font-size: 16px; color: #fff; margin: 4px 0 10px; }
    .terrain-content h3 { font-size: 13px; color: var(--text); margin: 16px 0 6px; }
    .terrain-content h4 { font-size: 12px; color: var(--text); margin: 12px 0 4px; }
    .terrain-content ul { margin: 4px 0 10px 18px; }
    .terrain-content code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #fcd34d; }
    .terrain-content .terrain-row { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 2px 0; }
    .terrain-scanline { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: linear-gradient(180deg, transparent 0%, rgba(245,158,11,0.28) 50%, transparent 100%); background-size: 100% 30%; }
    .terrain-scanline.active { opacity: 1; animation: terrain-scan 0.9s linear; }
    @keyframes terrain-scan { from { background-position: 0 -30%; } to { background-position: 0 130%; } }
    /* ---- Wave 23 / T-451: fixed 76px cyber-minimalist left rail ---- */
    header, .layout { margin-left: 76px; }
    header { flex-wrap: wrap; gap: 10px; }
    .rail { position: fixed; inset: 0 auto 0 0; width: 76px; background: #120f0c; border-right: 1px solid var(--panel-border); display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 12px 6px; z-index: 60; overflow-y: auto; }
    .rail-brand { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 12px; background: var(--accent-gradient); color: #1a1206; display: flex; align-items: center; justify-content: center; font-family: 'Archivo Black', 'JetBrains Mono', sans-serif; font-size: 20px; box-shadow: var(--shadow-glow); flex: 0 0 auto; }
    .rail-section { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 2px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; transition: var(--transition); font-family: 'JetBrains Mono', monospace; line-height: 1.1; }
    .rail-section .rail-num { font-size: 10px; letter-spacing: 0.08em; color: var(--text-dim); }
    .rail-section .rail-name { font-size: 9px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .rail-section:hover { color: var(--text); background: rgba(255, 235, 210, 0.05); }
    .rail-section.active { color: #1a1206; background: var(--accent); border-color: var(--accent); box-shadow: var(--shadow-glow); }
    .rail-section.active .rail-num, .rail-section.active .rail-name { color: #1a1206; }
    .rail-tools { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--panel-border); display: flex; flex-direction: column; gap: 2px; }
    .rail-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 9px; font-family: 'JetBrains Mono', monospace; text-align: center; line-height: 1.2; }
    .rail-tool:hover { color: var(--text); background: rgba(255, 235, 210, 0.05); }
    .rail-tool.active { color: var(--accent); border-color: var(--panel-border-glow); }
    /* ---- Wave 23 / T-452: dual-scope segmented switcher ---- */
    .scope-switch { display: flex; gap: 2px; background: rgba(0, 0, 0, 0.35); border: 1px solid var(--panel-border); border-radius: var(--radius-md); padding: 3px; }
    .scope-btn { padding: 5px 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; cursor: pointer; white-space: nowrap; font-family: 'JetBrains Mono', monospace; }
    .scope-btn:hover { color: var(--text); background: rgba(255, 235, 210, 0.05); }
    .scope-btn.active { color: #1a1206; background: var(--accent); border-color: var(--accent); }
    .scope-badge { font-size: 10px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
    body:not([data-scope="project"]) #dActions, body:not([data-scope="project"]) .write-action { display: none; }
    .scope-banner { margin-left: 76px; padding: 6px 20px; background: rgba(245, 158, 11, 0.12); border-bottom: 1px solid var(--panel-border); color: #fcd34d; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
    h1, h2, h3, h4, h5, h6, .brand-title, .card-title-lg, .grade-circle, .stat-val { font-family: 'Archivo Black', 'JetBrains Mono', sans-serif; letter-spacing: 0; }
    @media (max-width: 900px) { header, .layout { margin-left: 0; } .rail { position: static; width: 100%; flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid var(--panel-border); } .rail-tools { margin-top: 0; border-top: none; flex-direction: row; flex-wrap: wrap; } .rail-brand { margin: 0 8px 0 0; } .rail-section, .rail-tool, .scope-btn { min-height: 44px; min-width: 44px; } .scope-banner { margin-left: 0; } .detail-pane { position: fixed; inset: 0 0 0 auto; width: min(440px, 100%); min-width: 0; z-index: 70; } }
    @media (max-width: 640px) {
      .layout { flex-direction: column; }
      .rail { flex-wrap: nowrap; overflow-x: auto; }
      .rail-tools { flex-wrap: nowrap; }
      .rail-section, .rail-tool { flex: 0 0 auto; }
      .sidebar { width: 100%; flex: 0 0 auto; max-height: 46vh; border-right: none; border-bottom: 1px solid var(--panel-border); }
      .scope-badge, .status-badge, .header .brand-tag { display: none; }
      .scope-filter-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .header-actions { width: 100%; }
      .scope-filter { flex: 1 1 100%; }
      .scope-filter-input { width: 100%; }
      .btn-icon, .scope-btn, .rail-section, .rail-tool, .btn, .chip, .close-btn, .search-input-wrap input { min-height: 44px; min-width: 44px; }
      .view-panel { min-height: 0; }
      .detail-pane { width: 100%; min-width: 0; }
      .close-btn { min-width: 44px; min-height: 44px; }
      .graph-controls .control-row { flex-wrap: wrap; }
      #timelineSlider { width: 100%; max-width: 100%; }
      .sandbox-input-grid { grid-template-columns: 1fr; }
    }
`;

export const STUDIO_JS = `    let allMemories = [];
    let studioScope = 'project';
    let scopeGeneration = 0;
    let studioView = 'graph';
    let listSort = { key: 'created_at', dir: 'desc' };
    let listQuery = '';
    let listDebounce = null;
    function apiUrl(path) {
      if (studioScope === 'project') return path;
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'scope=' + encodeURIComponent(studioScope);
    }
    function setScope(scope, options) {
      studioScope = scope === 'global' || scope === 'mesh' ? scope : 'project';
      scopeGeneration += 1;
      document.querySelectorAll('.scope-btn').forEach(function (b) {
        var active = b.dataset.scope === studioScope;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      document.body.dataset.scope = studioScope;
      var badge = document.getElementById('scopeBadge');
      if (badge) badge.textContent = studioScope === 'global' ? '~/.memory' : studioScope === 'mesh' ? 'mesh' : './.memory';
      var banner = document.getElementById('scopeBanner');
      if (banner) {
        var notes = {
          project: '',
          global: 'Global scope (~/.memory): memory list, stats, constraints, wiki, persona and audit read from the global store. Health, ADRs, Cognition, Sync and Mesh stay project-scoped. Writes target the project store.',
          mesh: 'Mesh scope (read-only, first 200 entries): memory list and total/confirmed/link counts aggregate linked stores. Constraints, wiki, audit and all writes stay project-scoped.'
        };
        banner.textContent = notes[studioScope] || '';
        banner.hidden = studioScope === 'project';
      }
      var url = new URL(window.location.href);
      if (studioScope === 'project') url.searchParams.delete('scope');
      else url.searchParams.set('scope', studioScope);
      window.history.replaceState(null, '', url);
      if (!options || options.refetch !== false) loadData();
    }
    let selectedMemory = null;
    let currentFilter = 'all';
    let searchQuery = '';
    let currentTab = 'graph';

    // T-321: optional project scope for the studio's audit surfaces.
    // An empty value means the whole store; a value scopes the health gate,
    // drift, bug cluster and technical debt audits to that memory project.
    // The initial value comes from the URL query string so a scoped link
    // stays shareable and reloadable.
    let projectScope = (new URLSearchParams(window.location.search).get('project') || '').trim();

    function projectScopeQuery() {
      return projectScope ? '?project=' + encodeURIComponent(projectScope) : '';
    }

    function syncProjectScopeUrl() {
      try {
        const url = new URL(window.location.href);
        if (projectScope) url.searchParams.set('project', projectScope);
        else url.searchParams.delete('project');
        window.history.replaceState({}, '', url.toString());
      } catch (err) {
        console.error('Failed to sync project scope in URL:', err);
      }
    }

    function applyProjectScope(value) {
      projectScope = (value || '').trim();
      syncProjectScopeUrl();
      fetchHealth();
      if (currentTab === 'adrs') fetchDrift();
      if (currentTab === 'cognition') fetchCognition();
    }

    // ---- Graph state (3D force-directed) ----
    const TYPE_COLORS = {
      fix: '#10b981',
      decision: '#fbbf24',
      constraint: '#ef4444',
      failure: '#f59e0b',
      architecture: '#a855f7',
      operation: '#06b6d4',
      preference: '#ec4899',
      discovery: '#94a3b8',
      session: '#64748b'
    };
    let nodes3d = [];
    let edges3d = [];
    let rotX = 0.35, rotY = 0, zoom = 1.4;
    let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let hiddenClusters = new Set();
    let timelineCutoff = null;
    let simAlpha = 1;
    let graphLoopStarted = false;
    // T-455: the loop stops once the layout stops moving; input wakes it.
    const SETTLE_ENERGY = 0.05;
    let graphEnergy = Infinity;
    let documentHidden = false;

    async function refreshMemories() {
      const icon = document.getElementById('refreshIcon');
      const label = document.getElementById('refreshLabel');
      const btn = document.getElementById('refreshBtn');
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = 'Syncing...';
      if (btn) btn.disabled = true;

      try {
        if (studioScope !== 'project') {
          await loadData();
          flash('Refreshed ' + studioScope + ' scope view.');
          return;
        }
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ harvest: true }),
        });
        const info = await res.json();
        await loadData();
        const memCount = info.totalMemories ?? allMemories.length;
        const msg = info.harvestedCount > 0
          ? '✓ Refreshed! Synced ' + info.harvestedCount + ' new + ' + memCount + ' total memories & active state.'
          : '✓ Refreshed! Loaded ' + memCount + ' memories & active state.';
        flash(msg);
      } catch (err) {
        flash('Refresh failed: ' + (err && err.message ? err.message : String(err)), true);
      } finally {
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = 'Refresh';
        if (btn) btn.disabled = false;
      }
    }

    function requireProjectScope() {
      if (studioScope === 'project') return true;
      flash('Writes are project-scoped. Switch to Local Project to modify memories.', true);
      return false;
    }

    async function optimizeStoreDashboard() {
      if (!requireProjectScope()) return;
      const icon = document.getElementById('optimizeIcon');
      const label = document.getElementById('optimizeLabel');
      const btn = document.getElementById('optimizeBtn');
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = 'Optimizing...';
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Optimization failed');
        const rep = data.report;
        await loadData();
        const formatBytes = (b) => {
          if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
          if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
          return b + ' B';
        };
        const spaceMsg = rep.spaceReclaimedBytes > 0 ? ' Reclaimed ' + formatBytes(rep.spaceReclaimedBytes) + '.' : '';
        flash('⚡ Optimization Complete! Pruned ' + rep.totalPruned + ' items (' + rep.prunedNoise + ' noise, ' + rep.prunedJunk + ' junk, ' + rep.prunedDuplicates + ' dupes).' + spaceMsg);
      } catch (err) {
        flash('Optimization failed: ' + (err && err.message ? err.message : String(err)), true);
      } finally {
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = 'Optimize';
        if (btn) btn.disabled = false;
      }
    }

    async function loadData() {
      const requestedScope = studioScope;
      const requestGen = scopeGeneration;
      try {
        if (window.STANDALONE_DATA) {
          allMemories = window.STANDALONE_DATA;
        } else {
          const [memRes] = await Promise.all([
            fetch(apiUrl('/api/memories')),
            fetchStats(),
            fetchCurrentState(),
            fetchWikiPages(),
            fetchUserProfile(),
            loadAudit(),
            fetchActivity(),
            fetchTerrain(),
            fetchAgents(),
            fetchAgentManifest(),
          ]);
          const loaded = await memRes.json();
          if (requestedScope !== studioScope || requestGen !== scopeGeneration) return;
          allMemories = loaded;
        }
        renderList();
        initGraph();
        buildClusterFilters();
        if (!graphLoopStarted) { graphLoopStarted = true; requestAnimationFrame(tick); }
      } catch (err) {
        console.error('Failed to load memories:', err);
        if (requestedScope === studioScope && requestGen === scopeGeneration) {
          allMemories = [];
          renderList();
        }
      }
    }

    async function fetchStats() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/stats'));
        const s = await res.json();
        if (requestGen !== scopeGeneration) return;
        document.getElementById('statTotal').textContent = s.total || 0;
        document.getElementById('statConfirmed').textContent = Math.round((parseFloat(s.confirmedRatio) || 0) * 100) + '%';
        document.getElementById('statConstraints').textContent = s.constraints || 0;
        document.getElementById('statLinks').textContent = s.links || 0;
        renderAbout(s);
        if (studioScope === 'global' && s.available === false) {
          var absent = document.getElementById('scopeBanner');
          if (absent) { absent.textContent = 'No global store found at ~/.memory. Nothing to show in global scope.'; absent.hidden = false; }
        }
      } catch {}
    }

    const QUICK_START_AGENTS = [
      { id: 'claude-code', name: 'Claude Code', command: 'memory connect claude-code --harness claude' },
      { id: 'opencode', name: 'OpenCode', command: 'memory connect opencode' },
      { id: 'cursor', name: 'Cursor', command: 'memory connect cursor' },
      { id: 'antigravity', name: 'Antigravity', command: 'memory connect antigravity' },
    ];

    function copyText(text, label) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flash(label + ' copied.'); },
          function () { flash('Copy failed.', true); }
        );
      } else {
        flash('Clipboard unavailable in this browser.', true);
      }
    }

    const COMMAND_DECK = [
      { command: 'memory recall "<query>"', description: 'Retrieve ranked memories for a task' },
      { command: 'memory capture "<fact>"', description: 'Capture a durable fact or decision' },
      { command: 'memory current', description: 'Show active constraints and handoff state' },
      { command: 'memory brief', description: 'Compile a session brief' },
      { command: 'memory doctor', description: 'Validate the installation and store' },
      { command: 'memory adr create --title "<title>"', description: 'Record an architecture decision' },
      { command: 'memory sync --agent <id>', description: 'Exchange knowledge with peers' },
    ];

    function renderCommandDeck(filter) {
      const deck = document.getElementById('commandDeck');
      if (!deck) return;
      const needle = String(filter || '').toLowerCase();
      deck.innerHTML = '';
      COMMAND_DECK.filter(function (item) {
        return !needle || item.command.toLowerCase().indexOf(needle) >= 0 || item.description.toLowerCase().indexOf(needle) >= 0;
      }).forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'command-row';
        row.innerHTML = '<div><code>' + escapeHtml(item.command) + '</code><div class="command-desc">' + escapeHtml(item.description) + '</div></div>' +
          '<button type="button" class="btn-icon" data-copy-command="' + escapeHtml(item.command) + '">Copy</button>';
        row.querySelector('[data-copy-command]').addEventListener('click', function () {
          copyText(item.command, 'Command');
        });
        deck.appendChild(row);
      });
    }

    function renderQuickStart() {
      const grid = document.getElementById('quickStartGrid');
      if (!grid) return;
      grid.innerHTML = '';
      QUICK_START_AGENTS.forEach(function (agent, index) {
        const card = document.createElement('div');
        card.className = 'quickstart-card';
        card.innerHTML = '<div class="quickstart-step">STEP ' + String(index + 1).padStart(2, '0') + ' · ' + escapeHtml(agent.name) + '</div>' +
          '<code class="quickstart-cmd">' + escapeHtml(agent.command) + '</code>' +
          '<button type="button" class="btn-icon" data-copy-command="' + escapeHtml(agent.command) + '">Copy command</button>';
        card.querySelector('[data-copy-command]').addEventListener('click', function () {
          copyText(agent.command, agent.name + ' command');
        });
        grid.appendChild(card);
      });
    }

    function renderAbout(stats) {
      const scopeLabel = studioScope === 'global' ? '~/.memory' : studioScope === 'mesh' ? 'mesh' : './.memory';
      const set = function (id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      };
      set('aboutScope', scopeLabel);
      set('aboutTotal', stats.total || 0);
      set('aboutConstraints', stats.constraints || 0);
      set('aboutWiki', stats.wikiPages || 0);
      set('aboutAudit', stats.auditEvents || 0);
    }

    async function fetchCurrentState() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/current'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const h = data.handoff;
        if (h) {
          document.getElementById('handoffStatus').textContent = '[' + (h.status || 'IN-PROGRESS') + ']';
          document.getElementById('handoffAgent').textContent = h.agent || 'Unknown';
          document.getElementById('handoffSessionId').textContent = h.sessionId || '--';
          document.getElementById('handoffUpdated').textContent = h.lastUpdated ? new Date(h.lastUpdated).toLocaleTimeString() : '--';
          document.getElementById('handoffTask').textContent = h.task || 'No active task';
          
          let progHtml = '';
          if (h.progress && h.progress.length > 0) {
            progHtml += '<div style="font-weight:700; font-size:11px; color:var(--text-dim); margin-bottom:4px;">PROGRESS CHECKPOINTS:</div>';
            h.progress.forEach(p => { progHtml += '<div style="font-size:12px; color:var(--text); margin-bottom:2px;">• ' + escapeHtml(p) + '</div>'; });
          }
          document.getElementById('handoffProgressBox').innerHTML = progHtml;
        }
        const cList = document.getElementById('constraintsList');
        cList.innerHTML = '';
        if (data.lines && data.lines.length > 0) {
          data.lines.forEach(c => {
            const row = document.createElement('div');
            row.className = 'constraint-row';
            row.textContent = c;
            cList.appendChild(row);
          });
        } else {
          cList.innerHTML = '<div style="font-size:12px; color:var(--text-dim); padding:8px;">No active constraints registered.</div>';
        }
      } catch {}
    }

    async function fetchWikiPages() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/wiki'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const grid = document.getElementById('wikiPagesGrid');
        grid.innerHTML = '';
        document.getElementById('wikiCountBadge').textContent = (data.pages?.length || 0) + ' Pages';
        (data.pages || []).forEach(p => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'archetype-card';
          card.style.textAlign = 'left';
          card.innerHTML = '<span style="display:block; font-weight:700; color:#fff; font-size:14px; margin-bottom:4px;">📖 ' + escapeHtml(p.title) + '</span><span style="display:block; font-size:11px; color:var(--text-dim);">' + escapeHtml(p.slug) + '</span>';
          card.onclick = async () => {
            const pageRes = await fetch(apiUrl('/api/wiki?page=' + encodeURIComponent(p.slug)));
            const pageData = await pageRes.json();
            document.getElementById('wikiViewerCard').style.display = 'block';
            document.getElementById('wikiPageTitle').textContent = '📖 ' + pageData.title;
            document.getElementById('wikiPageContent').textContent = pageData.content;
          };
          grid.appendChild(card);
        });
      } catch {}
    }

    async function fetchUserProfile() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/user-profile'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        if (data.profile) {
          const profile = data.profile;
          const text = typeof profile === 'string' ? profile : (profile.raw || '');
          const archetype = typeof profile === 'object' ? profile.archetype : '';
          document.getElementById('userProfileText').value = text;
          document.querySelectorAll('.archetype-card[data-arch]').forEach(c => {
            const active = c.dataset.arch === archetype;
            if (active) c.classList.add('active');
            else c.classList.remove('active');
          });
        }
      } catch {}
    }

    async function saveUserProfile() {
      if (!requireProjectScope()) return;
      const content = document.getElementById('userProfileText').value;
      await fetch('/api/user-profile', { method: 'POST', body: JSON.stringify({ content }), headers: { 'Content-Type': 'application/json' } });
      flash('User profile saved successfully!');
    }

    async function loadAudit() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/audit'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        (data.trail || []).slice(0, 30).forEach(r => {
          const tr = document.createElement('tr');
          const opColor = r.operation === 'confirm' ? 'var(--green)' : r.operation === 'delete' ? 'var(--red)' : 'var(--accent)';
          tr.innerHTML = \`
            <td class="mono" style="font-size:11px;">\${escapeHtml(new Date(r.timestamp).toLocaleTimeString())}</td>
            <td><span class="op-badge" style="background:rgba(255,255,255,0.06); color:\${escapeHtml(opColor)};">\${escapeHtml(r.operation)}</span></td>
            <td class="mono">\${escapeHtml(r.entry_id)}</td>
            <td>\${escapeHtml(r.actor || 'system')}</td>
            <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${escapeHtml(JSON.stringify(r.details || r.reason || ''))}</td>
          \`;
          tbody.appendChild(tr);
        });
      } catch {}
    }

    async function testRetrieval() {
      const query = document.getElementById('sandboxQuery').value;
      const budget = parseInt(document.getElementById('sandboxBudgetSlider').value, 10);
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, tokenBudget: budget })
      });
      const data = await res.json();
      document.getElementById('promptContextOut').textContent = data.promptContext?.formatted || JSON.stringify(data, null, 2);
    }

    async function quickAddConstraint() {
      if (!requireProjectScope()) return;
      const text = prompt('Enter constraint rule to enforce:');
      if (!text) return;
      await fetch('/api/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      fetchCurrentState();
      flash('Constraint added!');
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderList() {
      const container = document.getElementById('memoryList');
      const fragment = document.createDocumentFragment();

      const q = searchQuery ? searchQuery.toLowerCase() : '';
      const filtered = allMemories.filter(m => {
        if (currentFilter !== 'all' && m.type !== currentFilter) return false;
        if (q) {
          const text = (m.title + ' ' + (m.content || '') + ' ' + (m.tags || []).join(' ')).toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

      filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'card' + (selectedMemory && selectedMemory.id === m.id ? ' selected' : '');
        card.dataset.id = m.id;
        card.innerHTML = \`
          <div class="card-header">
            <div class="card-title">\${escapeHtml(m.title)}</div>
            <div class="card-type type-\${m.type || 'discovery'}">\${m.type || 'discovery'}</div>
          </div>
          <div class="card-snippet">\${escapeHtml(m.content || '')}</div>
          <div class="card-meta">
            <span class="mono">\${m.id}\${m.origin_project ? ' · from ' + escapeHtml(m.origin_project) : ''}</span>
            <div class="card-tags">\${(m.tags || []).slice(0, 3).map(t => '<span class="card-tag">#' + escapeHtml(t) + '</span>').join('')}</div>
          </div>
        \`;
        card.onclick = () => selectMemory(m);
        fragment.appendChild(card);
      });

      container.innerHTML = '';
      container.appendChild(fragment);
      if (studioView === 'list') renderStudioTable();
    }

    function setStudioView(view) {
      studioView = view === 'list' ? 'list' : 'graph';
      document.querySelectorAll('.view-btn').forEach(b => {
        var active = b.dataset.studioView === studioView;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      var graphOnly = document.getElementById('graphOnlyControls');
      if (graphOnly) graphOnly.style.display = studioView === 'graph' ? 'flex' : 'none';
      var graphBox = document.getElementById('graphContainer');
      if (graphBox) graphBox.hidden = studioView !== 'graph';
      var listBox = document.getElementById('studioListView');
      if (listBox) listBox.hidden = studioView !== 'list';
      var label = document.getElementById('studioViewLabel');
      if (label) label.textContent = studioView === 'graph' ? 'Canvas graph' : 'Filterable table';
      if (studioView === 'list') renderStudioTable();
      else wakeGraph();
    }

    function studioRows() {
      var q = listQuery.toLowerCase();
      var rows = allMemories.filter(function (m) {
        if (currentFilter !== 'all' && m.type !== currentFilter) return false;
        if (!q) return true;
        var text = (m.title + ' ' + (m.content || '') + ' ' + (m.tags || []).join(' ')).toLowerCase();
        return text.indexOf(q) >= 0;
      });
      var dir = listSort.dir === 'asc' ? 1 : -1;
      rows.sort(function (a, b) {
        var av = String(a[listSort.key] == null ? '' : a[listSort.key]);
        var bv = String(b[listSort.key] == null ? '' : b[listSort.key]);
        return av.localeCompare(bv) * dir;
      });
      return rows;
    }

    function renderStudioTable() {
      var body = document.getElementById('studioTableBody');
      if (!body) return;
      var rows = studioRows();
      var fragment = document.createDocumentFragment();
      rows.forEach(function (m) {
        var tr = document.createElement('tr');
        tr.dataset.id = m.id;
        tr.innerHTML = '<td><strong>' + escapeHtml(m.title) + '</strong></td>' +
          '<td>' + escapeHtml(m.type || 'discovery') + '</td>' +
          '<td>' + escapeHtml(m.status || '') + '</td>' +
          '<td>' + escapeHtml(m.project || '—') + '</td>' +
          '<td class="mono">' + escapeHtml(String(m.created_at || '').slice(0, 10)) + '</td>';
        tr.onclick = function () { selectMemory(m); };
        fragment.appendChild(tr);
      });
      body.innerHTML = '';
      body.appendChild(fragment);
      var count = document.getElementById('studioListCount');
      if (count) count.textContent = rows.length + ' rows';
      document.querySelectorAll('.studio-table th[data-sort]').forEach(function (th) {
        th.setAttribute('aria-sort', th.dataset.sort === listSort.key ? (listSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }

    function selectMemory(m) {
      if (!m) return;
      selectedMemory = m;
      document.querySelectorAll('#memoryList .card.selected').forEach(c => c.classList.remove('selected'));
      const activeCard = document.querySelector(\`#memoryList .card[data-id="\${m.id}"]\`);
      if (activeCard) activeCard.classList.add('selected');

      const pane = document.getElementById('detailPane');
      pane.classList.add('open');
      document.getElementById('dTitle').textContent = m.title;

      const meta = document.getElementById('dMeta');
      meta.innerHTML = \`
        <span class="meta-tag mono">ID: \${m.id}</span>
        <span class="meta-tag">Status: \${m.status}</span>
        <span class="meta-tag">Salience: \${m.salience || 0.5}</span>
        <span class="meta-tag">Verification: \${m.verification ? m.verification.level : 'unverified'}</span>
        <span class="meta-tag">Links: \${(m.related_memory_ids || []).length}</span>
      \`;

      document.getElementById('dContent').textContent = m.content;

      const actions = document.getElementById('dActions');
      actions.innerHTML = '';
      if (m.status !== 'confirmed') {
        const cBtn = document.createElement('button');
        cBtn.className = 'btn btn-green';
        cBtn.textContent = 'Confirm Memory';
        cBtn.onclick = () => confirmMem(m.id);
        actions.appendChild(cBtn);
      }
      if (m.status === 'active' || m.status === 'confirmed') {
        const sBtn = document.createElement('button');
        sBtn.className = 'btn btn-yellow';
        sBtn.textContent = 'Mark Stale';
        sBtn.onclick = () => staleMem(m.id);
        actions.appendChild(sBtn);
      }
      const dBtn = document.createElement('button');
      dBtn.className = 'btn btn-red';
      dBtn.textContent = 'Delete';
      dBtn.onclick = async () => {
        if (confirm('Delete memory ' + m.id + '?')) {
          await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) });
          loadData();
          pane.classList.remove('open');
          flash('Deleted memory ' + m.id);
        }
      };
      actions.appendChild(dBtn);
    }

    async function confirmMem(id) {
      return mutateMemory(id, '/api/confirm');
    }

    async function staleMem(id) {
      return mutateMemory(id, '/api/mark-stale');
    }

    function flash(msg, isError) {
      let el = document.getElementById('flashMsg');
      if (!el) {
        el = document.createElement('div');
        el.id = 'flashMsg';
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:999;max-width:380px;display:none;box-shadow:0 8px 30px rgba(0,0,0,0.6);backdrop-filter:blur(10px);';
        document.body.appendChild(el);
      }
      el.style.background = isError ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
      el.style.color = '#fff';
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
    }

    async function mutateMemory(id, endpoint) {
      if (!requireProjectScope()) return;
      try {
        const body = endpoint === '/api/mark-stale' ? { id, reason: 'Marked via Web UI' } : { id };
        const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
          let msg = \`HTTP \${res.status}\`;
          try { msg = (await res.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        await loadData();
        const updated = allMemories.find(m => m.id === id);
        if (updated) selectMemory(updated);
        flash(endpoint === '/api/mark-stale' ? 'Marked stale' : 'Confirmed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        flash('Action failed: ' + msg, true);
      }
    }

    function nodeVisible(n) {
      if (hiddenClusters.has('project:' + (n.project || 'none'))) return false;
      if (hiddenClusters.has('type:' + n.type)) return false;
      if (timelineCutoff && n.updatedAt < timelineCutoff) return false;
      if (currentFilter !== 'all' && n.type !== currentFilter) return false;
      if (searchQuery) {
        const text = (n.title + ' ' + (n.content || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
        if (!text.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    }

    let needsRedraw = true;
    function requestRedraw() {
      needsRedraw = true;
    }

    function initGraph() {
      const byId = new Map(nodes3d.map(n => [n.id, n]));
      const degreeOf = new Map();
      for (const m of allMemories) {
        for (const rid of (m.related_memory_ids || [])) {
          degreeOf.set(m.id, (degreeOf.get(m.id) || 0) + 1);
        }
      }
      nodes3d = allMemories.map((m, i) => {
        const prev = byId.get(m.id);
        const angle = (i / Math.max(1, allMemories.length)) * Math.PI * 2;
        return {
          id: m.id,
          title: m.title,
          type: m.type || 'discovery',
          status: m.status,
          project: m.project,
          content: m.content || '',
          tags: m.tags || [],
          updatedAt: m.updated_at || '',
          degree: degreeOf.get(m.id) || 0,
          x: prev ? prev.x : Math.cos(angle) * 260,
          y: prev ? prev.y : Math.sin(angle * 2) * 45,
          z: prev ? prev.z : Math.sin(angle) * 260,
        };
      });

      const nodeMap = new Map(nodes3d.map(n => [n.id, n]));
      edges3d = [];
      for (const m of allMemories) {
        const a = nodeMap.get(m.id);
        if (!a) continue;
        for (const rid of (m.related_memory_ids || [])) {
          const b = nodeMap.get(rid);
          if (b) edges3d.push([a, b]);
        }
      }
      simAlpha = 1;
      graphEnergy = Infinity;
      needsRedraw = true;
    }

    function simulateStep() {
      if (nodes3d.length === 0 || simAlpha <= 0.03) { graphEnergy = 0; return; }
      const alpha = simAlpha;
      let energy = 0;
      for (let i = 0; i < nodes3d.length; i++) {
        const a = nodes3d[i];
        for (let j = i + 1; j < nodes3d.length; j++) {
          const b = nodes3d[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          let dist2 = dx * dx + dy * dy + dz * dz + 0.01;
          const force = (2400 * alpha) / dist2;
          const dist = Math.sqrt(dist2);
          dx /= dist; dy /= dist; dz /= dist;
          a.x += dx * force; a.y += dy * force; a.z += dz * force;
          b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
          energy += Math.abs(force) * 2;
        }
      }
      for (let i = 0; i < edges3d.length; i++) {
        const [a, b] = edges3d[i];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const target = 120;
        const force = ((dist - target) / dist) * 0.02 * alpha;
        a.x += dx * force; a.y += dy * force; a.z += dz * force;
        b.x -= dx * force; b.y -= dy * force; b.z -= dz * force;
        energy += Math.abs(force) * 2;
      }
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        n.x *= (1 - 0.002 * alpha);
        n.y *= (1 - 0.002 * alpha);
        n.z *= (1 - 0.002 * alpha);
        energy += (Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z)) * 0.002 * alpha;
      }
      simAlpha = Math.max(0.02, simAlpha * 0.985);
      graphEnergy = energy / nodes3d.length;
    }

    function project(x, y, z, width, height) {
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      let x1 = x * cosY - z * sinY;
      let z1 = x * sinY + z * cosY;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      let y1 = y * cosX - z1 * sinX;
      let z2 = y * sinX + z1 * cosX;
      const fov = 600;
      const scale = (fov / (fov + z2 + 400)) * zoom;
      return { sx: width / 2 + x1 * scale, sy: height / 2 + y1 * scale, scale };
    }

    function drawGraph(canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!nodes3d.length) {
        ctx.fillStyle = '#8b949e';
        ctx.font = '14px sans-serif';
        ctx.fillText('No memories yet — capture some first.', canvas.width / 2 - 110, canvas.height / 2);
        return;
      }

      const projected = new Map();
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        n.visible = nodeVisible(n);
        if (n.visible) projected.set(n, project(n.x, n.y, n.z, canvas.width, canvas.height));
      }

      // Edges with glow
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < edges3d.length; i++) {
        const [a, b] = edges3d[i];
        if (!a || !b || !a.visible || !b.visible) continue;
        const pa = projected.get(a), pb = projected.get(b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }

      // Nodes
      for (let i = 0; i < nodes3d.length; i++) {
        const n = nodes3d[i];
        if (!n.visible) continue;
        const p = projected.get(n);
        if (!p) continue;
        const radius = (6 + Math.min(10, n.degree * 2)) * p.scale;
        
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.type] || '#8b949e';
        ctx.globalAlpha = n.status === 'stale' || n.status === 'superseded' ? 0.35 : 1;
        ctx.fill();
        ctx.strokeStyle = selectedMemory && selectedMemory.id === n.id ? '#ffffff' : '#090d14';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (nodes3d.length <= 40 || zoom > 1.4) {
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '500 11px JetBrains Mono, monospace';
          ctx.fillText(n.title.slice(0, 26), p.sx + radius + 6, p.sy + 4);
        }
      }
    }

    function tick() {
      if (documentHidden) {
        graphLoopStarted = false;
        return;
      }
      if (currentTab === 'graph') {
        const canvas = document.getElementById('graphCanvas');
        if (canvas) {
          const parent = canvas.parentElement;
          if (parent) {
            const w = parent.clientWidth;
            const h = parent.clientHeight;
            if (w > 0 && (canvas.width !== w || canvas.height !== h)) {
              canvas.width = w;
              canvas.height = h;
              needsRedraw = true;
            }
          }
          if (simAlpha > 0.03) {
            simulateStep();
            needsRedraw = true;
          }
          if (needsRedraw || dragging) {
            drawGraph(canvas);
            needsRedraw = false;
          }
          if (!dragging && graphEnergy < SETTLE_ENERGY) {
            graphLoopStarted = false;
            return;
          }
        }
      } else {
        graphLoopStarted = false;
        return;
      }
      requestAnimationFrame(tick);
    }

    function wakeGraph() {
      if (nodes3d.length === 0) { needsRedraw = true; return; }
      simAlpha = Math.max(simAlpha, 0.6);
      graphEnergy = Infinity;
      needsRedraw = true;
      if (!graphLoopStarted) {
        graphLoopStarted = true;
        requestAnimationFrame(tick);
      }
    }

    function buildClusterFilters() {
      const container = document.getElementById('clusterFilters');
      container.querySelectorAll('.cluster-check').forEach(el => el.remove());
      const projects = [...new Set(allMemories.map(m => m.project || 'none'))];
      const types = [...new Set(allMemories.map(m => m.type || 'discovery'))];
      const makeCheck = (group, value) => {
        const label = document.createElement('label');
        label.className = 'cluster-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !hiddenClusters.has(group + ':' + value);
        box.onchange = () => {
          if (box.checked) hiddenClusters.delete(group + ':' + value);
          else hiddenClusters.add(group + ':' + value);
          wakeGraph();
        };
        label.appendChild(box);
        label.appendChild(document.createTextNode(value));
        container.appendChild(label);
      };
      projects.forEach(p => makeCheck('project', p));
      types.forEach(t => makeCheck('type', t));
    }

    function setupTimeline() {
      const slider = document.getElementById('timelineSlider');
      const label = document.getElementById('timelineLabel');
      const times = allMemories.map(m => Date.parse(m.updated_at || '')).filter(t => !Number.isNaN(t));
      if (times.length === 0) { slider.disabled = true; label.textContent = 'n/a'; return; }
      slider.disabled = false;
      const min = times.reduce((a, b) => (b < a ? b : a), Infinity), max = times.reduce((a, b) => (b > a ? b : a), -Infinity);
      slider.oninput = () => {
        const t = parseInt(slider.value, 10) / 1000;
        if (t >= 1) { timelineCutoff = null; label.textContent = 'all'; }
        else {
          const cutoffMs = min + (max - min) * t;
          timelineCutoff = new Date(cutoffMs).toISOString();
          label.textContent = new Date(cutoffMs).toLocaleDateString();
        }
        wakeGraph();
      };
    }

    function setupCanvasInteractions() {
      const canvas = document.getElementById('graphCanvas');
      canvas.addEventListener('pointerdown', (e) => {
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
        wakeGraph();
      });
      canvas.addEventListener('pointerup', (e) => {
        if (canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId);
        wakeGraph();
      });
      canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        wakeGraph();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        rotY += dx * 0.005;
        rotX = Math.max(-1.4, Math.min(1.4, rotX + dy * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        wakeGraph();
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
        wakeGraph();
      });
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.max(0.3, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
        wakeGraph();
      }, { passive: false });
      canvas.addEventListener('click', (e) => {
        if (dragMoved) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null, bestDist = Infinity;
        for (let i = 0; i < nodes3d.length; i++) {
          const n = nodes3d[i];
          if (!nodeVisible(n)) continue;
          const p = project(n.x, n.y, n.z, canvas.width, canvas.height);
          const d = Math.hypot(p.sx - mx, p.sy - my);
          const hitR = (6 + Math.min(10, n.degree * 2)) * p.scale + 6;
          if (d < hitR && d < bestDist) { best = n; bestDist = d; }
        }
        if (best) {
          const mem = allMemories.find(m => m.id === best.id);
          if (mem) selectMemory(mem);
        }
      });
    }

    let terrainFiles = [];
    let terrainSelected = null;

    let hubAgents = [];
    let agentManifest = null;

    async function fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        hubAgents = data.agents || [];
        renderAgents(data.counts || {});
      } catch (err) {
        console.error('Failed to load agents:', err);
      }
    }

    function renderAgents(counts) {
      const grid = document.getElementById('agentsGrid');
      const badge = document.getElementById('agentsCounts');
      if (!grid) return;
      if (badge) badge.textContent = (counts.wired || 0) + ' wired · ' + (counts.unwired || 0) + ' unwired';
      grid.innerHTML = '';
      hubAgents.forEach(function (agent) {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.dataset.agent = agent.id;
        const cls = agent.status === 'WIRED' ? 'wired' : agent.status === 'UNWIRED' ? 'unwired' : 'absent';
        const detail = agent.configPath
          ? '<div class="agent-meta mono">' + escapeHtml(agent.configPath) + '</div>'
          : agent.binaryPath ? '<div class="agent-meta mono">' + escapeHtml(agent.binaryPath) + '</div>' : '';
        var actions = '';
        if (agent.status === 'UNWIRED') actions = '<div class="agent-actions"><button type="button" class="btn btn-green" data-wire="' + escapeHtml(agent.id) + '">Wire</button></div>';
        else if (agent.status === 'WIRED') actions = '<div class="agent-actions"><button type="button" class="btn btn-red" data-unwire="' + escapeHtml(agent.id) + '">Unwire</button></div>';
        card.innerHTML = '<div class="agent-card-head"><strong>' + escapeHtml(agent.name) + '</strong>' +
          '<span class="agent-status ' + cls + '">' + escapeHtml(agent.status) + '</span></div>' +
          '<div class="agent-meta">' + escapeHtml(agent.description) + '</div>' + detail + actions;
        card.querySelectorAll('[data-wire]').forEach(function (btn) {
          btn.addEventListener('click', function () { wireAgent(btn.dataset.wire); });
        });
        card.querySelectorAll('[data-unwire]').forEach(function (btn) {
          btn.addEventListener('click', function () { unwireAgent(btn.dataset.unwire); });
        });
        grid.appendChild(card);
      });
    }

    async function fetchAgentManifest() {
      try {
        const res = await fetch('/api/agents/manifest');
        agentManifest = await res.json();
        const paths = document.getElementById('agentManifestPaths');
        const snippet = document.getElementById('agentManifestSnippet');
        if (paths) paths.textContent = 'Memory: ' + agentManifest.memoryDir + '  ·  DB: ' + agentManifest.database;
        if (snippet) snippet.textContent = agentManifest.snippet;
      } catch (err) {
        console.error('Failed to load agent manifest:', err);
      }
    }

    function copyAgentSnippet() {
      if (!agentManifest) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(agentManifest.snippet).then(
          function () { flash('Manifest snippet copied.'); },
          function () { flash('Copy failed.', true); }
        );
      } else {
        flash('Clipboard unavailable in this browser.', true);
      }
    }

    async function wireAgent(id) {
      if (!confirm('Wire ' + id + '? This may update its config; a timestamped .bak backup is created first.')) return;
      try {
        const res = await fetch('/api/agents/wire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, harness: id })
        });
        const data = await res.json();
        if (!res.ok || data.success !== true) {
          const message = data.error || (data.reports && data.reports[0] ? data.reports[0].message : res.status);
          flash('Wire failed: ' + message, true);
          return;
        }
        flash('Wired ' + id + '. Backup: ' + ((data.backups && data.backups[0]) || 'none'));
        fetchAgents();
      } catch (err) { flash('Wire failed: ' + String(err), true); }
    }

    async function unwireAgent(id) {
      try {
        const res = await fetch('/api/agents/unwire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, harness: id })
        });
        const data = await res.json();
        if (!res.ok || data.success !== true) {
          const message = data.error || (data.report && data.report.message) || res.status;
          flash('Unwire failed: ' + message, true);
          return;
        }
        flash('Unwired ' + id + '.');
        fetchAgents();
      } catch (err) { flash('Unwire failed: ' + String(err), true); }
    }

    async function fetchTerrain() {
      try {
        const res = await fetch('/api/terrain');
        const data = await res.json();
        terrainFiles = data.files || [];
        renderTerrainTree();
      } catch (err) {
        console.error('Failed to load terrain:', err);
      }
    }

    function renderTerrainTree() {
      const tree = document.getElementById('terrainTree');
      if (!tree) return;
      tree.innerHTML = '';
      terrainFiles.forEach(function (file) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'terrain-tree-item' + (terrainSelected === file.name ? ' active' : '');
        btn.dataset.terrain = file.name;
        btn.innerHTML = '<span>' + escapeHtml(file.name) + '</span><span class="gen-badge' + (file.generated ? '' : ' missing') + '">' + (file.generated ? 'GEN' : 'MISSING') + '</span>';
        btn.onclick = function () { selectTerrainFile(file.name); };
        tree.appendChild(btn);
      });
      if (!terrainSelected && terrainFiles.length > 0) selectTerrainFile(terrainFiles[0].name);
      else if (terrainSelected) selectTerrainFile(terrainSelected);
    }

    function terrainInline(text) {
      return text.replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    }

    function renderTerrainMarkdown(markdown) {
      const lines = escapeHtml(markdown).split('\\n');
      let html = '', inList = false;
      const closeList = function () { if (inList) { html += '</ul>'; inList = false; } };
      lines.forEach(function (line) {
        if (/^### /.test(line)) { closeList(); html += '<h4>' + terrainInline(line.slice(4)) + '</h4>'; }
        else if (/^## /.test(line)) { closeList(); html += '<h3>' + terrainInline(line.slice(3)) + '</h3>'; }
        else if (/^# /.test(line)) { closeList(); html += '<h2>' + terrainInline(line.slice(2)) + '</h2>'; }
        else if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + terrainInline(line.slice(2)) + '</li>'; }
        else if (/^\\|/.test(line)) { closeList(); html += '<div class="terrain-row">' + terrainInline(line) + '</div>'; }
        else if (line.trim() === '') { closeList(); }
        else { closeList(); html += '<p>' + terrainInline(line) + '</p>'; }
      });
      closeList();
      return html || '<p class="activity-empty">Map is empty.</p>';
    }

    function selectTerrainFile(name) {
      terrainSelected = name;
      const file = terrainFiles.find(function (item) { return item.name === name; });
      const label = document.getElementById('terrainFileName');
      const content = document.getElementById('terrainContent');
      if (label) label.textContent = name;
      if (content) {
        content.innerHTML = file && file.generated
          ? renderTerrainMarkdown(file.content)
          : '<p class="activity-empty">This map has not been compiled yet. Press REINDEX.</p>';
      }
      document.querySelectorAll('.terrain-tree-item').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.terrain === name);
      });
    }

    async function reindexTerrain() {
      const button = document.getElementById('terrainReindex');
      if (button) button.disabled = true;
      try {
        await fetch('/api/terrain/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        await fetchTerrain();
        const scan = document.getElementById('terrainScanline');
        if (scan) {
          scan.classList.remove('active');
          void scan.offsetWidth;
          scan.classList.add('active');
          setTimeout(function () { scan.classList.remove('active'); }, 900);
        }
        flash('Terrain maps recompiled.');
      } catch (err) {
        flash('Terrain reindex failed: ' + String(err), true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function fetchActivity() {
      const requestGen = scopeGeneration;
      try {
        const res = await fetch(apiUrl('/api/activity'));
        const data = await res.json();
        if (requestGen !== scopeGeneration) return;
        renderActivity(data);
      } catch (err) {
        console.error('Failed to load activity:', err);
      }
    }

    function renderActivity(data) {
      const grid = document.getElementById('activityHeatmap');
      const sessions = document.getElementById('activitySessions');
      const badge = document.getElementById('activityMutations');
      if (!grid || !sessions) return;

      const days = data.days || [];
      grid.innerHTML = '';
      const cells = document.createDocumentFragment();
      days.forEach(function (day) {
        const cell = document.createElement('div');
        const level = day.count === 0 ? 0 : day.count < 3 ? 1 : day.count < 6 ? 2 : day.count < 10 ? 3 : 4;
        cell.className = 'hm-cell level-' + level;
        cell.title = day.date + ': ' + day.count + ' mutations';
        cells.appendChild(cell);
      });
      grid.appendChild(cells);
      if (badge) badge.textContent = (data.total_mutations || 0) + ' mutations';

      sessions.innerHTML = '';
      const list = data.sessions || [];
      if (list.length === 0) {
        sessions.innerHTML = '<div class="activity-empty">No agent sessions recorded yet. Sessions appear when an agent starts one.</div>';
        return;
      }
      list.forEach(function (session) {
        const card = document.createElement('div');
        card.className = 'session-card';
        const tags = (session.tags || []).map(function (tag) {
          return '<span class="card-tag">#' + escapeHtml(tag) + '</span>';
        }).join('');
        const started = String(session.started_at || '').slice(0, 16).replace('T', ' ');
        const ended = session.ended_at ? ' · ended ' + escapeHtml(String(session.ended_at).slice(0, 16).replace('T', ' ')) : '';
        card.innerHTML = '<div class="session-card-head"><strong>' + escapeHtml(session.title) + '</strong>' +
          '<span class="session-status ' + (session.status === 'active' ? 'active' : 'done') + '">' + escapeHtml(session.status) + '</span></div>' +
          '<div class="session-meta mono">' + escapeHtml(session.session_id) + '</div>' +
          '<div class="session-meta">Started ' + escapeHtml(started) + ended + '</div>' +
          '<div class="session-card-foot"><span>' + (session.messages || 0) + ' messages</span><div class="card-tags">' + tags + '</div></div>';
        sessions.appendChild(card);
      });
    }

    function exportDataHtml() {
      window.open('/api/export-html', '_blank');
    }

    // R15 Studio Loaders
    async function fetchHealth() {
      try {
        const res = await fetch('/api/health' + projectScopeQuery());
        const data = await res.json();
        renderHealth(data);
      } catch (err) {
        console.error('Failed to load health report:', err);
      }
    }

    // T-321: mirrors the CLI scope wording — "N memories across M project(s)".
    function formatHealthScope(scope) {
      if (!scope) return 'Scope: --';
      const count = scope.entry_count || 0;
      const projectCount = (scope.projects || []).length;
      const memories = count === 1 ? 'memory' : 'memories';
      const projects = projectCount === 1 ? 'project' : 'projects';
      const label = scope.filter ? 'project "' + scope.filter + '"' : 'entire store';
      return 'Scope: ' + label + ' (' + count + ' ' + memories + ' across ' + projectCount + ' ' + projects + '); code-side metrics cover the ' + (scope.code_scope || 'workspace') + '.';
    }

    function renderHealth(data) {
      if (!data) return;
      const gradeEl = document.getElementById('healthGrade');
      const scoreEl = document.getElementById('healthScore');
      const gateEl = document.getElementById('healthGate');
      const summaryEl = document.getElementById('healthSummary');
      const scopeEl = document.getElementById('healthScope');
      const scopeProjectEl = document.getElementById('healthScopeProject');
      const grade = data.overall_grade || data.grade || '--';
      const score = data.overall_score !== undefined ? data.overall_score : (data.score || 0);
      if (gradeEl) {
        gradeEl.textContent = grade;
        gradeEl.className = 'grade-circle grade-' + grade.charAt(0).toLowerCase();
      }
      if (scoreEl) scoreEl.textContent = Math.round(score) + '/100';
      if (gateEl) {
        gateEl.textContent = '[' + (data.gate_status || 'WARN') + ']';
        gateEl.className = 'gate-badge gate-' + (data.gate_status || 'WARN').toLowerCase();
      }
      if (summaryEl) summaryEl.textContent = data.summary || '';
      if (scopeEl) scopeEl.textContent = formatHealthScope(data.scope);
      if (scopeProjectEl) scopeProjectEl.textContent = 'Project: ' + (data.project || '--');

      if (data.pillars) {
        const p1 = data.pillars.store_integrity || data.pillars.memory_integrity;
        if (p1) {
          document.getElementById('pStoreScore').textContent = Math.round(p1.score || 0) + '%';
          document.getElementById('pStoreBar').style.width = Math.round(p1.score || 0) + '%';
          document.getElementById('pStoreContradictions').textContent = p1.metrics?.contradictions ?? p1.contradictions_flagged ?? 0;
          document.getElementById('pStoreExpired').textContent = p1.metrics?.expired_count ?? p1.expired_memories ?? 0;
        }

        const p2 = data.pillars.code_anchors || data.pillars.native_code_anchors;
        if (p2) {
          document.getElementById('pAnchorsScore').textContent = Math.round(p2.score || p2.validity_score || 0) + '%';
          document.getElementById('pAnchorsBar').style.width = Math.round(p2.score || p2.validity_score || 0) + '%';
          document.getElementById('pAnchorsValid').textContent = p2.metrics?.valid_anchors ?? p2.valid ?? 0;
          document.getElementById('pAnchorsDrifted').textContent = p2.metrics?.drifted_anchors ?? p2.drifted ?? 0;
        }

        const p3 = data.pillars.doc_code_alignment || data.pillars.documentation_drift;
        if (p3) {
          document.getElementById('pDocScore').textContent = Math.round(p3.score || p3.alignment_score || 0) + '%';
          document.getElementById('pDocBar').style.width = Math.round(p3.score || p3.alignment_score || 0) + '%';
          document.getElementById('pDocDoc').textContent = p3.metrics?.documented_count ?? p3.documented ?? 0;
          document.getElementById('pDocMissing').textContent = p3.metrics?.missing_count ?? p3.missing ?? 0;
        }

        const p4 = data.pillars.negative_anti_patterns || data.pillars.negative_lessons_sentry;
        if (p4) {
          document.getElementById('pLessonsScore').textContent = Math.round(p4.score || p4.defense_score || 0) + '%';
          document.getElementById('pLessonsBar').style.width = Math.round(p4.score || p4.defense_score || 0) + '%';
          document.getElementById('pLessonsTotal').textContent = p4.metrics?.total_negative_lessons ?? p4.total_lessons ?? 0;
          document.getElementById('pLessonsActive').textContent = p4.metrics?.active_traps ?? p4.active_traps ?? 0;
        }

        const p5 = data.pillars.technical_debt || data.pillars.technical_debt_friction;
        if (p5) {
          document.getElementById('pDebtScore').textContent = Math.round(p5.score || p5.fragility_score || 0) + '%';
          document.getElementById('pDebtBar').style.width = Math.round(p5.score || p5.fragility_score || 0) + '%';
          document.getElementById('pDebtTodos').textContent = p5.metrics?.todo_count ?? p5.todo_count ?? 0;
          document.getElementById('pDebtFragile').textContent = p5.metrics?.fragile_subsystems ?? p5.fragile_subsystems ?? 0;
        }
      }

      const tbody = document.getElementById('healthChecklistBody');
      if (tbody) {
        tbody.innerHTML = '';
        const list = data.actionable_checklist || data.checklist || [];
        list.forEach(item => {
          const tr = document.createElement('tr');
          if (typeof item === 'string') {
            tr.innerHTML = \`
              <td><span class="priority-badge priority-high">[RECOMMENDED]</span></td>
              <td colspan="2"><strong>\${escapeHtml(item)}</strong></td>
            \`;
          } else {
            const rawPriority = String(item.priority || 'medium');
            const safePriority = escapeHtml(rawPriority);
            const pillClass = 'priority-' + rawPriority.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            tr.innerHTML = \`
              <td><span class="priority-badge \${pillClass}">[\${safePriority}]</span></td>
              <td><strong>\${escapeHtml(item.issue)}</strong></td>
              <td>\${escapeHtml(item.action)}</td>
            \`;
          }
          tbody.appendChild(tr);
        });
      }
    }

    async function fetchAdrs() {
      try {
        const res = await fetch('/api/adrs');
        const list = await res.json();
        const container = document.getElementById('adrsListGrid');
        if (container) {
          container.innerHTML = '';
          if (!list || list.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No ADRs recorded yet. Capture with memory_adr_record.</div>';
          } else {
            list.forEach(adr => {
              const card = document.createElement('div');
              card.className = 'view-card';
              card.innerHTML = \`
                <div class="card-header">
                  <div class="card-title">\${escapeHtml(adr.title)}</div>
                  <span class="adr-badge adr-\${(adr.status || 'proposed').toLowerCase()}">\${adr.status}</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;"><strong>Context:</strong> \${escapeHtml(adr.context || '')}</div>
                <div style="font-size:12px; color:#f1f5f9; margin-bottom:6px;"><strong>Decision:</strong> \${escapeHtml(adr.decision || '')}</div>
                <div style="font-size:11px; color:var(--text-dim);"><strong>Consequences:</strong> \${escapeHtml(adr.consequences || '')}</div>
              \`;
              container.appendChild(card);
            });
          }
        }
      } catch (err) {
        console.error('Failed to load ADRs:', err);
      }
    }

    async function fetchDrift() {
      try {
        const res = await fetch('/api/drift' + projectScopeQuery());
        const drift = await res.json();
        const tbody = document.getElementById('driftTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          const list = drift.items || drift.classified || [];
          list.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td class="mono"><strong>\${escapeHtml(item.symbol)}</strong></td>
              <td><span class="drift-badge drift-\${(item.status || 'documented').toLowerCase()}">\${item.status}</span></td>
              <td style="font-size:11px; color:var(--text-dim);">\${escapeHtml(item.docRef || item.codeRef || item.path || '')}</td>
              <td style="font-size:12px;">\${escapeHtml(item.explanation || '')}</td>
            \`;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load drift audit:', err);
      }
    }

    async function explainWhyCode() {
      const q = (document.getElementById('whyInput').value || '').trim();
      if (!q) return;
      try {
        const res = await fetch('/api/cognition/why', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol_or_path: q })
        });
        const data = await res.json();
        const out = document.getElementById('whyOutput');
        if (out) {
          out.style.display = 'block';
          out.innerHTML = \`
            <div class="card-title-lg" style="margin-bottom:8px;">🏛️ Architectural Rationale for <code>\${escapeHtml(q)}</code></div>
            <p style="font-size:13px; line-height:1.6; color:#f1f5f9; margin-bottom:12px;">\${escapeHtml(data.core_rationale || data.inferred_rationale || 'No specific rationale recorded.')}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12px;">
              <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid var(--panel-border);">
                <div style="font-weight:700; color:var(--green); margin-bottom:4px;">Historical Bug Fixes & Lessons</div>
                <div>\${(data.timeline || data.preceding_failures || []).length > 0 ? (data.timeline || data.preceding_failures).map(f => '• ' + escapeHtml(f.title || f.summary || '')).join('<br>') : 'None recorded'}</div>
              </div>
              <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid var(--panel-border);">
                <div style="font-weight:700; color:#fbbf24; margin-bottom:4px;">Trade-offs & Constraints</div>
                <div>\${(data.trade_offs_accepted || data.trade_offs_recorded || []).length > 0 ? (data.trade_offs_accepted || data.trade_offs_recorded).map(t => '• ' + escapeHtml(t.title || t.trade_off || '')).join('<br>') : 'None recorded'}</div>
              </div>
            </div>
          \`;
        }
      } catch (err) {
        flash('Why Reasoner query failed', true);
      }
    }

    async function fetchCognition() {
      try {
        const [clustRes, debtRes] = await Promise.all([
          fetch('/api/cognition/clusters' + projectScopeQuery()),
          fetch('/api/cognition/debt' + projectScopeQuery())
        ]);
        const clustersData = await clustRes.json();
        const debtData = await debtRes.json();

        const grid = document.getElementById('clustersGrid');
        if (grid) {
          grid.innerHTML = '';
          (clustersData.clusters || []).forEach(c => {
            const el = document.createElement('div');
            el.className = 'cluster-card';
            el.innerHTML = \`
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span class="mono" style="font-weight:700; color:#f1f5f9;">\${escapeHtml(c.subsystem)}</span>
                <span class="badge-cause badge-\${c.root_cause}">\${c.root_cause}</span>
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">\${escapeHtml(c.pattern_summary)}</div>
              <div style="font-size:11px; color:var(--text-dim);">Frequency: <strong>\${c.frequency}</strong> &bull; Fragility: <strong>\${(c.fragility_score * 100).toFixed(0)}%</strong></div>
            \`;
            grid.appendChild(el);
          });
        }

        const debtBody = document.getElementById('debtTableBody');
        if (debtBody) {
          debtBody.innerHTML = '';
          const list = debtData.hotspot_files || debtData.hotspots || debtData.items || [];
          list.slice(0, 10).forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td class="mono">\${escapeHtml(h.file || h.filePath || '')}</td>
              <td>\${h.todo_count ?? 0}</td>
              <td>\${h.fixme_count ?? 0}</td>
              <td><span class="badge-cause badge-\${h.risk_level || h.severity || 'low'}">\${h.risk_level || h.severity || 'low'}</span></td>
            \`;
            debtBody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load cognition data:', err);
      }
    }

    async function fetchSyncStatus() {
      try {
        const res = await fetch('/api/sync/status');
        const data = await res.json();
        document.getElementById('syncLocalAgent').textContent = data.local_agent_id || '--';
        document.getElementById('syncTotalPeers').textContent = data.total_peers || 0;
        document.getElementById('syncPendingMemories').textContent = data.pending_outgoing_memories || 0;
        document.getElementById('syncLastAt').textContent = data.last_sync_at ? new Date(data.last_sync_at).toLocaleTimeString() : 'Never';

        const tbody = document.getElementById('syncPeersTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          (data.known_peers || []).forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td class="mono"><strong>\${escapeHtml(p.agent_id)}</strong></td>
              <td>\${p.last_seen_at ? new Date(p.last_seen_at).toLocaleTimeString() : '--'}</td>
              <td>\${p.total_packets_received || 0}</td>
              <td>\${p.total_memories_ingested || 0}</td>
            \`;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to load sync status:', err);
      }
    }

    async function broadcastSyncPacket() {
      if (!requireProjectScope()) return;
      try {
        const res = await fetch('/api/sync/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const packet = await res.json();
        flash('✓ Broadcasted packet ' + packet.packet_id + ' (' + packet.payload.memories.length + ' memories)');
        fetchSyncStatus();
      } catch (err) {
        flash('Broadcast failed', true);
      }
    }

    async function syncPool() {
      if (!requireProjectScope()) return;
      try {
        const res = await fetch('/api/sync/pool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const report = await res.json();
        flash('✓ Synced with shared pool: ingested ' + report.total_ingested + ' new memories from ' + report.peers_contacted.length + ' peers');
        fetchSyncStatus();
      } catch (err) {
        flash('Pool sync failed', true);
      }
    }

    // R16 Mesh Loaders
    async function fetchMeshStatus() {
      try {
        const res = await fetch('/api/mesh/status');
        const data = await res.json();
        document.getElementById('meshRoot').textContent = data.rootPath || '--';
        document.getElementById('meshType').textContent = (data.workspaceType || 'none').toUpperCase();
        document.getElementById('meshIsMono').textContent = data.isMonorepo ? 'YES (Active)' : 'NO';
        document.getElementById('meshNodeCount').textContent = (data.nodes || []).length;

        const grid = document.getElementById('meshNodesGrid');
        if (grid) {
          grid.innerHTML = '';
          (data.nodes || []).forEach(node => {
            const el = document.createElement('div');
            el.className = 'cluster-card';
            const storeStatus = node.hasStore ? '<span class="drift-badge drift-documented">Store: Active</span>' : '<span class="drift-badge drift-stale">Store: None</span>';
            const currentBadge = node.isCurrent ? ' <span class="priority-badge priority-high">CURRENT</span>' : '';
            el.innerHTML = \`
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="mono" style="font-weight:800; color:#fff;">\${escapeHtml(node.name)}\${currentBadge}</span>
                \${storeStatus}
              </div>
              <div style="font-size:11px; color:var(--text-dim); margin-bottom:6px; word-break:break-all;">\${escapeHtml(node.path)}</div>
              <div style="font-size:11px; color:var(--text-muted);">Type: <strong>\${node.nodeType}</strong></div>
              \${node.dependencies && node.dependencies.length > 0 ? \`<div style="font-size:11px; color:var(--text-dim); margin-top:4px;">Deps: \${node.dependencies.slice(0, 3).map(escapeHtml).join(', ')}\${node.dependencies.length > 3 ? '...' : ''}</div>\` : ''}
            \`;
            grid.appendChild(el);
          });
        }
      } catch (err) {
        console.error('Failed to load mesh status:', err);
      }
    }

    async function searchMesh() {
      const q = (document.getElementById('meshQueryInput').value || '').trim();
      try {
        const res = await fetch('/api/mesh/query?q=' + encodeURIComponent(q));
        const list = await res.json();
        const container = document.getElementById('meshQueryResults');
        if (container) {
          container.innerHTML = '';
          if (!list || list.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No memories found across mesh workspace.</div>';
          } else {
            list.forEach(res => {
              const card = document.createElement('div');
              card.className = 'view-card';
              card.style.marginBottom = '0';
              card.innerHTML = \`
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div style="font-weight:700; color:#fff;">\${escapeHtml(res.memory.title)}</div>
                  <div>
                    <span class="priority-badge priority-medium">[\${escapeHtml(res.originProject)}]</span>
                    <span class="adr-badge adr-proposed">\${res.memory.type}</span>
                  </div>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">\${escapeHtml(res.memory.content)}</div>
                <div style="font-size:11px; color:var(--text-dim);">Source: \${escapeHtml(res.sourceNode.path)} &bull; Score: \${(res.score * 100).toFixed(0)}%</div>
              \`;
              container.appendChild(card);
            });
          }
        }
      } catch (err) {
        flash('Mesh search failed', true);
      }
    }

    async function fetchMeshAudit() {
      try {
        const res = await fetch('/api/mesh/audit');
        const data = await res.json();
        const sumEl = document.getElementById('meshAuditSummary');
        if (sumEl) sumEl.textContent = data.summary || '';

        const tbody = document.getElementById('meshAuditTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          (data.items || []).forEach(item => {
            const tr = document.createElement('tr');
            const color = item.status === 'valid' ? 'drift-documented' : item.status === 'drifted' ? 'drift-partial' : 'drift-conflicting';
            tr.innerHTML = \`
              <td class="mono"><strong>\${escapeHtml(item.sourcePackage)}</strong></td>
              <td class="mono"><strong>\${escapeHtml(item.targetPackage)}</strong></td>
              <td class="mono">\${escapeHtml(item.symbol)}</td>
              <td><span class="drift-badge \${color}">\${item.status}</span></td>
              <td style="font-size:12px;">\${escapeHtml(item.detail)}</td>
            \`;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('Failed to run mesh audit:', err);
      }
    }

    // Tabs switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        tab.setAttribute('aria-current', 'page');
        currentTab = tab.dataset.view;
        const panel = document.getElementById('panel-' + currentTab);
        if (panel) panel.classList.add('active');
        if (currentTab === 'graph') wakeGraph();
        if (currentTab === 'health') fetchHealth();
        if (currentTab === 'adrs') { fetchAdrs(); fetchDrift(); }
        if (currentTab === 'cognition') fetchCognition();
        if (currentTab === 'sync') fetchSyncStatus();
        if (currentTab === 'mesh') { fetchMeshStatus(); fetchMeshAudit(); }
        if (currentTab === 'activity') fetchActivity();
        if (currentTab === 'terrain') fetchTerrain();
        if (currentTab === 'agents') { fetchAgents(); fetchAgentManifest(); }
      });
    });

    // Archetype selection
    document.querySelectorAll('.archetype-card').forEach(card => {
      card.addEventListener('click', async () => {
        if (!requireProjectScope()) return;
        const arch = card.dataset.arch;
        if (!arch) return;
        document.querySelectorAll('.archetype-card[data-arch]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        await fetch('/api/user-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archetype: arch })
        });
        fetchUserProfile();
        flash('Switched persona archetype to ' + arch);
      });
    });

    renderQuickStart();
    renderCommandDeck('');
    var commandSearch = document.getElementById('commandDeckSearch');
    if (commandSearch) {
      commandSearch.addEventListener('input', function (event) { renderCommandDeck(event.target.value); });
    }
    setupCanvasInteractions();
    setupTimeline();

    // T-321: project scope control. Seeded from the URL so a scoped link is
    // reloadable; an empty value means the whole store.
    const projectFilterInput = document.getElementById('projectFilter');
    if (projectFilterInput) {
      projectFilterInput.value = projectScope;
      projectFilterInput.addEventListener('change', () => {
        applyProjectScope(projectFilterInput.value);
      });
    }

    document.addEventListener('visibilitychange', function () {
      documentHidden = document.hidden;
      if (documentHidden) {
        graphLoopStarted = false;
      } else {
        wakeGraph();
      }
    });

    document.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setStudioView(btn.dataset.studioView); });
    });

    var listSearch = document.getElementById('studioListSearch');
    if (listSearch) {
      listSearch.addEventListener('input', function (e) {
        var value = e.target.value;
        if (listDebounce) clearTimeout(listDebounce);
        listDebounce = setTimeout(function () { listQuery = value; renderStudioTable(); }, 100);
      });
    }

    document.querySelectorAll('.studio-table th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (listSort.key === key) listSort.dir = listSort.dir === 'asc' ? 'desc' : 'asc';
        else { listSort.key = key; listSort.dir = 'asc'; }
        renderStudioTable();
      });
    });

    let searchDebounceTimer = null;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        renderList();
        wakeGraph();
      }, 30);
    });

    document.querySelectorAll('#filterBar .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filterBar .chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
        currentFilter = chip.dataset.type;
        renderList();
        wakeGraph();
      });
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' || e.key === '/') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.getElementById('searchInput').focus();
        }
      }
      if (e.key === 'Escape') {
        document.getElementById('detailPane').classList.remove('open');
      }
    });

    document.querySelectorAll('.scope-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setScope(btn.dataset.scope); });
    });
    var scopeSwitch = document.getElementById('scopeSwitch');
    if (window.STANDALONE_DATA && scopeSwitch) scopeSwitch.style.display = 'none';
    var initialScope = new URLSearchParams(window.location.search).get('scope');
    setScope(initialScope || 'project', { refetch: false });

    loadData();`;

export const STUDIO_BODY = `  <nav class="rail" aria-label="Studio sections">
    <div class="rail-brand" aria-hidden="true">M</div>
    <button type="button" class="rail-section nav-tab active" data-view="graph" aria-current="page"><span class="rail-num">01</span><span class="rail-name">Overview</span></button>
    <button type="button" class="rail-section nav-tab" data-view="health"><span class="rail-num">02</span><span class="rail-name">Health</span></button>
    <button type="button" class="rail-section nav-tab" data-view="wiki"><span class="rail-num">03</span><span class="rail-name">Knowledge</span></button>
    <button type="button" class="rail-section nav-tab" data-view="cognition"><span class="rail-num">04</span><span class="rail-name">Cognition</span></button>
    <button type="button" class="rail-section nav-tab" data-view="current"><span class="rail-num">05</span><span class="rail-name">Governance</span></button>
    <button type="button" class="rail-section nav-tab" data-view="about"><span class="rail-num">06</span><span class="rail-name">About</span></button>
    <div class="rail-tools" role="group" aria-label="Tools">
      <button type="button" class="rail-tool nav-tab" data-view="adrs">ADRs</button>
      <button type="button" class="rail-tool nav-tab" data-view="sync">P2P</button>
      <button type="button" class="rail-tool nav-tab" data-view="mesh">Mesh</button>
      <button type="button" class="rail-tool nav-tab" data-view="persona">Persona</button>
      <button type="button" class="rail-tool nav-tab" data-view="sandbox">Sandbox</button>
      <button type="button" class="rail-tool nav-tab" data-view="audit">Audit</button>
      <button type="button" class="rail-tool nav-tab" data-view="activity">Activity</button>
      <button type="button" class="rail-tool nav-tab" data-view="terrain">Terrain</button>
      <button type="button" class="rail-tool nav-tab" data-view="agents">Agents</button>
    </div>
  </nav>

  <header>
    <div class="brand-wrap">
      <div class="brand-title">
        Muse Memory
        <span class="brand-tag">Visual Inspector & Studio</span>
      </div>
    </div>

    <div class="scope-switch" id="scopeSwitch" role="group" aria-label="Memory scope">
      <button type="button" class="scope-btn active" data-scope="project" aria-pressed="true" title="Local project scope: ./.memory">Local Project</button>
      <button type="button" class="scope-btn" data-scope="global" aria-pressed="false" title="Global user scope: ~/.memory">Global User</button>
      <button type="button" class="scope-btn" data-scope="mesh" aria-pressed="false" title="Cross-project mesh">Mesh</button>
    </div>
    <span class="scope-badge" id="scopeBadge">./.memory</span>

    <div class="header-actions">
      <div class="scope-filter">
        <label class="scope-filter-label" for="projectFilter">Project Filter</label>
        <input type="text" id="projectFilter" class="scope-filter-input" placeholder="all projects" autocomplete="off" spellcheck="false" title="Leave empty to audit the whole memory store, or enter a project name to scope the health gate, drift, bug cluster and technical debt audits." />
      </div>
      <button class="btn-icon btn-refresh" id="refreshBtn" onclick="refreshMemories()" title="Refresh and sync active constraints, handoff state, and prior memories">
        <span class="refresh-icon" id="refreshIcon" aria-hidden="true"></span>
        <span id="refreshLabel">Refresh</span>
      </button>
      <button class="btn-icon btn-optimize write-action" id="optimizeBtn" onclick="optimizeStoreDashboard()" title="Clean test noise, prune junk, deduplicate candidates, and defragment SQLite storage">
        <span class="optimize-icon" id="optimizeIcon" aria-hidden="true"></span>
        <span id="optimizeLabel">Optimize</span>
      </button>
      <div class="status-badge"><div class="status-dot"></div>[LIVE] Active</div>
      <button class="btn-icon" onclick="exportDataHtml()">Export HTML</button>
    </div>
  </header>
  <div class="scope-banner" id="scopeBanner" hidden></div>
  
  <div class="layout">
    <!-- Sidebar List -->
    <div class="sidebar">
      <div class="search-box">
        <div class="search-input-wrap">
          <span class="search-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg></span>
          <input type="text" id="searchInput" placeholder="Search memories (Cmd+K / '/')..." />
        </div>
      </div>
      <div class="filters" id="filterBar">
        <button type="button" class="chip active" data-type="all" aria-pressed="true">All</button>
        <button type="button" class="chip" data-type="fix" aria-pressed="false">Fixes</button>
        <button type="button" class="chip" data-type="decision" aria-pressed="false">Decisions</button>
        <button type="button" class="chip" data-type="constraint" aria-pressed="false">Constraints</button>
        <button type="button" class="chip" data-type="failure" aria-pressed="false">Failures</button>
        <button type="button" class="chip" data-type="architecture" aria-pressed="false">Architecture</button>
        <button type="button" class="chip" data-type="operation" aria-pressed="false">Operations</button>
      </div>
      <div class="stats-strip" id="statsStrip">
        <div class="stat-item"><div class="stat-val" id="statTotal">0</div><div class="stat-lbl">Memories</div></div>
        <div class="stat-item"><div class="stat-val" id="statConfirmed">0%</div><div class="stat-lbl">Confirmed</div></div>
        <div class="stat-item"><div class="stat-val" id="statConstraints">0</div><div class="stat-lbl">Constraints</div></div>
        <div class="stat-item"><div class="stat-val" id="statLinks">0</div><div class="stat-lbl">Links</div></div>
      </div>
      <div class="list" id="memoryList"></div>
    </div>
    
    <!-- View 1: 3D Force Graph -->
    <div class="view-panel active" id="panel-graph">
      <div class="graph-controls" id="graphControls">
        <div class="control-row">
          <div class="studio-view-switch" id="studioViewSwitch" role="group" aria-label="Studio view">
            <button type="button" class="view-btn active" data-studio-view="graph" aria-pressed="true">Graph</button>
            <button type="button" class="view-btn" data-studio-view="list" aria-pressed="false">List</button>
          </div>
          <span class="control-label" id="studioViewLabel">Canvas graph</span>
        </div>
        <div id="graphOnlyControls" style="display:flex; flex-direction:column; gap:8px;">
          <div class="control-row">
            <span class="control-label">Timeline</span>
            <input type="range" id="timelineSlider" min="0" max="1000" value="1000" />
            <span class="control-label" id="timelineLabel">all</span>
          </div>
          <div class="control-row" id="clusterFilters"><span class="control-label">Clusters</span></div>
        </div>
      </div>
      <div class="graph-container" id="graphContainer">
        <canvas id="graphCanvas"></canvas>
        <div class="graph-hud">
          <span class="graph-hud-key">Drag</span> Rotate 3D &bull;
          <span class="graph-hud-key">Scroll</span> Zoom &bull;
          <span class="graph-hud-key">Click</span> Inspect
        </div>
      </div>
      <div class="studio-list-view" id="studioListView" hidden>
        <div class="studio-list-toolbar">
          <input type="text" id="studioListSearch" placeholder="Filter by title, content or tag..." autocomplete="off" spellcheck="false" />
          <span class="control-label" id="studioListCount">0 rows</span>
        </div>
        <table class="studio-table">
          <thead>
            <tr>
              <th data-sort="title">Title</th>
              <th data-sort="type">Type</th>
              <th data-sort="status">Status</th>
              <th data-sort="project">Project</th>
              <th data-sort="created_at" aria-sort="descending">Created</th>
            </tr>
          </thead>
          <tbody id="studioTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- View 2: Active Constraints & Session Handoff -->
    <div class="view-panel" id="panel-current">
      <div class="content-view-wrap">
        <div class="handoff-box">
          <div class="card-title-lg">
            <span>⚡ In-Flight Session State & Handoff</span>
            <span class="brand-tag" id="handoffStatus">[IDLE]</span>
          </div>
          <div class="handoff-grid">
            <div class="handoff-cell"><div class="handoff-lbl">Active Agent</div><div class="handoff-val" id="handoffAgent">None</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Session ID</div><div class="handoff-val mono" id="handoffSessionId">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Last Updated</div><div class="handoff-val" id="handoffUpdated">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Active Task</div><div class="handoff-val" id="handoffTask">No active task</div></div>
          </div>
          <div style="margin-top:14px;" id="handoffProgressBox"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>🛡️ Active Working Invariants & Hard Constraints</span>
            <button class="btn-primary write-action" onclick="quickAddConstraint()">+ Add Constraint</button>
          </div>
          <div id="constraintsList" style="display:flex; flex-direction:column; gap:8px;"></div>
        </div>
      </div>
    </div>

    <!-- View 3: Obsidian Knowledge Wiki -->
    <div class="view-panel" id="panel-wiki">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>📚 Compiled Knowledge Wiki Pages</span>
            <span class="brand-tag" id="wikiCountBadge">0 Pages</span>
          </div>
          <div id="wikiPagesGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px;"></div>
        </div>
        <div class="view-card" id="wikiViewerCard" style="display:none;">
          <div class="card-title-lg" id="wikiPageTitle">Wiki Page</div>
          <div class="content-box" id="wikiPageContent"></div>
        </div>
      </div>
    </div>

    <!-- View 4: Persona Studio -->
    <div class="view-panel" id="panel-persona">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">👤 Persona & Working Preference Studio (USER.md)</div>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
            Switch active agent archetypes to steer communication tone, coding depth, and design rules across all connected platforms.
          </p>
          <div class="archetype-grid" id="archetypeGrid">
            <button type="button" class="archetype-card" data-arch="developer"><span class="archetype-icon">💻</span><span class="archetype-title">Developer</span></button>
            <button type="button" class="archetype-card" data-arch="designer"><span class="archetype-icon">🎨</span><span class="archetype-title">Designer</span></button>
            <button type="button" class="archetype-card" data-arch="marketer"><span class="archetype-icon">🚀</span><span class="archetype-title">Marketer</span></button>
            <button type="button" class="archetype-card" data-arch="casual"><span class="archetype-icon">☕</span><span class="archetype-title">Casual</span></button>
            <button type="button" class="archetype-card" data-arch="custom"><span class="archetype-icon">⚙️</span><span class="archetype-title">Custom</span></button>
          </div>
          <div style="margin-top:20px;">
            <div class="card-title-lg">Active USER.md Instructions</div>
            <textarea id="userProfileText" style="width:100%; height:200px; background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); color:#fff; padding:12px; font-family:'JetBrains Mono', monospace; font-size:12px; line-height:1.5; outline:none;"></textarea>
            <button class="btn-primary write-action" style="margin-top:10px;" onclick="saveUserProfile()">Save Preferences</button>
          </div>
        </div>
      </div>
    </div>

    <!-- View 5: Knapsack Retrieval Sandbox -->
    <div class="view-panel" id="panel-sandbox">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">🔍 Real-Time Knapsack Retrieval Sandbox</div>
          <div class="sandbox-input-grid">
            <input type="text" id="sandboxQuery" placeholder="Enter query (e.g., 'auth token refresh invariant', 'cors headers')..." style="background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); padding:10px 14px; color:#fff; font-size:13px; outline:none;" />
            <button class="btn-primary" onclick="testRetrieval()">Simulate Prompt Context</button>
          </div>
          <div class="control-row" style="margin-bottom:16px;">
            <span class="control-label">Token Budget:</span>
            <input type="range" id="sandboxBudgetSlider" min="500" max="6000" step="250" value="2000" oninput="document.getElementById('sandboxBudgetVal').textContent = this.value + ' tokens'" />
            <span class="control-label mono" id="sandboxBudgetVal">2000 tokens</span>
          </div>
          <div class="card-title-lg" style="margin-top:16px;">
            <span>Simulated Prompt Context Injection</span>
            <button class="btn-icon" onclick="navigator.clipboard.writeText(document.getElementById('promptContextOut').textContent); flash('Copied prompt context!');">📋 Copy</button>
          </div>
          <div class="code-preview" id="promptContextOut">// Enter a query above and click simulate to inspect the rendered context...</div>
        </div>
      </div>
    </div>

    <!-- View 6: Audit Ledger -->
    <div class="view-panel" id="panel-audit">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>📜 Append-Only Compliance Audit Trail</span>
            <button class="btn-icon" onclick="loadAudit()">🔄 Refresh</button>
          </div>
          <table class="audit-table">
            <thead>
              <tr><th>Timestamp</th><th>Operation</th><th>Entry ID</th><th>Actor</th><th>Details</th></tr>
            </thead>
            <tbody id="auditTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 7: Project Health Gate & Observability -->
    <div class="view-panel" id="panel-health">
      <div class="content-view-wrap">
        <div class="view-card" style="background: linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(99,102,241,0.06) 100%);">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
            <div style="display:flex; align-items:center; gap:18px;">
              <div class="grade-circle grade-a" id="healthGrade">A</div>
              <div>
                <div style="font-size:20px; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
                  <span>5-Pillar Project Health Scorecard</span>
                  <span class="gate-badge gate-pass" id="healthGate">[PASS]</span>
                </div>
                <div style="font-size:13px; color:var(--text-muted); margin-top:3px;" id="healthSummary">Comprehensive project cognitive health evaluation.</div>
                <div style="font-size:11px; color:var(--text-dim); margin-top:6px; display:flex; gap:14px; flex-wrap:wrap;">
                  <span id="healthScopeProject">Project: --</span>
                  <span id="healthScope">Scope: --</span>
                </div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; font-weight:700; color:var(--text-dim); text-transform:uppercase;">Composite Health Score</div>
              <div style="font-size:28px; font-weight:800; color:#fff;" id="healthScore">95/100</div>
            </div>
          </div>

          <div class="pillars-grid">
            <!-- Pillar 1: Store Integrity -->
            <div class="pillar-card">
              <div class="pillar-title">1. Memory Store Integrity</div>
              <div class="pillar-score" id="pStoreScore">--</div>
              <div class="p-bar-bg"><div class="p-bar-fill" id="pStoreBar" style="width:0%;"></div></div>
              <div class="pillar-meta">
                <span>Contradictions: <strong id="pStoreContradictions">0</strong></span>
                <span>Expired: <strong id="pStoreExpired">0</strong></span>
              </div>
            </div>
            <!-- Pillar 2: Code Anchors -->
            <div class="pillar-card">
              <div class="pillar-title">2. Native Code Anchors</div>
              <div class="pillar-score" id="pAnchorsScore">--</div>
              <div class="p-bar-bg"><div class="p-bar-fill" id="pAnchorsBar" style="width:0%;"></div></div>
              <div class="pillar-meta">
                <span>Valid: <strong id="pAnchorsValid">0</strong></span>
                <span>Drifted: <strong id="pAnchorsDrifted">0</strong></span>
              </div>
            </div>
            <!-- Pillar 3: Documentation Alignment -->
            <div class="pillar-card">
              <div class="pillar-title">3. Doc-Code Alignment</div>
              <div class="pillar-score" id="pDocScore">--</div>
              <div class="p-bar-bg"><div class="p-bar-fill" id="pDocBar" style="width:0%;"></div></div>
              <div class="pillar-meta">
                <span>Documented: <strong id="pDocDoc">0</strong></span>
                <span>Missing: <strong id="pDocMissing">0</strong></span>
              </div>
            </div>
            <!-- Pillar 4: Anti-Pattern Sentry -->
            <div class="pillar-card">
              <div class="pillar-title">4. Anti-Pattern Sentry</div>
              <div class="pillar-score" id="pLessonsScore">--</div>
              <div class="p-bar-bg"><div class="p-bar-fill" id="pLessonsBar" style="width:0%;"></div></div>
              <div class="pillar-meta">
                <span>Total Lessons: <strong id="pLessonsTotal">0</strong></span>
                <span>Active Traps: <strong id="pLessonsActive">0</strong></span>
              </div>
            </div>
            <!-- Pillar 5: Tech Debt & Fragility -->
            <div class="pillar-card">
              <div class="pillar-title">5. Technical Debt & Friction</div>
              <div class="pillar-score" id="pDebtScore">--</div>
              <div class="p-bar-bg"><div class="p-bar-fill" id="pDebtBar" style="width:0%;"></div></div>
              <div class="pillar-meta">
                <span>TODOs/Bypasses: <strong id="pDebtTodos">0</strong></span>
                <span>Fragile Subsystems: <strong id="pDebtFragile">0</strong></span>
              </div>
            </div>
          </div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>📋 Prioritized Remediation Action Checklist</span>
            <button class="btn-icon" onclick="fetchHealth()">🔄 Re-Audit</button>
          </div>
          <table class="audit-table">
            <thead>
              <tr><th style="width:110px;">Priority</th><th>Issue Detected</th><th>Recommended Action</th></tr>
            </thead>
            <tbody id="healthChecklistBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 8: ADRs & Documentation Drift -->
    <div class="view-panel" id="panel-adrs">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>🏛️ Architecture Decision Records (ADRs)</span>
            <button class="btn-icon" onclick="fetchAdrs()">🔄 Refresh</button>
          </div>
          <div id="adrsListGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:14px;"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>🔍 Code ↔ Documentation Bi-Directional Drift Inspector</span>
            <button class="btn-icon" onclick="fetchDrift()">🔄 Audit Drift</button>
          </div>
          <table class="audit-table">
            <thead>
              <tr><th>Symbol</th><th>Status</th><th>File Path</th><th>Explanation</th></tr>
            </thead>
            <tbody id="driftTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 9: Engineering Cognition & "Why" Reasoner -->
    <div class="view-panel" id="panel-cognition">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">🤔 Engineering Cognition: Autonomous "Why" Reasoner</div>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
            Traces code evolution backwards through past bug fixes, architectural trade-offs, and ADRs to explain why code was written this way.
          </p>
          <div class="sandbox-input-grid">
            <input type="text" id="whyInput" placeholder="Enter symbol or path (e.g., 'computeFingerprint', 'openStore', 'src/sync/engine.ts')..." style="background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); padding:10px 14px; color:#fff; font-size:13px; outline:none;" />
            <button class="btn-primary" onclick="explainWhyCode()">Explain Why</button>
          </div>
          <div id="whyOutput" style="display:none; margin-top:14px; padding:16px; background:rgba(0,0,0,0.3); border:1px solid var(--panel-border); border-radius:var(--radius-md);"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">🔥 Recurring Bugs & Friction Clusters (Fragility Heatmap)</div>
          <div id="clustersGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px; margin-bottom:20px;"></div>
          
          <div class="card-title-lg" style="margin-top:20px;">⚠️ Technical Debt & Risk Hotspots</div>
          <table class="audit-table">
            <thead>
              <tr><th>File</th><th>TODOs</th><th>FIXMEs</th><th>Risk Level</th></tr>
            </thead>
            <tbody id="debtTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 10: P2P Gossip Mesh Sync -->
    <div class="view-panel" id="panel-sync">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>🤝 Cross-Agent Knowledge Sync & P2P Gossip Mesh</span>
            <div style="display:flex; gap:8px;">
              <button class="btn-primary write-action" onclick="broadcastSyncPacket()">📡 Broadcast Packet</button>
              <button class="btn-primary write-action" style="background:#059669;" onclick="syncPool()">🔄 Sync with Pool</button>
            </div>
          </div>
          <div class="handoff-grid" style="margin-top:10px;">
            <div class="handoff-cell"><div class="handoff-lbl">Local Agent ID</div><div class="handoff-val mono" id="syncLocalAgent">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Known Peers</div><div class="handoff-val" id="syncTotalPeers">0</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Outgoing Memories Ready</div><div class="handoff-val" id="syncPendingMemories">0</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Last Sync Time</div><div class="handoff-val" id="syncLastAt">Never</div></div>
          </div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>👥 Known Peer Agents & Vector Clocks</span>
            <button class="btn-icon" onclick="fetchSyncStatus()">🔄 Refresh Status</button>
          </div>
          <table class="audit-table">
            <thead>
              <tr><th>Peer Agent ID</th><th>Last Seen</th><th>Total Packets</th><th>Memories Ingested</th></tr>
            </thead>
            <tbody id="syncPeersTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 11: Multi-Repo & Monorepo Mesh -->
    <div class="view-panel" id="panel-mesh">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>🕸️ Monorepo & Multi-Repo Cross-Project Mesh Topology</span>
            <button class="btn-icon" onclick="fetchMeshStatus()">🔄 Refresh Mesh</button>
          </div>
          <div class="handoff-grid" style="margin-top:10px;">
            <div class="handoff-cell"><div class="handoff-lbl">Workspace Root</div><div class="handoff-val mono" style="font-size:12px;" id="meshRoot">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Workspace Type</div><div class="handoff-val" id="meshType">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Monorepo Mode</div><div class="handoff-val" id="meshIsMono">--</div></div>
            <div class="handoff-cell"><div class="handoff-lbl">Discovered Nodes</div><div class="handoff-val" id="meshNodeCount">0</div></div>
          </div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>📦 Discovered Package & Subproject Nodes</span>
          </div>
          <div id="meshNodesGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:12px;"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>🔍 Cross-Project Mesh Memory Query</span>
          </div>
          <div class="sandbox-input-grid">
            <input type="text" id="meshQueryInput" placeholder="Search across all linked packages & repos..." style="background:#080c14; border:1px solid var(--panel-border); border-radius:var(--radius-md); padding:10px 14px; color:#fff; font-size:13px; outline:none;" />
            <button class="btn-primary" onclick="searchMesh()">Search Mesh</button>
          </div>
          <div id="meshQueryResults" style="display:flex; flex-direction:column; gap:10px;"></div>
        </div>

        <div class="view-card">
          <div class="card-title-lg">
            <span>🛡️ Cross-Package Contract & Dependency Audit</span>
            <button class="btn-icon" onclick="fetchMeshAudit()">🔄 Run Audit</button>
          </div>
          <div id="meshAuditSummary" style="font-size:13px; color:var(--text-muted); margin-bottom:12px;"></div>
          <table class="audit-table">
            <thead>
              <tr><th>Source</th><th>Target</th><th>Symbol</th><th>Status</th><th>Details</th></tr>
            </thead>
            <tbody id="meshAuditTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
    
    <!-- View 12: About poster (T-463) -->
    <div class="view-panel" id="panel-about">
      <div class="content-view-wrap">
        <div class="view-card about-poster">
          <div class="about-kicker">MUSE MEMORY</div>
          <h2 class="about-title">Autonomous persistent cognitive memory</h2>
          <p class="about-lede">
            Local-first memory for coding agents. Every memory lives in your own <code>.memory/</code>
            directory, served by an in-process SQLite + FTS5 engine.
          </p>
          <div class="about-grid">
            <div class="about-fact"><span>Engine</span><strong>SQLite + FTS5</strong></div>
            <div class="about-fact"><span>Scope</span><strong id="aboutScope">./.memory</strong></div>
            <div class="about-fact"><span>Memories</span><strong id="aboutTotal">0</strong></div>
            <div class="about-fact"><span>Constraints</span><strong id="aboutConstraints">0</strong></div>
            <div class="about-fact"><span>Wiki pages</span><strong id="aboutWiki">0</strong></div>
            <div class="about-fact"><span>Audit events</span><strong id="aboutAudit">0</strong></div>
          </div>
          <div class="about-privacy">PRIVACY — local files only. No cloud, no telemetry, no background daemon.</div>
        </div>
        <div class="view-card">
          <div class="card-title-lg">
            <span>Quick Start</span>
            <span class="brand-tag">wire an agent in one command</span>
          </div>
          <div class="quickstart-grid" id="quickStartGrid"></div>
        </div>
        <div class="view-card">
          <div class="card-title-lg">
            <span>Command Deck</span>
            <span class="brand-tag">copy any one-liner</span>
          </div>
          <input type="text" id="commandDeckSearch" placeholder="Filter commands..." autocomplete="off" spellcheck="false" style="width:100%; max-width:420px; background:#0a0806; border:1px solid var(--panel-border); border-radius:var(--radius-md); padding:9px 12px; color:#fff; font:inherit; font-size:12px; margin-bottom:12px;" />
          <div class="command-deck" id="commandDeck"></div>
        </div>
      </div>
    </div>

    <!-- View 13: Activity heatmap + agent sessions (T-456) -->
    <div class="view-panel" id="panel-activity">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>Memory Activity — 52 Weeks</span>
            <span class="brand-tag" id="activityMutations">0 mutations</span>
          </div>
          <div class="heatmap-legend">
            <span>Less</span>
            <span class="hm-cell level-0"></span><span class="hm-cell level-1"></span><span class="hm-cell level-2"></span><span class="hm-cell level-3"></span><span class="hm-cell level-4"></span>
            <span>More</span>
          </div>
          <div class="heatmap" id="activityHeatmap"></div>
        </div>
        <div class="view-card">
          <div class="card-title-lg">
            <span>Agent Session Log</span>
            <button type="button" class="btn-icon" onclick="fetchActivity()">Refresh</button>
          </div>
          <div class="session-grid" id="activitySessions"></div>
        </div>
      </div>
    </div>

    <!-- View 15: Workspace terrain vault (T-458) -->
    <div class="view-panel" id="panel-terrain">
      <div class="terrain-split">
        <aside class="terrain-tree" id="terrainTree" aria-label="Terrain maps"></aside>
        <section class="terrain-viewer">
          <div class="terrain-toolbar">
            <span class="mono" id="terrainFileName">Select a map</span>
            <button type="button" class="btn-icon" id="terrainReindex" onclick="reindexTerrain()">REINDEX</button>
          </div>
          <div class="terrain-content" id="terrainContent"><p class="activity-empty">Compile the terrain maps to inspect them.</p></div>
          <div class="terrain-scanline" id="terrainScanline" aria-hidden="true"></div>
        </section>
      </div>
    </div>

    <!-- View 16: Universal agents hub (T-460) -->
    <div class="view-panel" id="panel-agents">
      <div class="content-view-wrap">
        <div class="view-card">
          <div class="card-title-lg">
            <span>Universal Agents Hub</span>
            <span class="brand-tag" id="agentsCounts">0 wired</span>
          </div>
          <div class="agents-grid" id="agentsGrid"></div>
        </div>
        <div class="view-card">
          <div class="card-title-lg">
            <span>"Point Any Agent" Manifest</span>
            <button type="button" class="btn-icon" onclick="copyAgentSnippet()">Copy snippet</button>
          </div>
          <p class="agent-meta">Point any MCP-capable agent at the server below. Paths are local to this machine.</p>
          <div class="agent-meta mono" id="agentManifestPaths">Loading...</div>
          <pre class="code-preview" id="agentManifestSnippet">Loading...</pre>
        </div>
      </div>
    </div>

    <!-- Detail Pane -->
    <div class="detail-pane" id="detailPane">
      <div class="detail-header">
        <div class="detail-title" id="dTitle">Select a memory</div>
        <button class="close-btn" onclick="document.getElementById('detailPane').classList.remove('open')">✕</button>
      </div>
      <div class="meta-row" id="dMeta"></div>
      <div class="content-box" id="dContent"></div>
      <div class="actions" id="dActions"></div>
    </div>
  </div>`;

const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">';

export function renderStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muse Memory -- Visual Inspector & Cognitive Studio</title>
  ${FONT_LINKS}
  <link rel="stylesheet" href="/assets/studio.css">
</head>
<body>
` + STUDIO_BODY + `
  <script defer src="/assets/studio.js"></script>
</body>
</html>`;
}

export interface StudioAsset {
  body: string;
  gzip: Buffer;
  etag: string;
  gzipEtag: string;
  contentType: string;
}

function makeAsset(body: string, contentType: string): StudioAsset {
  const gzip = gzipSync(Buffer.from(body, "utf8"));
  const digest = (data: string | Buffer) => '"' + createHash("sha256").update(data).digest("hex").slice(0, 32) + '"';
  return { body, gzip, etag: digest(body), gzipEtag: digest(gzip), contentType };
}

export const STUDIO_HTML_ASSET = makeAsset(renderStudioHtml(), "text/html; charset=utf-8");
export const STUDIO_CSS_ASSET = makeAsset(STUDIO_CSS, "text/css; charset=utf-8");
export const STUDIO_JS_ASSET = makeAsset(STUDIO_JS, "text/javascript; charset=utf-8");

export function renderStandaloneHtml(store: Store): string {
  const memories = list(store);
  // Escape every `<` as its JSON unicode form so memory content cannot close the
  // inline script block; replace() takes a function so `$&` in content stays literal.
  const data = JSON.stringify(memories).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muse Memory -- Visual Inspector & Cognitive Studio</title>
  ${FONT_LINKS}
  <style>
${STUDIO_CSS}
  </style>
</head>
<body>
${STUDIO_BODY}
  <script>window.STANDALONE_DATA = ${data};</script>
  <script>
${STUDIO_JS}
  </script>
</body>
</html>`;
}
