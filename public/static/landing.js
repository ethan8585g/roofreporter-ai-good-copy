// ============================================================
// Roof Manager - Premium Landing Page v10 (SSR + Interactivity)
// Content is server-side rendered. This file adds interactive
// behaviors: scroll animations, sticky CTA, exit intent, ROI
// calculator, FAQ toggle, counter animations, and analytics.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('landing-root');
  if (!root) return;

  // Content is now SSR'd - only attach interactive behaviors

  // Sticky CTA bar
  injectStickyCTABar();

  // Exit-intent popup
  injectExitIntentPopup();

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Animate elements on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.scroll-animate').forEach(el => observer.observe(el));

  // Counter animation for stats
  document.querySelectorAll('[data-count]').forEach(el => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(el);
          obs.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    obs.observe(el);
  });

  // Initialize ROI calculator defaults
  if (document.getElementById('roi-estimates')) {
    calcROI();
  }

  // Track page view
  rrTrack('landing_page_view');
});

// ============================================================
// ANALYTICS TRACKING — Funnel events
// ============================================================
function rrTrack(event, data = {}) {
  try {
    // GA4 event
    if (typeof gtag === 'function') {
      gtag('event', event, { ...data, event_category: 'landing' });
    }
    // Internal tracking
    fetch('/api/agents/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...data, ts: Date.now(), url: location.href })
    }).catch(() => {});
  } catch(e) {}
}

function animateCounter(el) {
  const target = parseInt(el.getAttribute('data-count'));
  const suffix = el.getAttribute('data-suffix') || '';
  const prefix = el.getAttribute('data-prefix') || '';
  const duration = 2000;
  const start = performance.now();

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * target);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// Hero quick signup form handler
window.heroQuickSignup = function(e) {
  e.preventDefault();
  const email = document.getElementById('hero-email').value.trim();
  const company = document.getElementById('hero-company').value.trim();
  const msg = document.getElementById('hero-form-msg');
  if (!email) return;
  rrTrack('hero_form_submit', { email_domain: email.split('@')[1] });
  // Redirect to signup with pre-filled email
  const params = new URLSearchParams({ email });
  if (company) params.set('company', company);
  window.location.href = '/signup?' + params.toString();
  return false;
};

// FAQ toggle
window.toggleFAQ = function(btn) {
  const answer = btn.nextElementSibling;
  const icon = btn.querySelector('.faq-icon');
  const isOpen = !answer.classList.contains('hidden');

  document.querySelectorAll('.faq-answer').forEach(a => a.classList.add('hidden'));
  document.querySelectorAll('.faq-icon').forEach(i => i.style.transform = '');

  if (!isOpen) {
    answer.classList.remove('hidden');
    icon.style.transform = 'rotate(180deg)';
  }
};

// ROI Calculator logic
window.calcROI = function() {
  const est = parseFloat(document.getElementById('roi-estimates').value);
  const hrs = parseFloat(document.getElementById('roi-hours').value);
  const labor = parseFloat(document.getElementById('roi-labor').value);

  document.getElementById('roi-est-val').textContent = est;
  document.getElementById('roi-hrs-val').textContent = hrs + 'h';
  document.getElementById('roi-labor-val').textContent = '$' + labor;

  const monthlyEst = est * 4.33;
  const timeSaved = monthlyEst * (hrs - 0.02); // 60s vs hours
  const costSaved = timeSaved * labor;
  const rrCost = monthlyEst * 7; // $7 per report
  const net = costSaved - rrCost;
  const roi = rrCost > 0 ? Math.round((net / rrCost) * 100) : 0;

  document.getElementById('roi-time').textContent = Math.round(timeSaved) + ' hours';
  document.getElementById('roi-savings').textContent = '$' + Math.round(costSaved).toLocaleString();
  document.getElementById('roi-cost').textContent = '$' + Math.round(rrCost).toLocaleString() + '/mo';
  document.getElementById('roi-net').textContent = '$' + Math.round(net).toLocaleString();
  document.getElementById('roi-roi').textContent = roi.toLocaleString() + '% ROI';
};

// ============================================================
// STICKY CTA BAR — Appears on scroll
// ============================================================
function injectStickyCTABar() {
  const bar = document.createElement('div');
  bar.id = 'sticky-cta-bar';
  bar.className = 'fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0A]/97 backdrop-blur-xl border-t border-white/10 shadow-2xl transform translate-y-full transition-transform duration-500';
  bar.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
      <div class="hidden sm:flex items-center gap-3">
        <div class="flex items-center gap-0.5">
          <i class="fas fa-star text-[#00FF88] text-xs"></i><i class="fas fa-star text-[#00FF88] text-xs"></i><i class="fas fa-star text-[#00FF88] text-xs"></i><i class="fas fa-star text-[#00FF88] text-xs"></i><i class="fas fa-star text-[#00FF88] text-xs"></i>
        </div>
        <span class="text-white text-sm font-medium">Trusted by 5,000+ Canadian Roofers</span>
      </div>
      <div class="flex items-center gap-3 flex-1 sm:flex-none justify-end">
        <span class="text-gray-400 text-sm hidden md:inline">Get 4 Free Reports &mdash; No CC Required</span>
        <a href="/signup" onclick="rrTrack('cta_click',{location:'sticky_bar'})" class="bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-2.5 px-6 rounded-lg text-sm shadow-lg transition-all hover:scale-105 whitespace-nowrap min-h-[44px] flex items-center gap-2">
          <i class="fas fa-rocket"></i> Start Free
        </a>
        <button onclick="document.getElementById('sticky-cta-bar').style.transform='translateY(100%)'" class="text-gray-500 hover:text-white p-1 transition-colors"><i class="fas fa-times text-xs"></i></button>
      </div>
    </div>
  `;
  document.body.appendChild(bar);

  // Show bar after scrolling past hero
  let shown = false;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 800 && !shown) {
      bar.style.transform = 'translateY(0)';
      shown = true;
    }
  });
}

// ============================================================
// EXIT-INTENT POPUP — Demo / lead capture
// ============================================================
function injectExitIntentPopup() {
  const popup = document.createElement('div');
  popup.id = 'exit-popup';
  popup.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-black/60 backdrop-blur-sm';
  popup.innerHTML = `
    <div class="bg-[#111111] rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden transform scale-95 opacity-0 transition-all duration-300 border border-white/10" id="exit-popup-inner">
      <div class="bg-gradient-to-r from-[#00FF88]/20 to-[#00FF88]/10 p-6 text-white text-center border-b border-white/10">
        <h3 class="text-2xl font-black mb-2">Wait! Don't Leave Empty-Handed</h3>
        <p class="text-gray-400 text-sm">Get 4 free professional roof measurement reports &mdash; no credit card required.</p>
      </div>
      <div class="p-6">
        <div class="space-y-4 mb-6">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-[#00FF88]/10 rounded-full flex items-center justify-center flex-shrink-0"><i class="fas fa-file-alt text-[#00FF88] text-xs"></i></div>
            <span class="text-sm text-gray-300"><strong class="text-white">4 Free Reports</strong> &mdash; professional PDF with 3D area, BOM, solar data</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-[#00FF88]/10 rounded-full flex items-center justify-center flex-shrink-0"><i class="fas fa-th-large text-[#00FF88] text-xs"></i></div>
            <span class="text-sm text-gray-300"><strong class="text-white">Full CRM Access</strong> &mdash; customers, invoices, proposals, jobs</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-[#00FF88]/10 rounded-full flex items-center justify-center flex-shrink-0"><i class="fas fa-phone-alt text-[#00FF88] text-xs"></i></div>
            <span class="text-sm text-gray-300"><strong class="text-white">AI Secretary Trial</strong> &mdash; never miss a lead again</span>
          </div>
        </div>
        <form onsubmit="return exitPopupSubmit(event)" class="space-y-3">
          <input type="email" id="exit-email" required placeholder="Enter your email" class="w-full px-4 py-3 border border-white/10 bg-white/5 rounded-xl focus:ring-2 focus:ring-[#00FF88] focus:border-[#00FF88] text-sm text-white placeholder-gray-500">
          <button type="submit" class="w-full bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-3 rounded-xl shadow-lg transition-all hover:scale-[1.02] min-h-[48px] text-sm">
            <i class="fas fa-gift mr-2"></i>Claim My 4 Free Reports
          </button>
        </form>
        <button onclick="closeExitPopup()" class="w-full mt-3 text-gray-500 hover:text-gray-300 text-xs text-center py-2 transition-colors">No thanks, I'll pass on free reports</button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Click outside to close
  popup.addEventListener('click', (e) => {
    if (e.target === popup) closeExitPopup();
  });

  // Exit intent detection (desktop: mouse leaving viewport, mobile: scroll up fast)
  let exitShown = false;
  document.addEventListener('mouseout', (e) => {
    if (exitShown) return;
    if (e.clientY < 10 && !e.relatedTarget && !e.toElement) {
      showExitPopup();
    }
  });

  // Also show after 60s on page if not interacted with signup
  setTimeout(() => {
    if (!exitShown && !localStorage.getItem('rr_exit_dismissed')) {
      showExitPopup();
    }
  }, 60000);
}

window.showExitPopup = function() {
  if (localStorage.getItem('rr_exit_dismissed')) return;
  const popup = document.getElementById('exit-popup');
  const inner = document.getElementById('exit-popup-inner');
  popup.classList.remove('hidden');
  popup.classList.add('flex');
  setTimeout(() => {
    inner.style.transform = 'scale(1)';
    inner.style.opacity = '1';
  }, 10);
  rrTrack('exit_popup_shown');
};

window.closeExitPopup = function() {
  const popup = document.getElementById('exit-popup');
  const inner = document.getElementById('exit-popup-inner');
  inner.style.transform = 'scale(0.95)';
  inner.style.opacity = '0';
  setTimeout(() => {
    popup.classList.add('hidden');
    popup.classList.remove('flex');
  }, 300);
  localStorage.setItem('rr_exit_dismissed', '1');
};

window.exitPopupSubmit = function(e) {
  e.preventDefault();
  const email = document.getElementById('exit-email').value.trim();
  if (!email) return false;
  rrTrack('exit_popup_submit', { email_domain: email.split('@')[1] });
  window.location.href = '/signup?email=' + encodeURIComponent(email);
  return false;
};
