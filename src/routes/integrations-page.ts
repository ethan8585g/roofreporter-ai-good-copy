// Self-contained HTML for /customer/integrations.
// Kept in its own file so adding the page only touches index.tsx with
// a one-line import + one-line route mount.
export function getCustomerIntegrationsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Connections — Roof Manager</title>
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root{--bg-page:#0A0A0A;--bg-card:#111111;--bg-card-hover:rgba(255,255,255,0.05);--bg-elevated:#1a1a1a;--text-primary:#fff;--text-secondary:#d1d5db;--text-muted:#9ca3af;--border-color:rgba(255,255,255,0.1);--accent:#00FF88;--accent-hover:#00e67a}
    html.light-theme,body.light-theme,.light-theme{--bg-page:#f5f7fa;--bg-card:#ffffff;--bg-card-hover:#f0f4f8;--bg-elevated:#ffffff;--text-primary:#0B0F12;--text-secondary:#28373E;--text-muted:#5a6b74;--border-color:#dde3e9;--accent:#1373e3;--accent-hover:#0d509f}
    body{background:var(--bg-page);color:var(--text-primary);font-family:Inter,system-ui,sans-serif}
    .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
    .pill-ok{background:rgba(34,197,94,.15);color:#22c55e}
    .pill-fail{background:rgba(239,68,68,.15);color:#ef4444}
    .pill-pending{background:rgba(245,158,11,.15);color:#f59e0b}
    .pill-disabled{background:rgba(148,163,184,.15);color:#94a3b8}
    .input{background:var(--bg-elevated);border:1px solid var(--border-color);color:var(--text-primary);border-radius:8px;padding:10px 12px;width:100%;font-size:14px}
    .input:focus{outline:none;border-color:var(--accent)}
    .btn{padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s}
    .btn:hover{opacity:.9}
    .btn-primary{background:var(--accent);color:#000}
    .btn-secondary{background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color)}
    .btn-danger{background:rgba(239,68,68,.15);color:#ef4444}
    .card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:18px}
    .toast{position:fixed;top:18px;right:18px;z-index:60;padding:12px 18px;border-radius:8px;font-weight:600;font-size:14px}
    .toast-ok{background:#16a34a;color:#fff}
    .toast-err{background:#dc2626;color:#fff}
  </style>
  <script>!function(){var t=localStorage.getItem('rc_dashboard_theme');if(t==='light'||(t==='auto'&&window.matchMedia('(prefers-color-scheme:light)').matches)){document.documentElement.classList.add('light-theme');document.addEventListener('DOMContentLoaded',function(){document.body.classList.add('light-theme')})}}();</script>
</head>
<body class="min-h-screen">
  <header style="background:var(--bg-card);border-bottom:1px solid var(--border-color)">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/customer/dashboard" class="flex items-center gap-3 hover:opacity-90">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <div>
          <h1 class="text-lg font-bold" style="color:var(--text-primary)">Send Reports to API Connection</h1>
          <p class="text-xs" style="color:var(--text-muted)">Push every finalized report into your CRM (AccuLynx, JobNimbus, Roofr, custom)</p>
        </div>
      </a>
      <nav class="flex items-center gap-4">
        <a href="/customer/dashboard" class="text-sm transition-colors" style="color:var(--text-secondary)"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a>
      </nav>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="integrations-root"></div>
  </main>
  <script>
    (function(){
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
    })();
  </script>
  <script src="/static/customer-integrations.js?v=${Date.now()}"></script>
</body>
</html>`
}
