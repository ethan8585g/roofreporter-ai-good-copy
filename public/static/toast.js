/**
 * Roof Manager — Global Toast & Modal System
 * Replaces native browser alert() and confirm() with non-blocking UI components.
 *
 * Usage:
 *   window.rmToast('Saved!', 'success')           // success | error | warning | info
 *   window.rmToast('Something went wrong', 'error', 6000)
 *   window.rmConfirm('Delete this item?', 'Delete', 'Cancel').then(ok => { if (ok) doDelete() })
 *   window.rmAlert('Your session has expired.')
 *
 * All functions are globally available immediately after this script loads.
 * The toast container is auto-created on first use.
 */
;(function () {
  'use strict'

  // ── Toast Container ──────────────────────────────────────────
  function getContainer() {
    let el = document.getElementById('rm-toast-container')
    if (!el) {
      el = document.createElement('div')
      el.id = 'rm-toast-container'
      el.setAttribute('aria-live', 'polite')
      el.setAttribute('aria-atomic', 'false')
      el.style.cssText = [
        'position:fixed',
        'top:20px',
        'right:20px',
        'z-index:99999',
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'max-width:380px',
        'pointer-events:none',
      ].join(';')
      document.body.appendChild(el)
    }
    return el
  }

  // ── Icon SVGs ────────────────────────────────────────────────
  const ICONS = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;flex-shrink:0"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:   '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;flex-shrink:0"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;flex-shrink:0"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info:    '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;flex-shrink:0"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  }

  const COLORS = {
    success: { bg: '#052e16', border: '#166534', text: '#bbf7d0', icon: '#4ade80' },
    error:   { bg: '#2d0a0a', border: '#7f1d1d', text: '#fecaca', icon: '#f87171' },
    warning: { bg: '#2d1a00', border: '#78350f', text: '#fde68a', icon: '#fbbf24' },
    info:    { bg: '#0c1a2e', border: '#1e3a5f', text: '#bae6fd', icon: '#38bdf8' },
  }

  // ── rmToast ──────────────────────────────────────────────────
  window.rmToast = function (message, type, duration) {
    type = type || 'info'
    duration = duration !== undefined ? duration : (type === 'error' ? 7000 : 4000)

    const c = COLORS[type] || COLORS.info
    const icon = ICONS[type] || ICONS.info

    const toast = document.createElement('div')
    toast.setAttribute('role', 'alert')
    toast.style.cssText = [
      'display:flex',
      'align-items:flex-start',
      'gap:10px',
      'padding:12px 16px',
      'border-radius:10px',
      'border:1px solid ' + c.border,
      'background:' + c.bg,
      'color:' + c.text,
      'font-size:14px',
      'line-height:1.5',
      'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
      'pointer-events:all',
      'cursor:pointer',
      'opacity:0',
      'transform:translateX(40px)',
      'transition:opacity 0.25s ease,transform 0.25s ease',
      'max-width:380px',
      'word-break:break-word',
    ].join(';')

    const iconEl = document.createElement('span')
    iconEl.style.color = c.icon
    iconEl.style.marginTop = '1px'
    iconEl.innerHTML = icon

    const msgEl = document.createElement('span')
    msgEl.style.flex = '1'
    msgEl.textContent = message

    const closeEl = document.createElement('button')
    closeEl.innerHTML = '&times;'
    closeEl.style.cssText = 'background:none;border:none;color:' + c.text + ';font-size:18px;line-height:1;cursor:pointer;padding:0;margin-top:-2px;opacity:0.7;flex-shrink:0'
    closeEl.setAttribute('aria-label', 'Dismiss')

    toast.appendChild(iconEl)
    toast.appendChild(msgEl)
    toast.appendChild(closeEl)

    const container = getContainer()
    container.appendChild(toast)

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = '1'
        toast.style.transform = 'translateX(0)'
      })
    })

    function dismiss() {
      toast.style.opacity = '0'
      toast.style.transform = 'translateX(40px)'
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast) }, 300)
    }

    closeEl.addEventListener('click', dismiss)
    toast.addEventListener('click', dismiss)

    if (duration > 0) {
      setTimeout(dismiss, duration)
    }

    return { dismiss }
  }

  // ── rmAlert ──────────────────────────────────────────────────
  window.rmAlert = function (message, type) {
    return new Promise(function (resolve) {
      type = type || 'info'
      const overlay = _createOverlay()
      const c = COLORS[type] || COLORS.info
      const isLight = document.body.classList.contains('light-theme')

      const box = document.createElement('div')
      box.style.cssText = [
        isLight ? 'background:#ffffff' : 'background:#1a1a1a',
        'border:1px solid ' + (isLight ? '#dde3e9' : c.border),
        'border-radius:16px',
        'padding:32px',
        'max-width:420px',
        'width:90%',
        'text-align:center',
        'box-shadow:0 20px 60px rgba(0,0,0,0.15)',
      ].join(';')

      const iconEl = document.createElement('div')
      iconEl.style.cssText = 'display:flex;justify-content:center;margin-bottom:16px;color:' + c.icon
      iconEl.innerHTML = ICONS[type] || ICONS.info

      const msgEl = document.createElement('p')
      msgEl.style.cssText = 'color:' + (isLight ? '#28373E' : '#e5e7eb') + ';font-size:15px;line-height:1.6;margin:0 0 24px'
      msgEl.textContent = message

      const btn = document.createElement('button')
      btn.textContent = 'OK'
      btn.style.cssText = 'background:' + c.icon + ';color:#000;border:none;border-radius:8px;padding:10px 32px;font-size:14px;font-weight:600;cursor:pointer'
      btn.addEventListener('click', function () {
        document.body.removeChild(overlay)
        resolve(true)
      })

      box.appendChild(iconEl)
      box.appendChild(msgEl)
      box.appendChild(btn)
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      btn.focus()
    })
  }

  // ── rmConfirm ────────────────────────────────────────────────
  window.rmConfirm = function (message, confirmLabel, cancelLabel, type) {
    return new Promise(function (resolve) {
      confirmLabel = confirmLabel || 'Confirm'
      cancelLabel = cancelLabel || 'Cancel'
      type = type || 'warning'
      const c = COLORS[type] || COLORS.warning
      const isLight = document.body.classList.contains('light-theme')

      const overlay = _createOverlay()

      const box = document.createElement('div')
      box.style.cssText = [
        isLight ? 'background:#ffffff' : 'background:#1a1a1a',
        'border:1px solid ' + (isLight ? '#dde3e9' : c.border),
        'border-radius:16px',
        'padding:32px',
        'max-width:420px',
        'width:90%',
        'text-align:center',
        'box-shadow:0 20px 60px rgba(0,0,0,0.15)',
      ].join(';')

      const iconEl = document.createElement('div')
      iconEl.style.cssText = 'display:flex;justify-content:center;margin-bottom:16px;color:' + c.icon
      iconEl.innerHTML = ICONS[type] || ICONS.warning

      const msgEl = document.createElement('p')
      msgEl.style.cssText = 'color:' + (isLight ? '#28373E' : '#e5e7eb') + ';font-size:15px;line-height:1.6;margin:0 0 24px'
      msgEl.textContent = message

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center'

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = cancelLabel
      cancelBtn.style.cssText = 'background:' + (isLight ? '#e5e7eb' : '#374151') + ';color:' + (isLight ? '#374151' : '#e5e7eb') + ';border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer'
      cancelBtn.addEventListener('click', function () {
        document.body.removeChild(overlay)
        resolve(false)
      })

      const confirmBtn = document.createElement('button')
      confirmBtn.textContent = confirmLabel
      confirmBtn.style.cssText = 'background:' + c.icon + ';color:#000;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer'
      confirmBtn.addEventListener('click', function () {
        document.body.removeChild(overlay)
        resolve(true)
      })

      btnRow.appendChild(cancelBtn)
      btnRow.appendChild(confirmBtn)
      box.appendChild(iconEl)
      box.appendChild(msgEl)
      box.appendChild(btnRow)
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      confirmBtn.focus()

      // Allow Escape key to cancel
      function onKey(e) {
        if (e.key === 'Escape') {
          document.body.removeChild(overlay)
          document.removeEventListener('keydown', onKey)
          resolve(false)
        }
      }
      document.addEventListener('keydown', onKey)
    })
  }

  function _createOverlay() {
    const overlay = document.createElement('div')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.7)',
      'z-index:100000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'backdrop-filter:blur(4px)',
    ].join(';')
    return overlay
  }

  // ── Polyfill: override native alert/confirm on pages that load this script ──
  // This ensures any legacy calls are automatically upgraded.
  // Only override if the page explicitly opts in via data-rm-override-alerts attribute on <html>
  if (document.documentElement.getAttribute('data-rm-override-alerts') === 'true') {
    window.alert = function (msg) { window.rmToast(String(msg || ''), 'info') }
    window.confirm = function (msg) {
      // Synchronous confirm() cannot be replaced with async — log a warning
      console.warn('[RoofManager] Synchronous confirm() called. Migrate to window.rmConfirm() for proper async UX.', msg)
      return true // Default to true to avoid breaking flows
    }
  }
})()
