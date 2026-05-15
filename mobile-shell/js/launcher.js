// Launcher — module-tile grid shown after login.
// Tile visibility is driven by the authenticated user's role(s):
//   • customer    → Customer + Storm Scout + D2D + Reports + CRM
//   • admin       → adds Admin Dashboard
//   • superadmin  → adds Super Admin (god-mode) tile
// Tapping a tile navigates the in-app WebView to www.roofmanager.ca/<path>.
// Because cookies were set by the login call (same origin), the user stays
// signed in across the navigation.

import { BASE } from './api.js'

const TILES = [
  { key: 'dashboard',  label: 'Dashboard',       sub: 'Overview & jobs',     path: '/customer/dashboard',       icon: '▤', roles: ['customer'] },
  { key: 'order',      label: 'New Report',      sub: 'Order a measurement', path: '/customer/order',           icon: '▢', roles: ['customer'] },
  { key: 'reports',    label: 'My Reports',      sub: 'Past measurements',   path: '/customer/reports',         icon: '□', roles: ['customer'] },
  { key: 'leads',      label: 'Leads',           sub: 'Inbox',               path: '/customer/leads',           icon: '✆',  roles: ['customer'] },
  { key: 'pipeline',   label: 'Pipeline',        sub: 'Sales CRM',           path: '/customer/pipeline',        icon: '☰',  roles: ['customer'] },
  { key: 'd2d',        label: 'D2D',             sub: 'Door-to-door',        path: '/customer/d2d',             icon: '⛳',  roles: ['customer'] },
  { key: 'invoicing',  label: 'Invoices',        sub: 'Billing',             path: '/customer/invoice-manager', icon: '¤',  roles: ['customer'] },
  { key: 'proposals',  label: 'Proposals',       sub: 'Quotes & contracts',  path: '/customer/proposal-builder',icon: '✎',  roles: ['customer'] },
  { key: 'admin',      label: 'Admin Console',   sub: 'Manage company',      path: '/admin',                    icon: '⛭',  roles: ['admin', 'superadmin'], wide: true },
  { key: 'superadmin', label: 'Super Admin',     sub: 'God mode',            path: '/super-admin/dashboard',    icon: '⚡',  roles: ['superadmin'], wide: true },
]

export function renderLauncher({ user, role, openModule, onLogout }) {
  const nameEl = document.getElementById('launcher-name')
  if (nameEl) nameEl.textContent = user && (user.first_name || user.email) ? `Hi, ${user.first_name || user.email}` : 'Welcome'

  const grid = document.getElementById('launcher-tiles')
  if (!grid) return
  grid.innerHTML = ''

  const allow = (t) => t.roles.some((r) => role === r || (role === 'superadmin' && r !== 'never'))
  for (const t of TILES) {
    if (!allow(t)) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tile' + (t.wide ? ' tile-wide' : '')
    btn.innerHTML = `
      <div class="tile-icon" aria-hidden="true">${t.icon}</div>
      <div>
        <div class="tile-label">${t.label}</div>
        <div class="tile-sub">${t.sub}</div>
      </div>`
    btn.addEventListener('click', () => openModule(BASE + t.path))
    grid.appendChild(btn)
  }

  const logoutBtn = document.getElementById('btn-logout')
  if (logoutBtn) logoutBtn.onclick = onLogout
}
