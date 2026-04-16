/**
 * Super Admin BI Analytics Hub — Frontend
 * Plain JS, no framework/build step required.
 * Auth via rc_token in localStorage (same pattern as all other admin pages).
 */
(function () {
  'use strict'

  // ── State ────────────────────────────────────────────────────
  const BI = {
    view: 'overview',
    period: '7d',
    liveInterval: null,
    liveSecondsAgo: 0,
    liveTickInterval: null
  }

  // ── Auth helpers ─────────────────────────────────────────────
  function biHeaders() {
    const t = localStorage.getItem('rc_token')
    return t ? { Authorization: 'Bearer ' + t } : {}
  }
  async function biFetch(url) {
    try {
      const r = await fetch(url, { headers: biHeaders() })
      if (r.status === 401 || r.status === 403) { window.location.href = '/login'; return null }
      return r
    } catch (err) {
      console.error('BI fetch error:', err)
      return null
    }
  }

  // ── Utility ──────────────────────────────────────────────────
  function fmt$cents(cents) {
    const dollars = (cents || 0) / 100
    if (dollars >= 1000) return '$' + (dollars / 1000).toFixed(1) + 'k'
    return '$' + dollars.toFixed(0)
  }
  function fmt$(dollars) {
    if (dollars >= 1000) return '$' + (dollars / 1000).toFixed(1) + 'k'
    return '$' + (dollars || 0).toFixed(0)
  }
  function timeAgo(dateStr) {
    if (!dateStr) return 'never'
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return diff + 's ago'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
    return Math.floor(diff / 86400) + 'd ago'
  }
  function countryFlag(country) {
    if (!country || country.length !== 2) return '🌍'
    const offset = 127397
    return String.fromCodePoint(...[...country.toUpperCase()].map(c => c.charCodeAt(0) + offset))
  }
  function deviceIcon(deviceType) {
    if (!deviceType) return '<i class="fas fa-question-circle text-gray-500 text-xs"></i>'
    const d = deviceType.toLowerCase()
    if (d.includes('mobile') || d.includes('phone')) return '<i class="fas fa-mobile-alt text-blue-400 text-xs"></i>'
    if (d.includes('tablet')) return '<i class="fas fa-tablet-alt text-purple-400 text-xs"></i>'
    return '<i class="fas fa-desktop text-gray-400 text-xs"></i>'
  }
  function scorePill(score) {
    const cls = score >= 70 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-700'
      : score >= 30 ? 'bg-amber-500/20 text-amber-300 border-amber-700'
      : 'bg-red-500/20 text-red-300 border-red-700'
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${cls}">${score}</span>`
  }
  function deltaArrow(current, previous) {
    if (!previous || previous === 0) return ''
    const pct = Math.round(((current - previous) / previous) * 100)
    if (pct > 0) return `<span class="text-emerald-400 text-xs ml-1">▲${pct}%</span>`
    if (pct < 0) return `<span class="text-red-400 text-xs ml-1">▼${Math.abs(pct)}%</span>`
    return `<span class="text-gray-500 text-xs ml-1">—</span>`
  }
  function loadingHTML() {
    return `<div class="flex items-center justify-center h-64">
      <div class="text-center">
        <div class="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p class="text-gray-500 text-sm">Loading...</p>
      </div>
    </div>`
  }
  function errorHTML(msg) {
    return `<div class="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center text-red-300">
      <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
      <p class="font-semibold">Failed to load data</p>
      <p class="text-xs mt-1 text-red-400">${msg || 'Unknown error'}</p>
    </div>`
  }

  // ── Anomaly banners ──────────────────────────────────────────
  function anomaliesHTML(anomalies) {
    if (!anomalies || anomalies.length === 0) return ''
    const severityClass = { critical: 'bg-red-900/40 border-red-600 text-red-200', high: 'bg-orange-900/40 border-orange-600 text-orange-200', medium: 'bg-amber-900/30 border-amber-600 text-amber-200' }
    const iconClass = { critical: 'fas fa-bolt text-red-400', high: 'fas fa-exclamation-triangle text-orange-400', medium: 'fas fa-exclamation-circle text-amber-400' }
    return anomalies.map(a => `
      <div class="border rounded-lg p-3 flex gap-3 items-start mb-3 ${severityClass[a.severity] || severityClass.medium}">
        <i class="${iconClass[a.severity] || iconClass.medium} mt-0.5 shrink-0"></i>
        <p class="text-sm">${a.message}</p>
      </div>`).join('')
  }

  // ── KPI card ─────────────────────────────────────────────────
  function kpiCard(label, value, sub, icon, color) {
    return `<div class="bg-slate-800 rounded-xl p-5 border border-slate-700 hover:border-slate-600 transition-colors">
      <div class="flex items-start justify-between mb-3">
        <span class="text-xs text-gray-500 uppercase tracking-wider font-semibold">${label}</span>
        <div class="w-8 h-8 ${color} rounded-lg flex items-center justify-center shrink-0">
          <i class="${icon} text-white text-xs"></i>
        </div>
      </div>
      <div class="text-2xl font-bold text-white mb-1">${value}</div>
      ${sub ? `<div class="text-xs text-gray-500">${sub}</div>` : ''}
    </div>`
  }

  // ── Sidebar nav ──────────────────────────────────────────────
  function biSetView(view) {
    BI.view = view
    document.querySelectorAll('.bi-nav-item').forEach(el => {
      el.classList.remove('active')
      el.classList.add('text-gray-400')
    })
    const active = document.querySelector(`.bi-nav-item[data-view="${view}"]`)
    if (active) { active.classList.add('active'); active.classList.remove('text-gray-400') }

    // Stop live polling if leaving live view
    if (view !== 'live') {
      clearInterval(BI.liveInterval); clearInterval(BI.liveTickInterval)
      BI.liveInterval = null; BI.liveTickInterval = null
    }

    const main = document.getElementById('bi-main')
    if (!main) return
    main.innerHTML = loadingHTML()
    loadBiView(view)
  }

  async function loadBiView(view) {
    switch (view) {
      case 'overview': await loadOverview(); break
      case 'traffic': await loadTraffic(); break
      case 'revenue': await loadRevenue(); break
      case 'funnel': await loadFunnel(); break
      case 'health': await loadCustomerHealth(); break
      case 'live': await loadLive(); break
      default: document.getElementById('bi-main').innerHTML = '<p class="text-gray-500">Unknown view</p>'
    }
  }

  // ── OVERVIEW ─────────────────────────────────────────────────
  async function loadOverview() {
    const [biRes, anomalyRes, waterfallRes] = await Promise.all([
      biFetch('/api/admin/bi/business-intel'),
      biFetch('/api/admin/bi/anomalies'),
      biFetch('/api/admin/bi/revenue-waterfall')
    ])
    const main = document.getElementById('bi-main')
    if (!biRes || !main) { main && (main.innerHTML = errorHTML('Failed to fetch data')); return }

    let bi, anomalies = [], waterfall
    try { bi = await biRes.json() } catch { main.innerHTML = errorHTML('Invalid response'); return }
    try { if (anomalyRes) { const ad = await anomalyRes.json(); anomalies = ad.anomalies || [] } } catch {}
    try { if (waterfallRes) { waterfall = await waterfallRes.json() } } catch {}

    const chartBars = waterfall?.tiers?.map(t => `
      <div class="flex flex-col items-center gap-1 flex-1 min-w-0">
        <div class="text-xs font-bold text-white truncate w-full text-center">${fmt$(t.paid_revenue)}</div>
        <div class="w-full rounded-t transition-all" style="height:${Math.max(t.bar_pct, 4)}px;background:linear-gradient(180deg,#6366f1,#4338ca);min-height:4px"></div>
        <div class="text-xs text-gray-500 truncate w-full text-center">${t.service_tier || 'N/A'}</div>
        <div class="text-xs text-gray-600">${t.paid_orders}/${t.total_orders} paid</div>
      </div>`).join('') || '<p class="text-gray-600 text-xs">No orders in last 30 days</p>'

    const monthlySparkline = bi.monthly_new_customers?.map(m => `
      <div class="flex flex-col items-center gap-1">
        <div class="w-6 bg-indigo-500/60 rounded-t" style="height:${Math.max((m.new_customers / (Math.max(...bi.monthly_new_customers.map(x => x.new_customers), 1))) * 40, 4)}px"></div>
        <div class="text-[9px] text-gray-600 rotate-[-45deg] origin-center translate-y-2">${m.month?.slice(5)}</div>
      </div>`).join('') || ''

    main.innerHTML = `
      <div class="space-y-6">
        ${anomaliesHTML(anomalies)}

        <div>
          <h2 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-crown text-yellow-400"></i> Business Overview
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            ${kpiCard('MRR', fmt$cents(bi.mrr_cents), `${bi.mrr_cents > 0 ? 'from secretary subs' : 'No active subs'}`, 'fas fa-sync-alt', 'bg-indigo-600')}
            ${kpiCard('ARR', fmt$cents(bi.arr_cents), 'annualized recurring', 'fas fa-chart-line', 'bg-purple-600')}
            ${kpiCard('30d Revenue', fmt$(bi.revenue_30d_cents / 100), 'transactional', 'fas fa-dollar-sign', 'bg-emerald-600')}
            ${kpiCard('ARPC', fmt$cents(bi.arpc_cents), 'avg revenue per customer/yr', 'fas fa-user-tag', 'bg-blue-600')}
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${kpiCard('Trial → Paid', bi.trial_conversion_rate + '%', `${bi.trial_converted}/${bi.trial_orders} converted (90d)`, 'fas fa-funnel-dollar', 'bg-amber-600')}
          ${kpiCard('Churned', bi.churned_customers + '', 'inactive 60+ days', 'fas fa-user-times', bi.churned_customers > 5 ? 'bg-red-600' : 'bg-gray-600')}
          ${kpiCard('Report Rate', bi.report_completion_rate + '%', `${bi.completed_reports_30d}/${bi.total_reports_30d} completed (30d)`, 'fas fa-file-alt', 'bg-teal-600')}
          ${kpiCard('Avg Quality', bi.avg_quality_score ? bi.avg_quality_score + '%' : 'N/A', 'AI confidence score', 'fas fa-star', 'bg-yellow-600')}
        </div>

        <div class="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h3 class="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <i class="fas fa-chart-bar text-indigo-400"></i> Revenue by Tier (last 30 days)
          </h3>
          <div class="flex items-end gap-3 h-32">${chartBars}</div>
        </div>

        ${bi.monthly_new_customers?.length ? `
        <div class="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h3 class="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <i class="fas fa-user-plus text-emerald-400"></i> New Customers (last 6 months)
          </h3>
          <div class="flex items-end gap-2 h-14 mb-6">${monthlySparkline}</div>
          <div class="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
            ${bi.monthly_new_customers.map(m => `
              <div class="text-center">
                <div class="text-lg font-bold text-white">${m.new_customers}</div>
                <div class="text-xs text-gray-500">${m.month}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>`
  }

  // ── SITE TRAFFIC ─────────────────────────────────────────────
  async function loadTraffic() {
    const period = BI.period || '7d'
    const res = await biFetch('/api/analytics/dashboard?period=' + period)
    const main = document.getElementById('bi-main')
    if (!res || !main) { main && (main.innerHTML = errorHTML('Failed')); return }
    let d
    try { d = await res.json() } catch { main.innerHTML = errorHTML('Invalid response'); return }

    const ov = d.overview || {}
    const prev = d.previous_period || {}

    const hourlyBars = (d.hourly_traffic || []).map((h, i) => {
      const maxV = Math.max(...(d.hourly_traffic || []).map(x => x.count || 0), 1)
      return `<div class="flex-1 flex flex-col items-center group relative" title="${h.hour}: ${h.count}">
        <div class="w-full rounded-t bg-indigo-500/50 hover:bg-indigo-500 transition-colors" style="height:${Math.max((h.count / maxV) * 60, 1)}px"></div>
      </div>`
    }).join('')

    const topPagesRows = (d.top_pages || []).slice(0, 15).map(p => `
      <tr class="border-t border-slate-700 hover:bg-slate-750">
        <td class="py-2 px-3 text-xs text-gray-300 truncate max-w-xs" title="${p.page}">${p.page || '/'}</td>
        <td class="py-2 px-3 text-xs text-white text-right font-semibold">${(p.views || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-xs text-gray-400 text-right">${p.unique_visitors || 0}</td>
        <td class="py-2 px-3 text-xs text-gray-400 text-right">${p.bounce_rate != null ? Math.round(p.bounce_rate) + '%' : '—'}</td>
      </tr>`).join('')

    const countriesRows = (d.top_countries || []).slice(0, 10).map(c => `
      <div class="flex items-center justify-between py-1.5">
        <span class="text-sm text-gray-300">${countryFlag(c.country)} ${c.country || 'Unknown'}</span>
        <span class="text-sm font-semibold text-white">${(c.visitors || 0).toLocaleString()}</span>
      </div>`).join('')

    const referrerRows = (d.top_referrers || []).slice(0, 10).map(r => `
      <div class="flex items-center justify-between py-1.5">
        <span class="text-xs text-gray-400 truncate max-w-[140px]">${r.referrer || 'Direct'}</span>
        <span class="text-xs font-semibold text-white">${r.count || 0}</span>
      </div>`).join('')

    const devices = d.devices || {}
    const totalDevices = (devices.desktop || 0) + (devices.mobile || 0) + (devices.tablet || 0) || 1
    const deskPct = Math.round((devices.desktop || 0) / totalDevices * 100)
    const mobPct = Math.round((devices.mobile || 0) / totalDevices * 100)
    const tabPct = 100 - deskPct - mobPct

    main.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <i class="fas fa-chart-area text-blue-400"></i> Site Traffic
          </h2>
          <div class="flex gap-1">
            ${['24h','7d','30d','90d'].map(p => `
              <button onclick="biSetPeriod('${p}')" class="px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${BI.period === p ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}">${p}</button>
            `).join('')}
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${kpiCard('Pageviews', (ov.pageviews || 0).toLocaleString(), deltaArrow(ov.pageviews, prev.pageviews), 'fas fa-eye', 'bg-blue-600')}
          ${kpiCard('Unique Visitors', (ov.unique_visitors || 0).toLocaleString(), deltaArrow(ov.unique_visitors, prev.unique_visitors), 'fas fa-users', 'bg-indigo-600')}
          ${kpiCard('Sessions', (ov.sessions || 0).toLocaleString(), deltaArrow(ov.sessions, prev.sessions), 'fas fa-clock', 'bg-violet-600')}
          ${kpiCard('Avg Time', ov.avg_time_on_page ? Math.round(ov.avg_time_on_page) + 's' : '—', 'avg time on page', 'fas fa-hourglass-half', 'bg-teal-600')}
        </div>

        ${hourlyBars ? `
        <div class="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h3 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <i class="fas fa-wave-square text-blue-400"></i> Hourly Traffic (last 48h)
          </h3>
          <div class="flex items-end h-16 gap-0.5">${hourlyBars}</div>
        </div>` : ''}

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="md:col-span-2 bg-slate-800 rounded-xl border border-slate-700">
            <div class="p-4 border-b border-slate-700">
              <h3 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <i class="fas fa-file-alt text-gray-400"></i> Top Pages
              </h3>
            </div>
            <table class="w-full">
              <thead><tr class="text-xs text-gray-600 uppercase">
                <th class="py-2 px-3 text-left">Page</th>
                <th class="py-2 px-3 text-right">Views</th>
                <th class="py-2 px-3 text-right">Unique</th>
                <th class="py-2 px-3 text-right">Bounce</th>
              </tr></thead>
              <tbody>${topPagesRows || '<tr><td colspan="4" class="text-center text-gray-600 py-4 text-xs">No data</td></tr>'}</tbody>
            </table>
          </div>

          <div class="space-y-4">
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h3 class="text-xs font-semibold text-gray-500 uppercase mb-3">Devices</h3>
              <div class="flex rounded-full overflow-hidden h-3 mb-3">
                <div class="bg-blue-500" style="width:${deskPct}%" title="Desktop ${deskPct}%"></div>
                <div class="bg-purple-500" style="width:${mobPct}%" title="Mobile ${mobPct}%"></div>
                <div class="bg-teal-500" style="width:${tabPct}%" title="Tablet ${tabPct}%"></div>
              </div>
              <div class="grid grid-cols-3 gap-1 text-center">
                <div><div class="text-xs font-bold text-white">${deskPct}%</div><div class="text-[10px] text-gray-600">Desktop</div></div>
                <div><div class="text-xs font-bold text-white">${mobPct}%</div><div class="text-[10px] text-gray-600">Mobile</div></div>
                <div><div class="text-xs font-bold text-white">${tabPct}%</div><div class="text-[10px] text-gray-600">Tablet</div></div>
              </div>
            </div>
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h3 class="text-xs font-semibold text-gray-500 uppercase mb-3">Countries</h3>
              ${countriesRows || '<p class="text-xs text-gray-600">No data</p>'}
            </div>
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h3 class="text-xs font-semibold text-gray-500 uppercase mb-3">Top Referrers</h3>
              ${referrerRows || '<p class="text-xs text-gray-600">No data</p>'}
            </div>
          </div>
        </div>
      </div>`
  }

  function biSetPeriod(p) {
    BI.period = p
    const main = document.getElementById('bi-main')
    if (main) main.innerHTML = loadingHTML()
    loadTraffic()
  }
  window.biSetPeriod = biSetPeriod

  // ── REVENUE ───────────────────────────────────────────────────
  async function loadRevenue() {
    const res = await biFetch('/api/admin/bi/revenue-waterfall')
    const main = document.getElementById('bi-main')
    if (!res || !main) { main && (main.innerHTML = errorHTML('Failed')); return }
    let d
    try { d = await res.json() } catch { main.innerHTML = errorHTML('Invalid response'); return }

    const t = d.totals || {}
    const tierRows = (d.tiers || []).map(tier => `
      <tr class="border-t border-slate-700">
        <td class="py-3 px-4 text-sm text-gray-300 font-medium">${tier.service_tier || 'Unknown'}</td>
        <td class="py-3 px-4 text-sm text-white text-right">${tier.total_orders}</td>
        <td class="py-3 px-4 text-sm text-emerald-400 text-right font-semibold">${tier.paid_orders}</td>
        <td class="py-3 px-4 text-sm text-white text-right font-bold">${fmt$(tier.paid_revenue)}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-700 rounded-full h-2">
              <div class="h-2 rounded-full bg-indigo-500" style="width:${tier.bar_pct}%"></div>
            </div>
            <span class="text-xs text-gray-400 w-8 text-right">${tier.conversion_rate}%</span>
          </div>
        </td>
      </tr>`).join('')

    main.innerHTML = `
      <div class="space-y-6">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <i class="fas fa-dollar-sign text-emerald-400"></i> Revenue (last 30 days)
        </h2>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${kpiCard('Total Orders', t.total_orders || 0, '', 'fas fa-clipboard-list', 'bg-gray-600')}
          ${kpiCard('Paid Orders', t.paid_orders || 0, '', 'fas fa-check-circle', 'bg-emerald-600')}
          ${kpiCard('Paid Revenue', fmt$(t.paid_revenue), 'last 30 days', 'fas fa-dollar-sign', 'bg-indigo-600')}
          ${kpiCard('Conv Rate', (t.conversion_rate || 0) + '%', 'orders → paid', 'fas fa-percentage', 'bg-purple-600')}
        </div>

        <div class="bg-slate-800 rounded-xl border border-slate-700">
          <div class="p-4 border-b border-slate-700">
            <h3 class="text-sm font-semibold text-gray-300">Revenue by Service Tier</h3>
          </div>
          <table class="w-full">
            <thead><tr class="text-xs text-gray-600 uppercase">
              <th class="py-2 px-4 text-left">Tier</th>
              <th class="py-2 px-4 text-right">Total</th>
              <th class="py-2 px-4 text-right">Paid</th>
              <th class="py-2 px-4 text-right">Revenue</th>
              <th class="py-2 px-4 text-left">Conv %</th>
            </tr></thead>
            <tbody>${tierRows || '<tr><td colspan="5" class="text-center text-gray-600 py-6 text-xs">No orders in last 30 days</td></tr>'}</tbody>
          </table>
        </div>

        <div class="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h3 class="text-sm font-semibold text-gray-300 mb-4">Orders → Paid Funnel</h3>
          <div class="space-y-3">
            <div>
              <div class="flex justify-between text-xs text-gray-500 mb-1"><span>Total Orders</span><span>${t.total_orders}</span></div>
              <div class="h-4 bg-slate-700 rounded-full overflow-hidden">
                <div class="h-4 bg-blue-500 rounded-full" style="width:100%"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-gray-500 mb-1"><span>Trial Orders</span><span>${t.trial_orders}</span></div>
              <div class="h-4 bg-slate-700 rounded-full overflow-hidden">
                <div class="h-4 bg-amber-500 rounded-full" style="width:${t.total_orders > 0 ? Math.round(t.trial_orders/t.total_orders*100) : 0}%"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-gray-500 mb-1"><span>Paid Orders</span><span>${t.paid_orders}</span></div>
              <div class="h-4 bg-slate-700 rounded-full overflow-hidden">
                <div class="h-4 bg-emerald-500 rounded-full" style="width:${t.total_orders > 0 ? Math.round(t.paid_orders/t.total_orders*100) : 0}%"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`
  }

  // ── FUNNEL ────────────────────────────────────────────────────
  async function loadFunnel(period) {
    const p = period || BI.funnelPeriod || '7d'
    BI.funnelPeriod = p
    const res = await biFetch('/api/admin/bi/funnel?period=' + p)
    const main = document.getElementById('bi-main')
    if (!res || !main) { main && (main.innerHTML = errorHTML('Failed')); return }
    let d
    try { d = await res.json() } catch { main.innerHTML = errorHTML('Invalid response'); return }

    const stages = d.stages || []
    const dropoffs = d.dropoffs || []
    const maxCount = Math.max(...stages.map(s => s.count), 1)

    const stageColors = ['bg-indigo-600', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-emerald-500']

    const stageHTML = stages.map((s, i) => {
      const widthPct = Math.max(s.pct_of_stage1, 2)
      const dropoff = dropoffs[i]
      return `
        <div class="mb-2">
          <div class="flex items-center gap-3 mb-1">
            <span class="text-xs text-gray-500 w-5 font-bold">${s.stage}</span>
            <span class="text-xs text-gray-400 w-28">${s.label}</span>
            <div class="flex-1">
              <div class="${stageColors[i] || 'bg-gray-600'} rounded h-10 flex items-center px-3 justify-between transition-all" style="width:${widthPct}%">
                <span class="text-white text-xs font-semibold truncate">${s.count.toLocaleString()}</span>
                <span class="text-white/70 text-xs hidden sm:block">${s.pct_of_stage1}%</span>
              </div>
            </div>
          </div>
          ${dropoff ? `<div class="ml-8 text-xs text-red-400 mb-1">↓ ${dropoff.lost_pct}% drop-off to "${dropoff.to_label}"</div>` : ''}
        </div>`
    }).join('')

    main.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <i class="fas fa-filter text-violet-400"></i> Conversion Funnel
          </h2>
          <div class="flex gap-1">
            ${['7d','30d'].map(p => `
              <button onclick="biLoadFunnel('${p}')" class="px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${BI.funnelPeriod === p ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-gray-400 hover:bg-slate-600'}">${p}</button>
            `).join('')}
          </div>
        </div>

        <div class="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <p class="text-xs text-gray-500 mb-5">Showing last ${p} — each bar width = % of top-of-funnel visitors</p>
          ${stageHTML || '<p class="text-gray-600 text-sm">No funnel data available</p>'}
        </div>

        <div class="grid grid-cols-2 md:grid-cols-${stages.length} gap-3">
          ${stages.map((s, i) => `
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700 text-center">
              <div class="text-2xl font-bold text-white">${s.count.toLocaleString()}</div>
              <div class="text-xs text-gray-500 mt-1">${s.label}</div>
              <div class="text-xs font-semibold mt-1 ${s.pct_of_stage1 >= 50 ? 'text-emerald-400' : s.pct_of_stage1 >= 20 ? 'text-amber-400' : 'text-red-400'}">${s.pct_of_stage1}% of visitors</div>
            </div>`).join('')}
        </div>
      </div>`
  }
  window.biLoadFunnel = loadFunnel

  // ── CUSTOMER HEALTH ───────────────────────────────────────────
  async function loadCustomerHealth() {
    const res = await biFetch('/api/admin/bi/customer-health')
    const main = document.getElementById('bi-main')
    if (!res || !main) { main && (main.innerHTML = errorHTML('Failed')); return }
    let d
    try { d = await res.json() } catch { main.innerHTML = errorHTML('Invalid response'); return }

    const customers = d.customers || []
    const atRisk = customers.filter(c => c.at_risk)

    const tableRows = customers.slice(0, 100).map(c => `
      <tr class="border-t border-slate-700 hover:bg-slate-750 ${c.at_risk ? 'bg-red-900/10' : ''}">
        <td class="py-2 px-3">
          <div class="text-xs font-semibold text-white truncate max-w-[120px]">${c.company_name || c.name || 'Unknown'}</div>
          <div class="text-[10px] text-gray-600 truncate">${c.email || ''}</div>
        </td>
        <td class="py-2 px-3 text-xs text-gray-400">${c.tier_name || 'Free'}</td>
        <td class="py-2 px-3 text-xs text-gray-400">${c.days_since_login != null ? c.days_since_login + 'd ago' : 'Never'}</td>
        <td class="py-2 px-3 text-xs text-gray-400 text-center">${c.reports_30d}</td>
        <td class="py-2 px-3 text-xs ${c.last_payment_status === 'completed' ? 'text-emerald-400' : c.last_payment_status === 'failed' ? 'text-red-400' : 'text-gray-500'}">${c.last_payment_status || '—'}</td>
        <td class="py-2 px-3 text-xs text-gray-400 text-center">${c.secretary_calls_30d}</td>
        <td class="py-2 px-3">${scorePill(c.score)}</td>
        <td class="py-2 px-3">${c.at_risk ? '<span class="text-xs text-red-400 font-semibold">At Risk</span>' : '<span class="text-xs text-emerald-500">Active</span>'}</td>
      </tr>`).join('')

    main.innerHTML = `
      <div class="space-y-6">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <i class="fas fa-heartbeat text-red-400"></i> Customer Health
        </h2>

        ${atRisk.length > 0 ? `
        <div class="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3">
          <i class="fas fa-exclamation-triangle text-red-400 text-lg shrink-0"></i>
          <div>
            <p class="text-red-300 font-semibold">${atRisk.length} customer${atRisk.length > 1 ? 's' : ''} at risk (score &lt; 30)</p>
            <p class="text-red-400 text-xs mt-0.5">${atRisk.slice(0,3).map(c => c.company_name || c.name).join(', ')}${atRisk.length > 3 ? ` +${atRisk.length - 3} more` : ''}</p>
          </div>
        </div>` : `
        <div class="bg-emerald-900/20 border border-emerald-700 rounded-xl p-4 flex items-center gap-3">
          <i class="fas fa-check-circle text-emerald-400 text-lg"></i>
          <p class="text-emerald-300 font-semibold">All ${d.total} customers have a healthy engagement score</p>
        </div>`}

        <div class="grid grid-cols-3 gap-4">
          ${kpiCard('Total Active', d.total || 0, '', 'fas fa-users', 'bg-blue-600')}
          ${kpiCard('At Risk', d.at_risk_count || 0, 'score < 30', 'fas fa-exclamation-triangle', d.at_risk_count > 0 ? 'bg-red-600' : 'bg-gray-600')}
          ${kpiCard('Healthy', (d.total || 0) - (d.at_risk_count || 0), 'score ≥ 30', 'fas fa-check-circle', 'bg-emerald-600')}
        </div>

        <div class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div class="p-4 border-b border-slate-700 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-300">Customer Scores</h3>
            <span class="text-xs text-gray-500">Score = Login(40) + Reports(30) + Payment(20) + Secretary(10)</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[700px]">
              <thead><tr class="text-xs text-gray-600 uppercase bg-slate-900/50">
                <th class="py-2 px-3 text-left">Customer</th>
                <th class="py-2 px-3 text-left">Tier</th>
                <th class="py-2 px-3 text-left">Last Login</th>
                <th class="py-2 px-3 text-center">Reports 30d</th>
                <th class="py-2 px-3 text-left">Payment</th>
                <th class="py-2 px-3 text-center">Calls 30d</th>
                <th class="py-2 px-3 text-left">Score</th>
                <th class="py-2 px-3 text-left">Status</th>
              </tr></thead>
              <tbody>${tableRows || '<tr><td colspan="8" class="text-center text-gray-600 py-6 text-xs">No customers found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`
  }

  // ── LIVE VISITORS ─────────────────────────────────────────────
  async function loadLive() {
    async function fetchLive() {
      const res = await biFetch('/api/admin/bi/live-visitors')
      if (!res) return
      let d
      try { d = await res.json() } catch { return }

      BI.liveSecondsAgo = 0
      const main = document.getElementById('bi-main')
      if (!main) return

      const events = (d.recent_events || []).map(e => `
        <div class="flex items-start gap-3 py-2 border-b border-slate-800">
          <div class="w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${e.event_type === 'pageview' ? 'bg-blue-400' : e.event_type === 'click' ? 'bg-amber-400' : 'bg-gray-500'}"></div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              ${deviceIcon(e.device_type)}
              <span class="text-xs text-gray-400 truncate">${e.page_url || '/'}</span>
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-gray-600">${countryFlag(e.country)} ${e.city || e.country || 'Unknown'}</span>
              <span class="text-[10px] text-gray-700">•</span>
              <span class="text-[10px] text-gray-600">${timeAgo(e.created_at)}</span>
              <span class="text-[10px] text-gray-700">•</span>
              <span class="text-[10px] text-indigo-500">${e.event_type}</span>
            </div>
          </div>
        </div>`).join('')

      const counterEl = document.getElementById('bi-live-counter')
      const sessEl = document.getElementById('bi-live-sessions')
      const feedEl = document.getElementById('bi-live-feed')
      const countEl = document.getElementById('bi-live-count')

      if (countEl) countEl.textContent = d.active_visitors
      if (sessEl) sessEl.textContent = d.active_sessions + ' sessions'
      if (feedEl) feedEl.innerHTML = events || '<p class="text-xs text-gray-600 py-4 text-center">No recent events</p>'
      if (counterEl) counterEl.textContent = 'just now'
    }

    const main = document.getElementById('bi-main')
    if (!main) return

    main.innerHTML = `
      <div class="space-y-6">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <span class="relative flex h-3 w-3">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          Live Visitors
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-800 rounded-xl p-6 border border-slate-700 text-center">
            <div id="bi-live-count" class="text-6xl font-bold text-white mb-2">—</div>
            <p class="text-gray-500 text-sm">visitors on site right now</p>
            <p id="bi-live-sessions" class="text-xs text-gray-600 mt-1">loading...</p>
            <p class="text-xs text-gray-700 mt-3">Last updated: <span id="bi-live-counter">—</span></p>
          </div>
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 class="text-xs font-semibold text-gray-500 uppercase mb-3">Refresh info</h3>
            <div class="space-y-2 text-xs text-gray-500">
              <p><i class="fas fa-circle text-blue-400 mr-2" style="font-size:8px"></i>Pageview event</p>
              <p><i class="fas fa-circle text-amber-400 mr-2" style="font-size:8px"></i>Click event</p>
              <p><i class="fas fa-circle text-gray-500 mr-2" style="font-size:8px"></i>Other event</p>
              <p class="mt-3 text-gray-600">Data auto-refreshes every 30 seconds</p>
            </div>
          </div>
        </div>

        <div class="bg-slate-800 rounded-xl border border-slate-700">
          <div class="p-4 border-b border-slate-700">
            <h3 class="text-sm font-semibold text-gray-300">Recent Events Feed</h3>
          </div>
          <div id="bi-live-feed" class="p-3 max-h-96 overflow-y-auto">${loadingHTML()}</div>
        </div>
      </div>`

    // Initial load
    await fetchLive()

    // Tick counter
    if (BI.liveTickInterval) clearInterval(BI.liveTickInterval)
    BI.liveTickInterval = setInterval(() => {
      BI.liveSecondsAgo++
      const el = document.getElementById('bi-live-counter')
      if (el) el.textContent = BI.liveSecondsAgo + 's ago'
    }, 1000)

    // Auto-refresh every 30s
    if (BI.liveInterval) clearInterval(BI.liveInterval)
    BI.liveInterval = setInterval(fetchLive, 30000)
  }

  // ── Expose globals ────────────────────────────────────────────
  window.biSetView = biSetView

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    biSetView('overview')
  })
})()
