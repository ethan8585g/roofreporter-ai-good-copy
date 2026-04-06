// ============================================================
// Roof Manager - Premium Landing Page v10
// Full Strategic Redesign: Hero urgency, Lead Funnel, Social Proof,
// Feature-to-Benefit, ROI Calculator, Sticky CTA, Case Studies,
// Industry Sections, Security, Mobile-First, Exit Intent, Analytics
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('landing-root');
  if (!root) return;

  root.innerHTML = `
    ${renderHero()}
    ${renderTrustBadges()}
    ${renderStatsBar()}
    ${renderSocialProofLogos()}
    ${renderValueProp()}
    ${renderHowItWorks()}
    ${renderCoverageMap()}
    ${renderPlatformShowcase()}
    ${renderFeatureGrid()}
    ${renderCaseStudies()}
    ${renderIndustrySections()}
    ${renderPricing()}
    ${renderROICalculator()}
    ${renderTestimonials()}
    ${renderSecuritySection()}
    ${renderIntegrations()}
    ${renderFAQ()}
    ${renderFinalCTA()}
    ${renderFooterCrossLinks()}
  `;

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

// ============================================================
// ANNOUNCEMENT BAR — Urgency + social proof
// ============================================================
// Announcement bar removed — it was blocking the nav menu on scroll

// ============================================================
// HERO — Cinematic dark split-screen with 3D roof preview
// ============================================================
function renderHero() {
  return `
    <section class="relative min-h-screen flex items-center overflow-hidden" style="background:#0A0A0A">
      <!-- Subtle grid overlay -->
      <div class="absolute inset-0 opacity-[0.04]" style="background-image: linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px); background-size: 60px 60px;"></div>
      <!-- Radial glow behind content -->
      <div class="absolute top-1/3 left-1/4 w-[800px] h-[800px] rounded-full opacity-10" style="background: radial-gradient(circle, #00FF88 0%, transparent 70%);"></div>
      <div class="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full opacity-5" style="background: radial-gradient(circle, #22d3ee 0%, transparent 70%);"></div>

      <div class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-32 pb-24 lg:pt-40 lg:pb-32">
        <div class="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
          <!-- Left: Value Proposition -->
          <div>
            <!-- Trust badge -->
            <div class="inline-flex items-center gap-2.5 bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-5 py-2.5 mb-8 backdrop-blur-sm">
              <span class="relative flex h-2.5 w-2.5">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00FF88] opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00FF88]"></span>
              </span>
              <span class="text-sm font-semibold text-[#00FF88] tracking-wide">Trusted by 5,000+ Canadian Roofers</span>
            </div>

            <h1 class="text-5xl sm:text-6xl lg:text-7xl font-black leading-[1.05] text-white mb-8 tracking-tight">
              Stop Guessing.<br/>
              <span class="neon-text">Start Quoting</span><br/>
              <span class="neon-text">With Certainty.</span>
            </h1>

            <p class="text-lg lg:text-xl text-gray-400 mb-10 max-w-xl leading-relaxed">
              AI-powered roof measurements from satellite imagery. <span class="text-white font-medium">99% accuracy</span> in under <span class="text-white font-medium">60 seconds.</span>
            </p>

            <!-- Dual CTAs -->
            <div class="flex flex-col sm:flex-row gap-4 mb-10">
              <a href="/signup" onclick="rrTrack('cta_click',{location:'hero_primary',variant:'neon'})" class="group inline-flex items-center justify-center gap-3 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-4 px-10 rounded-xl text-lg shadow-2xl shadow-[#00FF88]/20 transition-all duration-300 hover:scale-[1.03] min-h-[56px]">
                <i class="fas fa-rocket"></i>
                Start 3 Free Reports
                <i class="fas fa-arrow-right text-sm group-hover:translate-x-1.5 transition-transform"></i>
              </a>
              <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" onclick="rrTrack('cta_click',{location:'hero_demo'})" class="inline-flex items-center justify-center gap-2.5 bg-white/5 hover:bg-white/10 backdrop-blur-md text-white font-bold py-4 px-8 rounded-xl text-lg border border-white/10 hover:border-white/20 transition-all duration-300 min-h-[56px]">
                <i class="fas fa-calendar-check text-[#00FF88]"></i>
                Book a Demo
              </a>
            </div>

            <!-- Social proof row -->
            <div class="flex items-center gap-4 mb-4">
              <div class="flex items-center gap-0.5">
                ${[1,2,3,4,5].map(n => `<i class="fas fa-star text-[#00FF88] text-sm"></i>`).join('')}
              </div>
              <span class="text-sm text-gray-500"><strong class="text-white font-semibold">4.9/5</strong> from 200+ reviews</span>
            </div>

            <!-- Quick proof pills -->
            <div class="flex flex-wrap items-center gap-3 text-sm">
              <span class="inline-flex items-center gap-1.5 text-gray-400 bg-white/5 rounded-full px-3 py-1.5">
                <i class="fas fa-check text-[#00FF88] text-[10px]"></i>No credit card required
              </span>
              <span class="inline-flex items-center gap-1.5 text-gray-400 bg-white/5 rounded-full px-3 py-1.5">
                <i class="fas fa-check text-[#00FF88] text-[10px]"></i>Reports in under 60s
              </span>
              <span class="inline-flex items-center gap-1.5 text-gray-400 bg-white/5 rounded-full px-3 py-1.5">
                <i class="fas fa-check text-[#00FF88] text-[10px]"></i>Full CRM included free
              </span>
            </div>

            <!-- Mobile-only CTA -->
            <div class="lg:hidden mt-10 flex flex-col gap-3">
              <a href="/signup" onclick="rrTrack('cta_click',{location:'hero_mobile'})" class="flex items-center justify-center gap-3 bg-[#00FF88] text-[#0A0A0A] font-extrabold py-4 px-8 rounded-xl text-lg shadow-2xl shadow-[#00FF88]/20 min-h-[56px]">
                <i class="fas fa-rocket"></i>
                Get 3 Free Reports
                <i class="fas fa-arrow-right text-sm"></i>
              </a>
            </div>
          </div>

          <!-- Right: Book a Demo Calendar Card -->
          <div class="hidden lg:block">
            <div class="relative">
              <div class="bg-[#111111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 neon-glow">
                <!-- Card header -->
                <div class="bg-[#0d1117] px-6 py-5 border-b border-white/5 text-center">
                  <div class="inline-flex items-center gap-2 bg-[#00FF88]/15 text-[#00FF88] rounded-full px-4 py-1.5 text-xs font-bold mb-4">
                    <i class="fas fa-calendar-check"></i> Book a Live Demo
                  </div>
                  <h3 class="text-white font-extrabold text-2xl mb-2">See Roof Manager in Action</h3>
                  <p class="text-gray-400 text-sm">15-minute walkthrough. We'll measure YOUR roof live on the call.</p>
                </div>

                <!-- What you'll see -->
                <div class="px-6 py-5 space-y-3">
                  <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-lg bg-[#00FF88]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i class="fas fa-satellite text-[#00FF88] text-xs"></i>
                    </div>
                    <div>
                      <div class="text-white text-sm font-semibold">Live Roof Measurement</div>
                      <div class="text-gray-500 text-xs">We'll measure any address you choose — in under 60 seconds</div>
                    </div>
                  </div>
                  <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-lg bg-[#22d3ee]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i class="fas fa-th-large text-[#22d3ee] text-xs"></i>
                    </div>
                    <div>
                      <div class="text-white text-sm font-semibold">Full CRM Walkthrough</div>
                      <div class="text-gray-500 text-xs">Invoicing, proposals, job tracking, AI secretary</div>
                    </div>
                  </div>
                  <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-lg bg-[#a78bfa]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i class="fas fa-gift text-[#a78bfa] text-xs"></i>
                    </div>
                    <div>
                      <div class="text-white text-sm font-semibold">3 Free Reports After Demo</div>
                      <div class="text-gray-500 text-xs">No credit card required — start using immediately</div>
                    </div>
                  </div>
                </div>

                <!-- CTA Button -->
                <div class="px-6 pb-6">
                  <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" onclick="rrTrack('cta_click',{location:'hero_calendar_card'})" class="flex items-center justify-center gap-3 w-full bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-4 rounded-xl text-base shadow-xl shadow-[#00FF88]/20 transition-all duration-300 hover:scale-[1.02]">
                    <i class="fas fa-calendar-check"></i>
                    Book Your Free Demo
                    <i class="fas fa-arrow-right text-sm"></i>
                  </a>
                  <div class="flex items-center justify-center gap-4 mt-4 text-[11px] text-gray-500">
                    <span><i class="fas fa-clock mr-1 text-[#00FF88]"></i>15 minutes</span>
                    <span><i class="fas fa-video mr-1 text-[#22d3ee]"></i>Google Meet</span>
                    <span><i class="fas fa-globe mr-1 text-[#a78bfa]"></i>Any timezone</span>
                  </div>
                </div>

                <!-- Social proof strip -->
                <div class="px-6 py-3 bg-[#080c10] border-t border-white/5 flex items-center justify-center gap-3">
                  <div class="flex items-center gap-0.5">
                    ${[1,2,3,4,5].map(() => '<i class="fas fa-star text-[#00FF88] text-[10px]"></i>').join('')}
                  </div>
                  <span class="text-[11px] text-gray-500">Rated <strong class="text-white">4.9/5</strong> by 200+ contractors</span>
                </div>
              </div>

              <!-- Floating badges -->
              <div class="absolute -bottom-4 -left-4 bg-[#111111] border border-white/10 rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-[#00FF88]/10 flex items-center justify-center">
                  <i class="fas fa-chart-line text-[#00FF88] text-sm"></i>
                </div>
                <div>
                  <div class="text-white font-bold text-sm" data-count="9989" data-suffix="+" id="hero-counter">0+</div>
                  <div class="text-[10px] text-gray-500">reports generated</div>
                </div>
              </div>

              <div class="absolute -top-3 -right-3 bg-[#111111] border border-white/10 rounded-xl px-3 py-2 shadow-xl flex items-center gap-2">
                <div class="w-6 h-6 rounded-lg bg-[#22d3ee]/10 flex items-center justify-center">
                  <i class="fas fa-bolt text-[#22d3ee] text-xs"></i>
                </div>
                <span class="text-white font-bold text-xs">&lt;60s delivery</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll indicator -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <div class="w-6 h-10 border-2 border-white/10 rounded-full flex justify-center pt-2">
          <div class="w-1 h-3 bg-[#00FF88]/40 rounded-full animate-bounce"></div>
        </div>
      </div>
    </section>
  `;
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

// ============================================================
// TRUST BAR — Scrolling marquee with logos + stats
// ============================================================
function renderTrustBadges() {
  const items = [
    { icon: 'fas fa-shield-alt', text: 'PCI DSS Compliant', color: '#00FF88' },
    { icon: 'fas fa-lock', text: '256-bit SSL', color: '#22d3ee' },
    { icon: 'fab fa-google', text: 'Google Cloud Partner', color: '#00FF88' },
    { icon: 'fas fa-bullseye', text: '99% Accuracy', color: '#22d3ee' },
    { icon: 'fas fa-credit-card', text: 'Square Verified', color: '#00FF88' },
    { icon: 'fas fa-bolt', text: '<60s Delivery', color: '#22d3ee' },
    { icon: 'fas fa-cloud', text: 'Cloudflare Protected', color: '#00FF88' },
    { icon: 'fas fa-dollar-sign', text: '$8 CAD/Report', color: '#22d3ee' },
    { icon: 'fas fa-maple-leaf', text: 'Canadian Owned', color: '#00FF88' },
    { icon: 'fas fa-shield-alt', text: 'SOC 2 Compliant', color: '#22d3ee' },
  ];
  // Duplicate for seamless loop
  const track = [...items, ...items].map(it => `
    <div class="flex items-center gap-2.5 px-6 whitespace-nowrap">
      <i class="${it.icon} text-sm" style="color:${it.color}"></i>
      <span class="text-sm font-medium text-gray-400">${it.text}</span>
    </div>
  `).join('');

  return `
    <section class="border-y border-white/5 py-4 overflow-hidden" style="background:#0A0A0A">
      <div class="flex marquee-track" style="width: max-content;">
        ${track}
      </div>
    </section>
  `;
}

// ============================================================
// STATS BAR — Dark animated counters with neon glow
// ============================================================
function renderStatsBar() {
  const stats = [
    { value: 10000, suffix: '+', label: 'Reports Generated', icon: 'fas fa-file-alt' },
    { value: 98, suffix: '%', label: 'Measurement Accuracy', icon: 'fas fa-bullseye' },
    { value: 60, suffix: 's', label: 'Average Delivery', prefix: '<', icon: 'fas fa-bolt' },
    { value: 8, suffix: '', label: 'Per Report (CAD)', prefix: '$', icon: 'fas fa-dollar-sign' },
  ];

  return `
    <section class="relative z-20 py-6" style="background:#0A0A0A">
      <div class="max-w-6xl mx-auto px-4">
        <div class="bg-[#111111] rounded-2xl border border-white/10 grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/5">
          ${stats.map((s, i) => `
            <div class="p-6 lg:p-8 text-center group transition-colors duration-300 ${i === 0 ? 'rounded-l-2xl' : ''} ${i === 3 ? 'rounded-r-2xl' : ''}">
              <div class="w-10 h-10 mx-auto mb-3 rounded-xl bg-[#00FF88]/10 flex items-center justify-center group-hover:bg-[#00FF88]/20 transition-colors">
                <i class="${s.icon} text-[#00FF88] text-sm"></i>
              </div>
              <div class="text-3xl lg:text-4xl font-black mb-1 stat-value" data-count="${s.value}" data-suffix="${s.suffix || ''}" data-prefix="${s.prefix || ''}">${s.prefix || ''}0${s.suffix || ''}</div>
              <div class="text-[11px] text-gray-500 font-semibold uppercase tracking-widest">${s.label}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// SOCIAL PROOF — Animated city badges
// ============================================================
function renderSocialProofLogos() {
  const cities = [
    'Calgary', 'Toronto', 'Vancouver', 'Dallas', 'Houston', 'Miami', 'New York', 'Chicago', 'Atlanta', 'Denver',
    'London', 'Paris', 'Berlin', 'Madrid', 'Amsterdam', 'Stockholm', 'Dublin', 'Rome', 'Vienna', 'Zurich',
    'Sydney', 'Melbourne', 'Tokyo', 'Auckland',
    'São Paulo', 'Bogotá', 'Lima',
    'Lagos', 'Nairobi', 'Cape Town'
  ];

  return `
    <section class="py-12" style="background:#0A0A0A">
      <div class="max-w-7xl mx-auto px-4">
        <p class="text-center text-sm text-gray-500 font-semibold mb-6">Trusted by roofing contractors in <strong class="text-white">40+ cities</strong> worldwide across every continent</p>
        <div class="flex flex-wrap items-center justify-center gap-3">
          ${cities.map(c => `
            <div class="flex items-center gap-2 bg-white/5 hover:bg-[#00FF88]/10 border border-white/5 hover:border-[#00FF88]/20 rounded-full px-4 py-2 transition-all duration-300 group cursor-default">
              <i class="fas fa-map-marker-alt text-[10px] text-gray-600 group-hover:text-[#00FF88] transition-colors"></i>
              <span class="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">${c}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// VALUE PILLARS — Three interactive dark cards
// ============================================================
function renderValueProp() {
  const pillars = [
    {
      icon: 'fas fa-satellite-dish',
      accent: '#00FF88',
      title: 'Quote With 99% Confidence',
      desc: "No more guesswork. Google's Solar API with LiDAR-calibrated 3D models delivers precision measurements from satellite imagery. Quote every job knowing your numbers are right.",
      metric: '99%',
      metricLabel: 'Accuracy Rate',
      cta: 'See Accuracy Data',
      ctaLink: '#pricing'
    },
    {
      icon: 'fas fa-brain',
      accent: '#22d3ee',
      title: 'Save 2+ Hours Per Estimate',
      desc: 'Stop climbing roofs with a tape measure. Our AI calculates pitch-adjusted areas, identifies every edge, and generates a full material BOM instantly. Quote from your truck.',
      metric: '2h+',
      metricLabel: 'Saved Per Job',
      cta: 'Try Free Report',
      ctaLink: '/signup'
    },
    {
      icon: 'fas fa-users-cog',
      accent: '#a78bfa',
      title: 'AI Admin That Never Sleeps',
      desc: 'AI Secretary answers calls 24/7, books appointments, qualifies leads. Full CRM, invoicing, D2D manager, virtual try-on. Run your whole business from one platform.',
      metric: '24/7',
      metricLabel: 'Always Online',
      cta: 'Explore Platform',
      ctaLink: '#features'
    }
  ];

  return `
    <section class="py-28" style="background:#0A0A0A">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-20 scroll-animate">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-5 py-2 text-sm font-semibold mb-6">
            <i class="fas fa-sparkles"></i> Why 5,000+ Roofers Choose Us
          </div>
          <h2 class="text-4xl lg:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
            Stop Guessing.<br/>
            <span class="neon-text">Start Quoting With Certainty.</span>
          </h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">Every minute on a ladder is a minute you could spend closing deals. Roof Manager handles the measurement so you can focus on revenue.</p>
        </div>

        <div class="grid lg:grid-cols-3 gap-6">
          ${pillars.map((p, i) => `
            <div class="scroll-animate" style="transition-delay: ${i * 150}ms">
              <div class="card-hover relative overflow-hidden rounded-2xl bg-[#111111] border border-white/10 hover:border-[${p.accent}]/30 h-full flex flex-col p-8 group">
                <!-- Subtle gradient glow on hover -->
                <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style="background: radial-gradient(circle at 50% 0%, ${p.accent}08 0%, transparent 70%);"></div>

                <div class="relative z-10 flex-1 flex flex-col">
                  <!-- Icon + Metric row -->
                  <div class="flex items-start justify-between mb-6">
                    <div class="w-14 h-14 rounded-2xl flex items-center justify-center" style="background: ${p.accent}15;">
                      <i class="${p.icon} text-xl" style="color: ${p.accent}"></i>
                    </div>
                    <div class="text-right">
                      <div class="text-2xl font-black" style="color: ${p.accent}">${p.metric}</div>
                      <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">${p.metricLabel}</div>
                    </div>
                  </div>

                  <h3 class="text-xl font-bold text-white mb-3">${p.title}</h3>
                  <p class="text-gray-400 text-sm leading-relaxed mb-6 flex-1">${p.desc}</p>

                  <a href="${p.ctaLink}" onclick="rrTrack('cta_click',{location:'value_prop',card:'${p.title}'})" class="inline-flex items-center gap-2 font-semibold text-sm group/link transition-colors" style="color: ${p.accent}">
                    ${p.cta} <i class="fas fa-arrow-right text-xs group-hover/link:translate-x-1 transition-transform"></i>
                  </a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// HOW IT WORKS — Dark horizontal timeline with animations
// ============================================================
function renderHowItWorks() {
  const steps = [
    { num: 1, icon: 'fas fa-search-location', title: 'Enter the Address', desc: 'Search any address. Google Maps pinpoints the exact roof instantly.', accent: '#00FF88' },
    { num: 2, icon: 'fas fa-sliders-h', title: 'Configure Details', desc: 'Add homeowner info, company details, and delivery options. Takes 30 seconds.', accent: '#22d3ee' },
    { num: 3, icon: 'fas fa-credit-card', title: 'Order Instantly', desc: 'First 3 reports are FREE. Then just $8 CAD per report. Instant checkout.', accent: '#a78bfa' },
    { num: 4, icon: 'fas fa-file-pdf', title: 'Get Your PDF', desc: 'Professional report with area, pitch, edges, BOM, solar data. Under 60 seconds.', accent: '#00FF88' },
  ];

  return `
    <section id="how-it-works" class="py-28 relative overflow-hidden" style="background: linear-gradient(180deg, #0d0d0d 0%, #0A0A0A 100%);">
      <script type="application/ld+json">
{"@context":"https://schema.org","@type":"HowTo","name":"How to Get a Roof Measurement Report","description":"Get a professional AI-powered roof measurement report from satellite imagery in 4 simple steps","step":[{"@type":"HowToStep","position":1,"name":"Enter the Address","text":"Search any address worldwide. Google Maps pinpoints the exact roof instantly."},{"@type":"HowToStep","position":2,"name":"Configure Details","text":"Add homeowner info, company details, and delivery options. Takes 30 seconds."},{"@type":"HowToStep","position":3,"name":"Order Instantly","text":"First 3 reports are FREE. Then just $8 CAD per report. Instant checkout."},{"@type":"HowToStep","position":4,"name":"Get Your PDF","text":"Professional report with area, pitch, edges, BOM, solar data. Delivered in under 60 seconds."}],"totalTime":"PT1M","tool":{"@type":"HowToTool","name":"Roof Manager"},"supply":{"@type":"HowToSupply","name":"Property address"}}
</script>
      <!-- Subtle radial glow -->
      <div class="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] opacity-5" style="background: radial-gradient(ellipse, #00FF88 0%, transparent 70%);"></div>

      <div class="max-w-7xl mx-auto px-4 relative z-10">
        <div class="text-center mb-20 scroll-animate">
          <div class="inline-flex items-center gap-2 bg-[#22d3ee]/10 text-[#22d3ee] rounded-full px-5 py-2 text-sm font-semibold mb-6">
            <i class="fas fa-route"></i> Simple Process
          </div>
          <h2 class="text-4xl lg:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
            Address to Report<br/>
            <span class="neon-text">in 4 Steps</span>
          </h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">No ladders. No drones. No tape measures. Just enter an address.</p>
        </div>

        <div class="grid md:grid-cols-4 gap-6 relative">
          <!-- Connecting line -->
          <div class="hidden md:block absolute top-8 left-[calc(12.5%+28px)] right-[calc(12.5%+28px)] h-px">
            <div class="w-full h-full" style="background: linear-gradient(90deg, #00FF88, #22d3ee, #a78bfa, #00FF88); opacity: 0.3;"></div>
            <div class="absolute inset-0 h-full" style="background: linear-gradient(90deg, #00FF88, #22d3ee, #a78bfa, #00FF88); opacity: 0.6; background-size: 200% 100%; animation: shimmer 3s linear infinite;"></div>
          </div>

          ${steps.map((s, i) => `
            <div class="scroll-animate relative" style="transition-delay: ${i * 150}ms">
              <div class="relative z-10 flex justify-center">
                <div class="w-16 h-16 bg-[#111111] rounded-2xl flex items-center justify-center mb-6 border border-white/10 shadow-lg" style="box-shadow: 0 0 20px ${s.accent}15;">
                  <i class="${s.icon} text-xl" style="color: ${s.accent}"></i>
                </div>
              </div>
              <div class="text-center">
                <div class="text-[11px] font-bold uppercase tracking-widest mb-2" style="color: ${s.accent}">Step ${s.num}</div>
                <h3 class="text-lg font-bold text-white mb-2">${s.title}</h3>
                <p class="text-sm text-gray-500 leading-relaxed">${s.desc}</p>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Report Preview — Satellite Roof Measurement Visualization -->
        <div class="mt-20 scroll-animate">
          <div class="text-center mb-8">
            <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold">
              <i class="fas fa-file-pdf"></i> What You Get
            </div>
          </div>
          <div class="max-w-4xl mx-auto bg-[#111111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 neon-glow">
            <!-- Report header bar -->
            <div class="bg-[#0d1117] text-white px-6 py-3.5 flex items-center justify-between border-b border-white/5">
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-1.5">
                  <div class="w-3 h-3 rounded-full bg-red-500/80"></div>
                  <div class="w-3 h-3 rounded-full bg-amber-500/80"></div>
                  <div class="w-3 h-3 rounded-full bg-green-500/80"></div>
                </div>
                <div class="ml-3">
                  <div class="font-bold text-sm">Roof Measurement Report</div>
                  <div class="text-[11px] text-gray-500">123 Main Street, Calgary, AB T2P 1J9</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-[10px] text-[#00FF88] bg-[#00FF88]/10 px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse"></span>HIGH QUALITY</span>
                <span class="text-[10px] bg-[#00FF88] text-[#0A0A0A] px-2.5 py-1 rounded font-bold">PDF</span>
              </div>
            </div>

            <!-- Satellite roof visualization SVG -->
            <div class="relative" style="background: linear-gradient(135deg, #0a1628 0%, #0d1f1a 50%, #0a1628 100%);">
              <svg viewBox="0 0 800 420" class="w-full" xmlns="http://www.w3.org/2000/svg">
                <!-- Satellite texture overlay -->
                <defs>
                  <linearGradient id="roofGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#1a3a2a;stop-opacity:0.9"/>
                    <stop offset="100%" style="stop-color:#0f2318;stop-opacity:0.9"/>
                  </linearGradient>
                  <linearGradient id="roofGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#1e3d2f;stop-opacity:0.85"/>
                    <stop offset="100%" style="stop-color:#152e22;stop-opacity:0.85"/>
                  </linearGradient>
                  <linearGradient id="roofGrad3" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#243f32;stop-opacity:0.8"/>
                    <stop offset="100%" style="stop-color:#1a3325;stop-opacity:0.8"/>
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>

                <!-- "Satellite" ground texture -->
                <rect width="800" height="420" fill="#0c1a12" opacity="0.5"/>
                <!-- Faux lawn/ground areas -->
                <rect x="40" y="320" width="720" height="80" rx="4" fill="#0a1f10" opacity="0.3"/>
                <rect x="580" y="180" width="180" height="220" rx="4" fill="#0e2214" opacity="0.2"/>
                <rect x="40" y="60" width="160" height="200" rx="4" fill="#0e2214" opacity="0.2"/>

                <!-- ROOF SEGMENTS — color-coded polygons -->
                <!-- Main front face -->
                <polygon points="250,100 530,100 530,240 250,240" fill="url(#roofGrad1)" stroke="#00FF88" stroke-width="2" opacity="0.9"/>
                <!-- Left wing -->
                <polygon points="140,160 250,100 250,280 140,280" fill="url(#roofGrad2)" stroke="#00FF88" stroke-width="2" opacity="0.85"/>
                <!-- Right wing -->
                <polygon points="530,100 620,160 620,280 530,240" fill="url(#roofGrad3)" stroke="#22d3ee" stroke-width="2" opacity="0.85"/>
                <!-- Garage section -->
                <polygon points="530,240 620,280 620,350 530,350" fill="url(#roofGrad2)" stroke="#a78bfa" stroke-width="2" opacity="0.8"/>
                <!-- Upper dormer -->
                <polygon points="320,60 460,60 460,100 320,100" fill="url(#roofGrad1)" stroke="#22d3ee" stroke-width="2" opacity="0.9"/>
                <!-- Back section -->
                <polygon points="250,240 530,240 530,350 250,350" fill="url(#roofGrad3)" stroke="#00FF88" stroke-width="1.5" opacity="0.75"/>

                <!-- Ridge lines (dashed) -->
                <line x1="250" y1="100" x2="530" y2="100" stroke="#00FF88" stroke-width="2.5" stroke-dasharray="8 4" filter="url(#glow)">
                  <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="2s" repeatCount="indefinite"/>
                </line>
                <line x1="250" y1="240" x2="530" y2="240" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.7">
                  <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="2.5s" repeatCount="indefinite"/>
                </line>
                <!-- Hip lines -->
                <line x1="250" y1="100" x2="140" y2="160" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>
                <line x1="530" y1="100" x2="620" y2="160" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>

                <!-- MEASUREMENT LABELS -->
                <!-- Ridge measurement -->
                <rect x="330" y="72" width="120" height="24" rx="6" fill="rgba(0,255,136,0.15)" stroke="#00FF88" stroke-width="0.8"/>
                <text x="390" y="88" fill="#00FF88" font-size="12" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">85.2 ft ridge</text>

                <!-- Front face area -->
                <rect x="335" y="158" width="110" height="28" rx="8" fill="rgba(0,255,136,0.12)" stroke="#00FF88" stroke-width="0.5"/>
                <text x="390" y="170" fill="#00FF88" font-size="10" text-anchor="middle" font-family="'Inter',monospace" font-weight="600">Face A</text>
                <text x="390" y="182" fill="#00FF88" font-size="11" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">1,247 sq ft</text>

                <!-- Left wing label -->
                <rect x="148" y="205" width="90" height="28" rx="8" fill="rgba(0,255,136,0.1)" stroke="#00FF88" stroke-width="0.5"/>
                <text x="193" y="217" fill="#00FF88" font-size="10" text-anchor="middle" font-family="'Inter',monospace" font-weight="600">Face B</text>
                <text x="193" y="229" fill="#00FF88" font-size="11" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">486 sq ft</text>

                <!-- Right wing label -->
                <rect x="542" y="205" width="68" height="28" rx="8" fill="rgba(34,211,238,0.1)" stroke="#22d3ee" stroke-width="0.5"/>
                <text x="576" y="217" fill="#22d3ee" font-size="10" text-anchor="middle" font-family="'Inter',monospace" font-weight="600">Face C</text>
                <text x="576" y="229" fill="#22d3ee" font-size="11" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">412 sq ft</text>

                <!-- Pitch label -->
                <rect x="640" y="130" width="110" height="24" rx="6" fill="rgba(167,139,250,0.15)" stroke="#a78bfa" stroke-width="0.8"/>
                <text x="695" y="146" fill="#a78bfa" font-size="12" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">6/12 pitch</text>

                <!-- Eave measurement -->
                <rect x="160" y="290" width="100" height="22" rx="6" fill="rgba(34,211,238,0.1)" stroke="#22d3ee" stroke-width="0.5"/>
                <text x="210" y="305" fill="#22d3ee" font-size="11" text-anchor="middle" font-family="'Inter',monospace" font-weight="600">62.4 ft eave</text>

                <!-- Garage label -->
                <rect x="542" y="305" width="68" height="28" rx="8" fill="rgba(167,139,250,0.1)" stroke="#a78bfa" stroke-width="0.5"/>
                <text x="576" y="317" fill="#a78bfa" font-size="10" text-anchor="middle" font-family="'Inter',monospace" font-weight="600">Garage</text>
                <text x="576" y="329" fill="#a78bfa" font-size="11" text-anchor="middle" font-family="'Inter',monospace" font-weight="700">320 sq ft</text>

                <!-- Animated measurement points -->
                <circle cx="250" cy="100" r="5" fill="#00FF88" opacity="0.9"><animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite"/></circle>
                <circle cx="530" cy="100" r="5" fill="#00FF88" opacity="0.9"><animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite" begin="0.3s"/></circle>
                <circle cx="140" cy="160" r="4" fill="#a78bfa" opacity="0.8"><animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" begin="0.6s"/></circle>
                <circle cx="620" cy="160" r="4" fill="#22d3ee" opacity="0.8"><animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" begin="0.9s"/></circle>
                <circle cx="320" cy="60" r="3" fill="#22d3ee" opacity="0.7"/>
                <circle cx="460" cy="60" r="3" fill="#22d3ee" opacity="0.7"/>
                <circle cx="250" cy="350" r="3" fill="#00FF88" opacity="0.5"/>
                <circle cx="530" cy="350" r="3" fill="#00FF88" opacity="0.5"/>
                <circle cx="620" cy="350" r="3" fill="#a78bfa" opacity="0.5"/>

                <!-- Compass -->
                <circle cx="720" cy="60" r="22" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
                <text x="720" y="48" fill="#00FF88" font-size="10" text-anchor="middle" font-family="'Inter',sans-serif" font-weight="700">N</text>
                <line x1="720" y1="52" x2="720" y2="68" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
                <polygon points="720,42 717,50 723,50" fill="#00FF88" opacity="0.8"/>

                <!-- Scale bar -->
                <line x1="60" y1="390" x2="160" y2="390" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
                <line x1="60" y1="386" x2="60" y2="394" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
                <line x1="160" y1="386" x2="160" y2="394" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
                <text x="110" y="405" fill="rgba(255,255,255,0.35)" font-size="10" text-anchor="middle" font-family="'Inter',monospace">50 ft</text>
              </svg>
            </div>

            <!-- Data summary bar -->
            <div class="grid grid-cols-4 divide-x divide-white/5 border-t border-white/5 bg-[#0d1117]">
              <div class="p-4 text-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">Total Area</div>
                <div class="text-lg font-black text-[#00FF88]">2,847 ft&sup2;</div>
              </div>
              <div class="p-4 text-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">Pitch</div>
                <div class="text-lg font-black text-[#22d3ee]">6/12</div>
              </div>
              <div class="p-4 text-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">Edges</div>
                <div class="text-lg font-black text-[#a78bfa]">342 ft</div>
              </div>
              <div class="p-4 text-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">Segments</div>
                <div class="text-lg font-black text-white">8 faces</div>
              </div>
            </div>

            <!-- BOM strip -->
            <div class="px-6 py-3 flex flex-wrap items-center gap-4 text-[11px] text-gray-500 bg-[#0a0e13] border-t border-white/5">
              <span class="font-bold text-gray-400"><i class="fas fa-th mr-1 text-[#00FF88]"></i>Materials:</span>
              <span>29 bundles shingles</span>
              <span class="text-white/15">&middot;</span>
              <span>4 rolls underlayment</span>
              <span class="text-white/15">&middot;</span>
              <span>115 ft drip edge</span>
              <span class="text-white/15">&middot;</span>
              <span>89 ft ridge cap</span>
              <span class="text-white/15">&middot;</span>
              <span>12 lbs nails</span>
            </div>
          </div>
        </div>

        <div class="text-center mt-16 scroll-animate">
          <a href="/signup" onclick="rrTrack('cta_click',{location:'how_it_works'})" class="group inline-flex items-center gap-3 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-4 px-10 rounded-xl text-lg shadow-2xl shadow-[#00FF88]/20 transition-all duration-300 hover:scale-[1.02] min-h-[56px]">
            <i class="fas fa-rocket"></i>
            Start Free &mdash; 3 Reports Included
            <i class="fas fa-arrow-right text-sm group-hover:translate-x-1 transition-transform"></i>
          </a>
          <p class="text-xs text-gray-500 mt-4">No credit card required. Setup in 2 minutes.</p>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// COVERAGE MAP — 40+ Countries with SEO geo keywords
// ============================================================
function renderCoverageMap() {
  const regions = [
    {
      name: 'North America & Caribbean',
      accent: '#00FF88',
      icon: 'fas fa-globe-americas',
      countries: [
        { name: 'United States', flag: '🇺🇸', note: 'Covers over 95% of all buildings' },
        { name: 'Canada', flag: '🇨🇦', note: '' },
        { name: 'Mexico', flag: '🇲🇽', note: '' },
        { name: 'Puerto Rico', flag: '🇵🇷', note: '' },
        { name: 'The Bahamas', flag: '🇧🇸', note: '' },
        { name: 'Antigua and Barbuda', flag: '🇦🇬', note: '' },
      ]
    },
    {
      name: 'Europe',
      accent: '#22d3ee',
      icon: 'fas fa-globe-europe',
      countries: [
        { name: 'United Kingdom', flag: '🇬🇧', note: '' },
        { name: 'France', flag: '🇫🇷', note: '' },
        { name: 'Germany', flag: '🇩🇪', note: '' },
        { name: 'Spain', flag: '🇪🇸', note: '' },
        { name: 'Italy', flag: '🇮🇹', note: '' },
        { name: 'Portugal', flag: '🇵🇹', note: '' },
        { name: 'Netherlands', flag: '🇳🇱', note: '' },
        { name: 'Belgium', flag: '🇧🇪', note: '' },
        { name: 'Austria', flag: '🇦🇹', note: '' },
        { name: 'Switzerland', flag: '🇨🇭', note: '' },
        { name: 'Denmark', flag: '🇩🇰', note: '' },
        { name: 'Sweden', flag: '🇸🇪', note: '' },
        { name: 'Norway', flag: '🇳🇴', note: '' },
        { name: 'Finland', flag: '🇫🇮', note: '' },
        { name: 'Ireland', flag: '🇮🇪', note: '' },
        { name: 'Poland', flag: '🇵🇱', note: '' },
        { name: 'Czechia', flag: '🇨🇿', note: '' },
        { name: 'Greece', flag: '🇬🇷', note: '' },
      ]
    },
    {
      name: 'Asia-Pacific',
      accent: '#a78bfa',
      icon: 'fas fa-globe-asia',
      countries: [
        { name: 'Australia', flag: '🇦🇺', note: '' },
        { name: 'Japan', flag: '🇯🇵', note: '' },
        { name: 'New Zealand', flag: '🇳🇿', note: '' },
        { name: 'Indonesia', flag: '🇮🇩', note: '' },
        { name: 'Malaysia', flag: '🇲🇾', note: '' },
        { name: 'Philippines', flag: '🇵🇭', note: '' },
        { name: 'Taiwan', flag: '🇹🇼', note: '' },
        { name: 'Thailand', flag: '🇹🇭', note: '' },
      ]
    },
    {
      name: 'South America',
      accent: '#f59e0b',
      icon: 'fas fa-globe-americas',
      countries: [
        { name: 'Brazil', flag: '🇧🇷', note: '' },
        { name: 'Colombia', flag: '🇨🇴', note: '' },
        { name: 'Peru', flag: '🇵🇪', note: '' },
      ]
    }
  ];

  return `
    <section id="coverage" class="py-28 relative overflow-hidden" style="background:#0d0d0d" aria-label="Roof Manager global coverage map">
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.03]" style="background: radial-gradient(circle, #00FF88 0%, transparent 70%);"></div>

      <div class="max-w-7xl mx-auto px-4 relative z-10">
        <div class="text-center mb-16 scroll-animate">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-5 py-2 text-sm font-semibold mb-6">
            <i class="fas fa-globe"></i> Global Coverage
          </div>
          <h2 class="text-4xl lg:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
            Available in <span class="neon-text">40+ Countries</span><br/>Worldwide
          </h2>
          <p class="text-lg text-gray-400 max-w-3xl mx-auto leading-relaxed">Satellite-powered roof measurement reports wherever Google Solar API coverage exists. From North America to Europe, Asia-Pacific, and South America — measure any roof from anywhere.</p>
        </div>

        <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          ${regions.map((r, i) => `
            <div class="scroll-animate" style="transition-delay: ${i * 100}ms">
              <div class="card-hover bg-[#111111] border border-white/10 rounded-2xl p-6 h-full hover:border-[${r.accent}]/30 group">
                <div class="flex items-center gap-3 mb-5">
                  <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: ${r.accent}15;">
                    <i class="${r.icon}" style="color: ${r.accent}"></i>
                  </div>
                  <div>
                    <h3 class="text-white font-bold text-sm">${r.name}</h3>
                    <span class="text-[11px] font-semibold" style="color: ${r.accent}">${r.countries.length} ${r.countries.length === 1 ? 'country' : 'countries'}</span>
                  </div>
                </div>
                <ul class="space-y-2">
                  ${r.countries.map(c => `
                    <li class="flex items-center gap-2.5 text-sm">
                      <span class="text-base leading-none">${c.flag}</span>
                      <span class="text-gray-300 font-medium" data-geo-country="${c.name}">${c.name}</span>
                      ${c.note ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style="background: ${r.accent}15; color: ${r.accent}">${c.note}</span>` : ''}
                    </li>
                  `).join('')}
                </ul>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- SEO text block with geo keywords -->
        <div class="scroll-animate max-w-4xl mx-auto text-center mb-12">
          <p class="text-sm text-gray-500 leading-relaxed">Roof Manager provides AI-powered satellite roof measurement reports for roofing contractors, estimators, insurance adjusters, and solar installers across the United States, Canada, United Kingdom, Australia, Germany, France, Japan, Brazil, and 30+ additional countries. Our reports include 3D roof area, pitch analysis, edge breakdowns, material estimates, and solar potential — delivered in under 60 seconds from satellite imagery.</p>
        </div>

        <div class="text-center scroll-animate">
          <a href="/signup" onclick="rrTrack('cta_click',{location:'coverage_map'})" class="group inline-flex items-center gap-3 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-4 px-10 rounded-xl text-lg shadow-2xl shadow-[#00FF88]/20 transition-all duration-300 hover:scale-[1.02] min-h-[56px]">
            <i class="fas fa-globe"></i>
            Start Free — Works in Your Country
            <i class="fas fa-arrow-right text-sm group-hover:translate-x-1 transition-transform"></i>
          </a>
          <p class="text-xs text-gray-500 mt-4">3 free reports. No credit card required. Available worldwide.</p>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// PLATFORM SHOWCASE — Feature-to-Benefit with CTAs
// ============================================================
function renderPlatformShowcase() {
  const modules = [
    {
      title: 'Never Climb a Roof Again',
      subtitle: 'Instant Measurement Reports',
      desc: 'Professional PDF reports with 3D area, pitch analysis, edge breakdowns, material BOM, and solar potential &mdash; all from satellite imagery in under 60 seconds. Stop risking safety, start quoting faster.',
      benefit: 'Save 2+ hours and $200+ per estimate vs. manual measurement',
      cta: 'Get Your First Report Free',
      ctaLink: '/signup',
      img: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=85&auto=format&fit=crop&t=20260405',
      reverse: false
    },
    {
      title: 'Your AI Secretary That Never Sleeps',
      subtitle: 'AI Roofer Secretary',
      desc: 'Never miss a lead again. Our AI answers your business phone 24/7 in a natural human voice &mdash; books appointments, qualifies leads by asking your custom screening questions, and sends you detailed call summaries with transcripts. Handles after-hours calls, storm season overflow, and lunch breaks. Your customers will never know it\'s AI.',
      benefit: 'Capture 40% more leads that would otherwise go to voicemail',
      cta: 'See AI Secretary Demo',
      ctaLink: '/signup',
      img: 'https://images.unsplash.com/photo-1556741533-6e6a62bd8b49?w=800&q=80&auto=format&fit=crop&t=20260405',
      reverse: true
    },
    {
      title: '3D Models, Not Guesses',
      subtitle: 'Full CRM & Business Management',
      desc: 'Manage customers, create invoices, send proposals, track jobs, and manage your D2D sales team. Quote with 99% confidence using satellite 3D models. Everything integrated in one platform built for roofers.',
      benefit: 'Close 23% more deals with accurate, professional quotes',
      cta: 'Explore CRM Features',
      ctaLink: '/signup',
      img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80&auto=format&fit=crop&t=20260405',
      reverse: false
    },
    {
      title: 'Show Homeowners Their New Roof Before They Buy',
      subtitle: 'Virtual Roof Try-On',
      desc: 'AI-powered visualization that lets homeowners see exactly what their roof will look like with different materials and colors. Remove uncertainty, close more deals, and upsell premium materials.',
      benefit: 'Increase average ticket size by 15% with visual selling',
      cta: 'See Virtual Try-On',
      ctaLink: '/signup',
      img: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=85&auto=format&fit=crop&t=20260405',
      reverse: true
    },
    {
      title: 'Your Own Professional Website in 5 Minutes',
      subtitle: 'AI Website Builder',
      desc: 'Our AI builds you a complete 5-page contractor website &mdash; Home, Services, About, Service Areas, and Contact &mdash; with custom copy written for YOUR business, YOUR services, and YOUR city. Built-in lead capture forms sync directly to your CRM. No design skills needed.',
      benefit: 'Get a professional online presence that generates leads 24/7',
      cta: 'Build My Website',
      ctaLink: '/customer/website-builder',
      img: 'https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=800&q=85&auto=format&fit=crop&t=20260405',
      reverse: false
    }
  ];

  return `
    <section id="features" class="py-24" style="background:#0A0A0A">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-20 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-th-large"></i> Complete Platform
          </div>
          <h2 class="text-3xl lg:text-5xl font-black text-white mb-4 tracking-tight">
            Everything a Roofing<br/>Business Needs
          </h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">From measurement to close. One platform for reports, CRM, AI phone answering, sales management, and more.</p>
        </div>

        <div class="space-y-24">
          ${modules.map((m, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 grid lg:grid-cols-2 gap-12 lg:gap-20 items-center" style="transition-delay: ${i * 100}ms">
              <div class="${m.reverse ? 'lg:order-2' : ''}">
                <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-3 py-1 text-xs font-bold mb-3">
                  ${m.subtitle}
                </div>
                <h3 class="text-2xl lg:text-3xl font-bold text-white mb-4 leading-tight">${m.title}</h3>
                <p class="text-gray-400 text-base leading-relaxed mb-4">${m.desc}</p>
                <div class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-xl p-3 mb-6 flex items-start gap-2">
                  <i class="fas fa-chart-line text-[#00FF88] mt-0.5"></i>
                  <span class="text-sm text-[#00FF88] font-medium">${m.benefit}</span>
                </div>
                <a href="${m.ctaLink}" onclick="rrTrack('cta_click',{location:'feature_card',card:'${m.subtitle}'})" class="inline-flex items-center gap-2 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-3 px-6 rounded-xl text-sm shadow-lg transition-all hover:scale-[1.02] min-h-[48px]">
                  <i class="fas fa-arrow-right text-xs"></i> ${m.cta}
                </a>
              </div>
              <div class="${m.reverse ? 'lg:order-1' : ''}">
                <div class="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/30 ring-1 ring-white/10">
                  <img src="${m.img}" alt="${m.title}" class="w-full h-[320px] object-cover" loading="lazy" />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// FEATURE GRID — What's in your report (with CTAs)
// ============================================================
function renderFeatureGrid() {
  const features = [
    { icon: 'fas fa-ruler-combined', title: 'True 3D Area', desc: 'Pitch-adjusted surface area, not just footprint. Order materials with confidence.', benefit: 'Eliminate waste from inaccurate measurements' },
    { icon: 'fas fa-draw-polygon', title: 'Edge Breakdown', desc: 'Ridge, hip, valley, eave, and rake &mdash; measured in plan and true 3D length.', benefit: 'Quote flashing and trim with precision' },
    { icon: 'fas fa-boxes-stacked', title: 'Material BOM', desc: 'Shingles, underlayment, ice shield, flashing, nails &mdash; complete with Alberta pricing.', benefit: 'Supplier orders are dead accurate' },
    { icon: 'fas fa-layer-group', title: 'Segment Analysis', desc: 'Each roof plane individually measured with pitch, azimuth, and direction.', benefit: 'Complex roofs broken down simply' },
    { icon: 'fas fa-solar-panel', title: 'Solar Potential', desc: 'Panel count, yearly energy, and sunshine hours &mdash; included free on every report.', benefit: 'Upsell solar to every customer' },
    { icon: 'fas fa-chart-line', title: 'Complexity Rating', desc: 'Automatic complexity scoring and waste factor calculation for accurate quoting.', benefit: 'Never underbid a complex job again' },
  ];

  return `
    <section class="py-24" style="background:#0d0d0d">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-file-alt"></i> Report Contents
          </div>
          <h2 class="text-3xl lg:text-5xl font-black text-white mb-4 tracking-tight">What's In Every Report</h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">Professional-grade data that roofing contractors actually need to quote jobs accurately.</p>
        </div>

        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          ${features.map((f, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 group" style="transition-delay: ${i * 80}ms">
              <div class="h-full bg-[#111111] rounded-2xl p-7 border border-white/10 hover:border-[#00FF88]/30 hover:shadow-xl hover:shadow-[#00FF88]/5 transition-all duration-300 flex flex-col">
                <div class="w-12 h-12 bg-[#00FF88]/10 group-hover:bg-[#00FF88] rounded-xl flex items-center justify-center mb-4 transition-all duration-300">
                  <i class="${f.icon} text-[#00FF88] group-hover:text-[#0A0A0A] text-lg transition-colors duration-300"></i>
                </div>
                <h3 class="text-lg font-bold text-white mb-2">${f.title}</h3>
                <p class="text-sm text-gray-400 leading-relaxed mb-3">${f.desc}</p>
                <div class="mt-auto pt-3 border-t border-white/10">
                  <span class="text-xs font-semibold text-[#00FF88] flex items-center gap-1.5"><i class="fas fa-check-circle text-[#00FF88]"></i>${f.benefit}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="text-center mt-12 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <a href="/signup" onclick="rrTrack('cta_click',{location:'feature_grid'})" class="inline-flex items-center gap-2 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-3.5 px-8 rounded-xl shadow-lg transition-all hover:scale-[1.02] min-h-[48px]">
            <i class="fas fa-gift"></i> Get 3 Free Reports Now
          </a>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// CASE STUDIES — ROI proof
// ============================================================
function renderCaseStudies() {
  const cases = [
    {
      company: 'Prairie Roofing Co.',
      location: 'Edmonton, AB',
      avatar: 'PR',
      color: 'from-cyan-500 to-blue-500',
      stats: [
        { label: 'Annual Savings', value: '$6,400/yr', icon: 'fas fa-piggy-bank' },
        { label: 'Close Rate Increase', value: '+23%', icon: 'fas fa-chart-line' },
        { label: 'Estimates/Week', value: '15-20', icon: 'fas fa-file-alt' },
      ],
      quote: 'We went from 6 estimates a week to 15-20 because we stopped climbing every roof. Our close rate jumped 23% because professional reports build instant trust.',
      before: '6 estimates/week, 2 hrs each on-site',
      after: '15-20 estimates/week, reports in 60 seconds'
    },
    {
      company: 'Atlas Exteriors',
      location: 'Calgary, AB',
      avatar: 'AE',
      color: 'from-emerald-500 to-teal-500',
      stats: [
        { label: 'Time Saved', value: '32 hrs/mo', icon: 'fas fa-clock' },
        { label: 'Material Accuracy', value: '99%', icon: 'fas fa-bullseye' },
        { label: 'Revenue Growth', value: '+41%', icon: 'fas fa-dollar-sign' },
      ],
      quote: 'The material BOM alone paid for the service 10x over. Zero waste on supplier orders. We quote more jobs, win more jobs, and our margins are better than ever.',
      before: 'Manual measurements, frequent reorders',
      after: 'Satellite precision, zero-waste orders'
    }
  ];

  return `
    <section class="py-24" style="background:#0A0A0A">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-trophy"></i> Real Results
          </div>
          <h2 class="text-3xl lg:text-5xl font-black text-white mb-4 tracking-tight">Case Studies</h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">See how Canadian roofing companies are saving thousands and growing faster with Roof Manager.</p>
        </div>

        <div class="grid lg:grid-cols-2 gap-8">
          ${cases.map((cs, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 bg-[#111111] rounded-2xl border border-white/10 overflow-hidden hover:shadow-xl hover:border-[#00FF88]/30 transition-shadow" style="transition-delay: ${i * 150}ms">
              <div class="p-8">
                <div class="flex items-center gap-4 mb-6">
                  <div class="w-14 h-14 bg-gradient-to-br ${cs.color} rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-lg">${cs.avatar}</div>
                  <div>
                    <h3 class="text-xl font-bold text-white">${cs.company}</h3>
                    <p class="text-sm text-gray-500">${cs.location}</p>
                  </div>
                </div>

                <div class="grid grid-cols-3 gap-4 mb-6">
                  ${cs.stats.map(s => `
                    <div class="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                      <i class="${s.icon} text-[#00FF88] text-sm mb-1"></i>
                      <div class="text-lg font-black text-white">${s.value}</div>
                      <div class="text-[10px] text-gray-500 uppercase tracking-wider font-medium">${s.label}</div>
                    </div>
                  `).join('')}
                </div>

                <blockquote class="text-sm text-gray-400 leading-relaxed italic mb-6 border-l-4 border-[#00FF88]/40 pl-4">"${cs.quote}"</blockquote>

                <div class="grid grid-cols-2 gap-4">
                  <div class="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <div class="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">Before</div>
                    <p class="text-xs text-red-400">${cs.before}</p>
                  </div>
                  <div class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-xl p-3">
                    <div class="text-[10px] font-bold text-[#00FF88] uppercase tracking-wider mb-1">After</div>
                    <p class="text-xs text-[#00FF88]">${cs.after}</p>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// INDUSTRY SECTIONS — Residential, Insurance, Solar
// ============================================================
function renderIndustrySections() {
  const industries = [
    {
      icon: 'fas fa-home',
      title: 'Residential Roofing',
      color: 'from-blue-500 to-indigo-500',
      desc: 'Quote every residential job in 60 seconds. Accurate BOM, professional reports that impress homeowners, and a CRM to manage your pipeline.',
      features: ['3D area & pitch analysis', 'Material BOM with pricing', 'Virtual try-on for upsells', 'Homeowner-ready PDF reports']
    },
    {
      icon: 'fas fa-file-contract',
      title: 'Insurance & Adjusters',
      color: 'from-emerald-500 to-teal-500',
      desc: 'Deliver detailed measurement reports for insurance claims. Independent verification with satellite data that adjusters trust.',
      features: ['Independent satellite verification', 'Detailed edge & segment data', 'Complexity scoring', 'Exportable measurement data']
    },
    {
      icon: 'fas fa-solar-panel',
      title: 'Solar Installers',
      color: 'from-teal-500 to-emerald-500',
      desc: 'Every roof report includes solar potential analysis &mdash; panel count, yearly energy, sunshine hours. Identify solar-ready roofs and upsell installations.',
      features: ['Solar potential on every report', 'Panel count & energy estimates', 'Roof azimuth & tilt data', 'Sunshine hours analysis']
    }
  ];

  return `
    <section class="py-24" style="background:#0d0d0d">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-industry"></i> Built for Your Business
          </div>
          <h2 class="text-3xl lg:text-5xl font-black text-white mb-4 tracking-tight">Solutions by Industry</h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">Whether you're a residential roofer, insurance adjuster, or solar installer &mdash; we have the tools you need.</p>
        </div>

        <div class="grid lg:grid-cols-3 gap-8">
          ${industries.map((ind, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700" style="transition-delay: ${i * 150}ms">
              <div class="h-full bg-[#111111] rounded-2xl border border-white/10 p-8 hover:border-[#00FF88]/30 hover:shadow-xl transition-all flex flex-col">
                <div class="w-14 h-14 bg-gradient-to-br ${ind.color} rounded-2xl flex items-center justify-center mb-5 shadow-lg">
                  <i class="${ind.icon} text-white text-xl"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-3">${ind.title}</h3>
                <p class="text-sm text-gray-400 leading-relaxed mb-5">${ind.desc}</p>
                <ul class="space-y-2.5 mb-6 flex-1">
                  ${ind.features.map(f => `
                    <li class="flex items-center gap-2.5 text-sm text-gray-400"><i class="fas fa-check-circle text-[#00FF88] text-xs"></i>${f}</li>
                  `).join('')}
                </ul>
                <a href="/signup" onclick="rrTrack('cta_click',{location:'industry',type:'${ind.title}'})" class="inline-flex items-center justify-center gap-2 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-3 rounded-xl text-sm transition-all hover:scale-[1.02] min-h-[48px]">
                  Get Started Free <i class="fas fa-arrow-right text-xs"></i>
                </a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// PRICING — Comparison table + B2B highlight
// ============================================================
function renderPricing() {
  return `
    <section id="pricing" class="py-24" style="background:#0A0A0A">
      <div class="max-w-6xl mx-auto px-4">
        <div class="text-center mb-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-tag"></i> Simple Pricing
          </div>
          <h2 class="text-3xl lg:text-5xl font-black text-white mb-4 tracking-tight">Plans That Scale With You</h2>
          <p class="text-lg text-gray-400 max-w-2xl mx-auto">Start free, pay per report, or save big with volume packs. CRM always included.</p>
        </div>

        <!-- Pricing cards -->
        <div class="grid lg:grid-cols-3 gap-6 items-start mb-16">
          <!-- Free Trial -->
          <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 bg-[#111111] rounded-2xl border border-white/10 p-8 hover:shadow-xl transition-shadow">
            <div class="text-sm font-bold text-[#00FF88] uppercase tracking-wider mb-2">Free Trial</div>
            <div class="flex items-baseline gap-1 mb-2">
              <span class="text-5xl font-black text-white">$0</span>
            </div>
            <p class="text-sm text-gray-400 mb-6">3 free reports + full platform access</p>
            <ul class="space-y-3 mb-8">
              ${['3 professional PDF reports', 'Full CRM & invoicing', 'Customer management', 'Proposals & job tracking', 'Door-to-door manager', 'Virtual roof try-on', 'Team collaboration'].map(f => `
                <li class="flex items-start gap-2.5 text-sm text-gray-400"><i class="fas fa-check text-[#00FF88] mt-0.5 text-xs"></i>${f}</li>
              `).join('')}
            </ul>
            <a href="/signup" onclick="rrTrack('cta_click',{location:'pricing',plan:'free'})" class="block text-center py-3.5 rounded-xl font-bold border-2 border-white/20 text-white hover:bg-white hover:text-[#0A0A0A] transition-all min-h-[48px]">
              Start Free Trial
            </a>
          </div>

          <!-- Per Report — MOST POPULAR -->
          <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 relative" style="transition-delay:100ms">
            <div class="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#00FF88] text-[#0A0A0A] text-xs font-extrabold px-5 py-1.5 rounded-full shadow-lg z-10">MOST POPULAR</div>
            <div class="bg-[#111111] rounded-2xl border-2 border-[#00FF88]/50 shadow-xl shadow-[#00FF88]/10 p-8">
              <div class="text-sm font-bold text-[#00FF88] uppercase tracking-wider mb-2">Per Report</div>
              <div class="flex items-baseline gap-1 mb-2">
                <span class="text-5xl font-black text-white">$8</span>
                <span class="text-xl text-gray-500">CAD</span>
                <span class="text-sm text-gray-500 ml-1">/ report</span>
              </div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm text-gray-500 line-through">$50–100 EagleView</span>
                <span class="text-xs font-bold text-[#00FF88] bg-[#00FF88]/10 px-2 py-0.5 rounded-full">Save 90%+</span>
              </div>
              <p class="text-xs text-[#00FF88] font-semibold mb-6"><i class="fas fa-gift mr-1"></i>First 3 reports FREE</p>
              <ul class="space-y-3 mb-8">
                ${['Full 3D area with pitch adjustment', 'Complete edge breakdown', 'Material BOM with pricing', 'Individual segment analysis', 'Solar potential analysis', 'Professional PDF download', 'Email delivery included', 'AI measurement overlay', 'Instant delivery (<60s)'].map(f => `
                  <li class="flex items-start gap-2.5 text-sm text-gray-400"><i class="fas fa-check text-[#00FF88] mt-0.5 text-xs"></i>${f}</li>
                `).join('')}
              </ul>
              <a href="/signup" onclick="rrTrack('cta_click',{location:'pricing',plan:'per_report'})" class="block text-center py-3.5 rounded-xl font-extrabold bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] shadow-lg transition-all hover:scale-[1.02] min-h-[48px]">
                Get Started Free
              </a>
            </div>
          </div>

          <!-- B2B Volume -->
          <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 relative" style="transition-delay:200ms">
            <div class="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] text-white text-xs font-bold px-5 py-1.5 rounded-full shadow-lg z-10">BEST VALUE</div>
            <div class="bg-[#111111] rounded-2xl border-2 border-[#a78bfa]/50 p-8">
              <div class="text-sm font-bold text-[#a78bfa] uppercase tracking-wider mb-2">B2B Volume</div>
              <div class="flex items-baseline gap-1 mb-2">
                <span class="text-5xl font-black text-white">$7</span>
                <span class="text-xl text-gray-500">CAD</span>
                <span class="text-sm text-gray-500 ml-1">/ report</span>
              </div>
              <p class="text-sm text-gray-400 mb-1">For teams doing 50+ reports/month</p>
              <p class="text-xs text-[#a78bfa] font-semibold mb-6"><i class="fas fa-percentage mr-1"></i>Save up to 40% with volume packs</p>
              <ul class="space-y-3 mb-8">
                ${['Everything in Per Report', 'Volume discount pricing', 'Priority processing', 'Dedicated account manager', 'Monthly invoicing option', 'API access (coming soon)', 'Custom report branding', 'Phone + email support', 'Team analytics dashboard'].map(f => `
                  <li class="flex items-start gap-2.5 text-sm text-gray-400"><i class="fas fa-check text-[#a78bfa] mt-0.5 text-xs"></i>${f}</li>
                `).join('')}
              </ul>
              <a href="mailto:reports@reusecanada.ca?subject=B2B%20Volume%20Pricing" onclick="rrTrack('cta_click',{location:'pricing',plan:'b2b'})" class="block text-center py-3.5 rounded-xl font-bold bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] hover:from-[#b39dff] hover:to-[#a78bfa] text-white shadow-lg transition-all hover:scale-[1.02] min-h-[48px]">
                Contact for Volume Pricing
              </a>
            </div>
          </div>
        </div>

        <!-- Add-ons -->
        <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <h3 class="text-xl font-bold text-white text-center mb-6">Add-On Services</h3>
          <div class="grid md:grid-cols-3 gap-6">
            <div class="bg-[#111111] rounded-2xl border border-[#a78bfa]/40 p-6 hover:border-[#a78bfa]/60 hover:shadow-lg hover:shadow-[#a78bfa]/5 transition-all relative overflow-hidden">
              <div class="absolute top-0 right-0 bg-gradient-to-l from-red-500 to-orange-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-lg uppercase tracking-wider">Limited Time</div>
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center"><i class="fas fa-phone-alt text-white text-sm"></i></div>
                <div class="flex-1"><h4 class="font-bold text-white text-sm">AI Roofer Secretary</h4><p class="text-xs text-gray-500">24/7 AI phone answering</p></div>
                <div class="text-right">
                  <span class="text-xs text-gray-500 line-through">$249/mo</span>
                  <div><span class="text-xl font-black text-[#00FF88]">$149</span><span class="text-xs text-gray-500">/mo</span></div>
                </div>
              </div>
              <p class="text-[11px] text-gray-400 mb-2">Answers calls in a human voice, books appointments, qualifies leads, sends summaries. Never miss a $15K roof job again.</p>
              <div class="flex items-center gap-2 text-[10px]">
                <span class="bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">Save $100/mo</span>
                <span class="text-gray-500">Lock in this rate &mdash; price increases soon</span>
              </div>
            </div>
            <div class="bg-[#111111] rounded-2xl border border-white/10 p-6 hover:border-[#00FF88]/30 hover:shadow-lg transition-all">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center"><i class="fas fa-users text-white text-sm"></i></div>
                <div class="flex-1"><h4 class="font-bold text-white text-sm">Team Members</h4><p class="text-xs text-gray-500">Add sales reps & estimators</p></div>
                <div class="text-right"><span class="text-xl font-black text-white">$50</span><span class="text-xs text-gray-500">/user/mo</span></div>
              </div>
            </div>
            <div class="bg-[#111111] rounded-2xl border border-white/10 p-6 hover:border-[#00FF88]/30 hover:shadow-lg transition-all">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center"><i class="fas fa-th-large text-white text-sm"></i></div>
                <div class="flex-1"><h4 class="font-bold text-white text-sm">CRM & Business Tools</h4><p class="text-xs text-gray-500">Full platform access</p></div>
                <div class="text-right"><span class="text-xl font-black text-[#00FF88]">FREE</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Comparison table -->
        <div class="mt-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <h3 class="text-xl font-bold text-white text-center mb-8">How We Compare</h3>
          <div class="overflow-x-auto -mx-4 px-4">
            <table class="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr class="border-b-2 border-white/10">
                  <th class="text-left py-3 px-4 font-bold text-white">Feature</th>
                  <th class="text-center py-3 px-4 font-bold text-[#00FF88] bg-[#00FF88]/10 rounded-t-lg">Roof Manager</th>
                  <th class="text-center py-3 px-4 font-bold text-gray-500">EagleView</th>
                  <th class="text-center py-3 px-4 font-bold text-gray-500">Manual / Drone</th>
                </tr>
              </thead>
              <tbody>
                ${[
                  ['Report Delivery', 'Under 60 seconds', '24-48 hours', '2-4 hours on-site'],
                  ['Price Per Report', 'From $7 USD', '$50-100+ USD', '$200+ labor cost'],
                  ['Free CRM Included', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-times-circle text-red-400"></i>', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['AI Phone Secretary', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-times-circle text-red-400"></i>', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['Virtual Roof Try-On', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-times-circle text-red-400"></i>', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['Team Management', '<i class="fas fa-check-circle text-[#00FF88]"></i>', 'Extra cost', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['Solar Analysis', '<i class="fas fa-check-circle text-[#00FF88]"></i> Free', 'Extra cost', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['D2D Sales Manager', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-times-circle text-red-400"></i>', '<i class="fas fa-times-circle text-red-400"></i>'],
                  ['No Climbing Required', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-check-circle text-[#00FF88]"></i>', '<i class="fas fa-times-circle text-red-400"></i>'],
                ].map((row, i) => `
                  <tr class="border-b border-white/5 ${i % 2 === 0 ? 'bg-[#111111]' : 'bg-white/5'}">
                    <td class="py-3 px-4 font-medium text-gray-300">${row[0]}</td>
                    <td class="py-3 px-4 text-center font-semibold text-white bg-[#00FF88]/5">${row[1]}</td>
                    <td class="py-3 px-4 text-center text-gray-500">${row[2]}</td>
                    <td class="py-3 px-4 text-center text-gray-500">${row[3]}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// ROI CALCULATOR — Interactive widget
// ============================================================
function renderROICalculator() {
  return `
    <section class="py-24 bg-gradient-to-b from-slate-900 to-slate-800 text-white relative overflow-hidden">
      <div class="absolute inset-0 opacity-[0.03]" style="background-image: radial-gradient(circle, white 1px, transparent 1px); background-size: 32px 32px;"></div>
      <div class="relative max-w-5xl mx-auto px-4">
        <div class="text-center mb-12 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-cyan-500/20 text-cyan-300 rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-calculator"></i> ROI Calculator
          </div>
          <h2 class="text-3xl lg:text-4xl font-black mb-4 tracking-tight">Calculate Your Savings</h2>
          <p class="text-gray-400 text-lg max-w-2xl mx-auto">See how much time and money Roof Manager saves your business each month.</p>
        </div>

        <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          <div class="grid md:grid-cols-2 gap-8">
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-semibold text-gray-300 mb-2">Estimates per week</label>
                <input type="range" id="roi-estimates" min="1" max="50" value="10" class="w-full accent-cyan-500" oninput="calcROI()">
                <div class="flex justify-between text-xs text-gray-500 mt-1"><span>1</span><span id="roi-est-val" class="text-cyan-400 font-bold">10</span><span>50</span></div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-300 mb-2">Hours per manual measurement</label>
                <input type="range" id="roi-hours" min="0.5" max="4" value="2" step="0.5" class="w-full accent-cyan-500" oninput="calcROI()">
                <div class="flex justify-between text-xs text-gray-500 mt-1"><span>0.5h</span><span id="roi-hrs-val" class="text-cyan-400 font-bold">2h</span><span>4h</span></div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-300 mb-2">Your hourly labor cost ($)</label>
                <input type="range" id="roi-labor" min="25" max="150" value="60" step="5" class="w-full accent-cyan-500" oninput="calcROI()">
                <div class="flex justify-between text-xs text-gray-500 mt-1"><span>$25</span><span id="roi-labor-val" class="text-cyan-400 font-bold">$60</span><span>$150</span></div>
              </div>
            </div>
            <div class="space-y-4">
              <div class="bg-white/5 rounded-xl p-5 border border-white/10">
                <div class="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Monthly Time Saved</div>
                <div id="roi-time" class="text-3xl font-black text-cyan-400">80 hours</div>
              </div>
              <div class="bg-white/5 rounded-xl p-5 border border-white/10">
                <div class="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Monthly Cost Savings</div>
                <div id="roi-savings" class="text-3xl font-black text-green-400">$4,480</div>
              </div>
              <div class="bg-white/5 rounded-xl p-5 border border-white/10">
                <div class="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Roof Manager Cost</div>
                <div id="roi-cost" class="text-3xl font-black text-teal-400">$320/mo</div>
              </div>
              <div class="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-xl p-5 border border-green-500/30">
                <div class="text-xs text-green-400 uppercase tracking-wider font-bold mb-1">Net Monthly Savings</div>
                <div id="roi-net" class="text-4xl font-black text-green-400">$4,160</div>
                <div id="roi-roi" class="text-sm text-green-300 mt-1 font-semibold">1,300% ROI</div>
              </div>
            </div>
          </div>
          <div class="text-center mt-8">
            <a href="/signup" onclick="rrTrack('cta_click',{location:'roi_calculator'})" class="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-400 hover:to-cyan-500 text-white font-bold py-3.5 px-8 rounded-xl shadow-lg transition-all hover:scale-[1.02] min-h-[48px]">
              <i class="fas fa-rocket"></i> Start Saving Today &mdash; 3 Free Reports
            </a>
          </div>
        </div>
      </div>
    </section>
  `;
}

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
// TESTIMONIALS — Expanded with metrics
// ============================================================
function renderTestimonials() {
  const testimonials = [
    {
      quote: "Saves me 2 hours per estimate. I used to climb every roof with a tape measure. Now I order a report, get the BOM, and quote the job from my truck. That's $1,500+ per month back in my pocket.",
      name: "Mike D.",
      title: "Roofing Contractor",
      company: "JPG Roofing LTD",
      location: "Calgary, AB",
      date: "March 2026",
      avatar: "MD",
      metric: "Saves $1,500+/month",
      metricIcon: 'fas fa-piggy-bank'
    },
    {
      quote: "The material BOM alone is worth it. Shingle counts, underlayment rolls, nail quantities — my supplier orders are dead accurate every time. Zero waste, zero reorders.",
      name: "Sarah K.",
      title: "Project Manager",
      company: "Summit Exteriors",
      location: "Edmonton, AB",
      date: "February 2026",
      avatar: "SK",
      metric: "99% material accuracy",
      metricIcon: 'fas fa-bullseye'
    },
    {
      quote: "We run 15-20 estimates a week. At $7 per report we save thousands vs drone surveys. Our close rate jumped 23% because professional reports build instant trust with homeowners.",
      name: "James R.",
      title: "Owner",
      company: "Apex Roofing Co.",
      location: "Vancouver, BC",
      date: "March 2026",
      avatar: "JR",
      metric: "+23% close rate",
      metricIcon: 'fas fa-chart-line'
    },
    {
      quote: "The AI Secretary alone is worth it. We were missing 30-40% of calls during storm season. Now every single call is answered, leads are qualified, and I get a summary on my phone.",
      name: "Dave P.",
      title: "Owner",
      company: "Northern Shield Roofing",
      location: "Toronto, ON",
      date: "January 2026",
      avatar: "DP",
      metric: "40% more leads captured",
      metricIcon: 'fas fa-phone-alt'
    },
    {
      quote: "Switched from EagleView and cut our measurement costs by 85%. The integrated CRM means I don't need JobNimbus or AccuLynx anymore either. One platform, everything I need.",
      name: "Chris T.",
      title: "Operations Manager",
      company: "Pinnacle Roofworks",
      location: "Dallas, TX",
      date: "March 2026",
      avatar: "CT",
      metric: "85% cost reduction",
      metricIcon: 'fas fa-arrow-down'
    },
    {
      quote: "The crew manager changed how we operate. My guys upload progress photos from the job site, I assign crews from the calendar, and the customer gets updates automatically. Game changer.",
      name: "Ryan M.",
      title: "Owner",
      company: "Keystone Roofing",
      location: "Seattle, WA",
      date: "February 2026",
      avatar: "RM",
      metric: "3x faster job tracking",
      metricIcon: 'fas fa-tachometer-alt'
    }
  ];

  return `
    <section class="py-24" style="background:#0d0d0d">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-16 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-quote-left"></i> What Roofers Say
          </div>
          <h2 class="text-3xl lg:text-4xl font-black text-white mb-4 tracking-tight">Trusted by Roofing Professionals</h2>
          <p class="text-lg text-gray-400">Real results from contractors worldwide.</p>
          <div class="flex items-center justify-center gap-2 mt-4">
            <div class="flex items-center gap-0.5">
              ${[1,2,3,4,5].map(() => '<i class="fas fa-star text-[#00FF88] text-lg"></i>').join('')}
            </div>
            <span class="text-white font-bold">4.9/5</span>
            <span class="text-gray-500">&mdash; 200+ reviews</span>
          </div>
        </div>

        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${testimonials.map((t, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700" style="transition-delay: ${i * 100}ms">
              <div class="h-full bg-[#111111] border border-white/10 rounded-2xl p-6 hover:shadow-xl hover:border-[#00FF88]/30 transition-all duration-300 flex flex-col">
                <div class="bg-[#00FF88]/10 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
                  <i class="${t.metricIcon} text-[#00FF88] text-sm"></i>
                  <span class="text-sm font-bold text-[#00FF88]">${t.metric}</span>
                </div>
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-0.5">
                    ${[1,2,3,4,5].map(() => '<i class="fas fa-star text-[#00FF88] text-xs"></i>').join('')}
                  </div>
                  <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-[#00FF88] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-2 py-0.5"><i class="fas fa-check-circle text-[#00FF88]"></i>Verified</span>
                </div>
                <p class="text-gray-400 text-sm leading-relaxed mb-6 flex-1">"${t.quote}"</p>
                <div class="flex items-center gap-3 pt-4 border-t border-white/10">
                  <div class="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">${t.avatar}</div>
                  <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white text-sm">${t.name}</p>
                    <p class="text-xs text-gray-500">${t.title}, ${t.company}</p>
                    <p class="text-[10px] text-gray-500">${t.location} &middot; ${t.date}</p>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// SECURITY SECTION — Privacy & compliance
// ============================================================
function renderSecuritySection() {
  return `
    <section class="py-20 border-y border-white/5" style="background:#0A0A0A">
      <div class="max-w-6xl mx-auto px-4">
        <div class="grid lg:grid-cols-2 gap-12 items-center scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div>
            <div class="inline-flex items-center gap-2 bg-[#00FF88]/10 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
              <i class="fas fa-shield-alt"></i> Security & Privacy
            </div>
            <h2 class="text-3xl font-black text-white mb-4 tracking-tight">Your Data is Safe With Us</h2>
            <p class="text-gray-400 text-base leading-relaxed mb-6">Built on Cloudflare's global edge network with enterprise-grade security. Your customer data, reports, and business information are encrypted and protected at every level.</p>
            <ul class="space-y-3">
              ${[
                { icon: 'fas fa-lock', text: '256-bit SSL/TLS encryption on all data' },
                { icon: 'fas fa-shield-alt', text: 'PCI DSS compliant payment processing via Square' },
                { icon: 'fas fa-cloud', text: 'Cloudflare WAF + DDoS protection' },
                { icon: 'fas fa-database', text: 'Encrypted database storage (Cloudflare D1)' },
                { icon: 'fas fa-user-shield', text: 'SOC 2 Type II data handling standards' },
                { icon: 'fas fa-maple-leaf', text: 'Canadian-owned, PIPEDA compliant' },
              ].map(item => `
                <li class="flex items-center gap-3 text-sm text-gray-400">
                  <div class="w-8 h-8 bg-[#00FF88]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="${item.icon} text-[#00FF88] text-xs"></i>
                  </div>
                  ${item.text}
                </li>
              `).join('')}
            </ul>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
              <i class="fab fa-google text-4xl text-gray-500 mb-3"></i>
              <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Google Cloud</p>
              <p class="text-[10px] text-gray-500">Solar API Partner</p>
            </div>
            <div class="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
              <i class="fas fa-credit-card text-4xl text-gray-500 mb-3"></i>
              <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Square</p>
              <p class="text-[10px] text-gray-500">PCI DSS Level 1</p>
            </div>
            <div class="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
              <i class="fas fa-cloud text-4xl text-gray-500 mb-3"></i>
              <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Cloudflare</p>
              <p class="text-[10px] text-gray-500">Edge Network</p>
            </div>
            <div class="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
              <i class="fas fa-robot text-4xl text-gray-500 mb-3"></i>
              <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Gemini AI</p>
              <p class="text-[10px] text-gray-500">Google AI Engine</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// INTEGRATIONS / TRUST BAR
// ============================================================
function renderIntegrations() {
  return `
    <section class="py-16 border-b border-white/5" style="background:#0d0d0d">
      <div class="max-w-6xl mx-auto px-4">
        <p class="text-center text-sm text-gray-500 uppercase tracking-wider font-semibold mb-8">Powered By & Integrated With</p>
        <div class="flex flex-wrap items-center justify-center gap-x-14 gap-y-6">
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fab fa-google text-2xl"></i>
            <span class="text-sm font-medium">Google Solar API</span>
          </div>
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fab fa-square-full text-2xl"></i>
            <span class="text-sm font-medium">Square Payments</span>
          </div>
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fas fa-robot text-2xl"></i>
            <span class="text-sm font-medium">Google Gemini AI</span>
          </div>
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fas fa-satellite text-2xl"></i>
            <span class="text-sm font-medium">Satellite Imagery</span>
          </div>
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fab fa-stripe text-2xl"></i>
            <span class="text-sm font-medium">Stripe Payments</span>
          </div>
          <div class="flex items-center gap-2.5 text-gray-500 hover:text-[#00FF88] transition-colors">
            <i class="fas fa-maple-leaf text-2xl"></i>
            <span class="text-sm font-medium">Canadian Markets</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// FAQ — Expanded
// ============================================================
function renderFAQ() {
  const faqs = [
    { q: 'What data source do you use?', a: "We use Google's Solar API, providing high-resolution satellite imagery with LiDAR-calibrated 3D building models. This is the same data Google uses for their solar panel recommendations &mdash; the most accurate publicly available roof geometry data." },
    { q: 'How accurate are the measurements?', a: 'For buildings with HIGH quality imagery (most urban Canadian addresses), accuracy is typically within 2-5% of manual measurements. We display confidence scores and imagery quality on every report.' },
    { q: 'What areas do you cover?', a: "Most Canadian addresses where Google has Solar API coverage. Urban areas in Alberta, BC, Ontario, and Quebec have the best coverage. If Solar API data isn't available, our AI vision engine provides a fallback analysis." },
    { q: 'How fast do I get my report?', a: 'Most reports are generated in under 60 seconds. You receive an email with a download link and can also access all reports from your dashboard.' },
    { q: 'What is the AI Roofer Secretary?', a: 'A 24/7 AI phone answering service for your roofing business. It answers calls in a natural human voice, books appointments to your calendar, qualifies leads with your custom screening questions, and sends you detailed call summaries with full transcripts. Handles after-hours, storm season overflow, and lunch breaks. Currently $149/month (limited-time launch price, normally $249/month). No contracts &mdash; cancel anytime.' },
    { q: 'Can I add team members?', a: 'Yes! For $50/user/month, you can invite salespeople and other team members. They get full access to reports, CRM, AI Secretary, and all features.' },
    { q: 'What payment methods do you accept?', a: 'All major credit cards, debit, Apple Pay, Google Pay, and Cash App through Square. All transactions are encrypted and PCI-compliant.' },
    { q: 'Do you offer volume discounts?', a: 'Yes! B2B customers get priority processing and volume pricing starting at $5/report for 100+ packs for 50+ reports/month. Contact us for custom rates and monthly invoicing.' },
    { q: 'Is my data secure?', a: 'Absolutely. Built on Cloudflare\'s edge network with 256-bit encryption, PCI DSS compliant payments, and Canadian PIPEDA privacy compliance. Your data never leaves secure infrastructure.' },
    { q: 'Can I cancel anytime?', a: 'Of course. Pay-per-report has zero commitments. Add-on services like AI Secretary are month-to-month with no contracts.' },
  ];

  return `
    <section id="faq" class="py-24" style="background:#0A0A0A">
      <div class="max-w-3xl mx-auto px-4">
        <div class="text-center mb-12 scroll-animate opacity-0 translate-y-8 transition-all duration-700">
          <div class="inline-flex items-center gap-2 bg-white/10 text-gray-300 rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <i class="fas fa-question-circle"></i> FAQ
          </div>
          <h2 class="text-3xl lg:text-4xl font-black text-white tracking-tight">Frequently Asked Questions</h2>
        </div>

        <div class="space-y-3">
          ${faqs.map((faq, i) => `
            <div class="scroll-animate opacity-0 translate-y-8 transition-all duration-700 bg-[#111111] rounded-xl border border-white/10 overflow-hidden hover:shadow-md transition-shadow" style="transition-delay: ${i * 50}ms">
              <button onclick="toggleFAQ(this)" class="w-full text-left p-5 flex items-center justify-between hover:bg-white/5 transition-colors min-h-[56px]">
                <span class="font-semibold text-gray-300 text-sm pr-4">${faq.q}</span>
                <i class="fas fa-chevron-down text-gray-500 transition-transform duration-300 faq-icon flex-shrink-0"></i>
              </button>
              <div class="faq-answer hidden px-5 pb-5">
                <p class="text-sm text-gray-400 leading-relaxed">${faq.a}</p>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="text-center mt-8">
          <p class="text-sm text-gray-500">Still have questions? <a href="mailto:reports@reusecanada.ca" class="text-[#00FF88] hover:underline font-semibold">Contact us</a></p>
        </div>
      </div>
    </section>
  `;
}

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

// ============================================================
// FINAL CTA — Stronger with social proof
// ============================================================
function renderFinalCTA() {
  return `
    <section class="relative py-28 overflow-hidden">
      <div class="absolute inset-0">
        <img src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920&q=80&auto=format&fit=crop&t=20260405"
             alt="Modern building" class="w-full h-full object-cover" loading="lazy" />
        <div class="absolute inset-0 bg-gradient-to-r from-slate-900/95 via-slate-900/90 to-cyan-900/80"></div>
      </div>

      <div class="relative max-w-4xl mx-auto px-4 text-center scroll-animate opacity-0 translate-y-8 transition-all duration-700">
        <div class="inline-flex items-center gap-2 bg-[#00FF88]/20 text-[#00FF88] rounded-full px-4 py-1.5 text-sm font-bold mb-6">
          <span class="animate-pulse">&#x1F525;</span> Join 5,000+ Canadian Roofers Already Using AI
        </div>
        <h2 class="text-4xl lg:text-5xl font-black text-white mb-6 tracking-tight leading-tight">
          Ready to Save Hours<br/>on Every Estimate?
        </h2>
        <p class="text-xl text-gray-300 mb-10 max-w-2xl mx-auto font-light">
          Stop climbing roofs. Stop guessing measurements. Start quoting faster with satellite-powered precision.
        </p>

        <div class="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <a href="/signup" onclick="rrTrack('cta_click',{location:'final_cta',variant:'teal'})" class="group inline-flex items-center justify-center gap-3 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-extrabold py-4 px-10 rounded-xl text-lg shadow-2xl shadow-[#00FF88]/30 transition-all duration-300 hover:scale-[1.03] min-h-[56px]">
            <i class="fas fa-rocket"></i>
            Start Free &mdash; 3 Reports On Us
            <i class="fas fa-arrow-right text-sm group-hover:translate-x-1 transition-transform"></i>
          </a>
          <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" onclick="rrTrack('cta_click',{location:'final_cta_demo'})" class="group inline-flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 text-white font-bold py-4 px-10 rounded-xl text-lg border border-white/20 hover:border-white/30 transition-all duration-300 min-h-[56px]">
            <i class="fas fa-calendar-check"></i>
            Book a Demo Meeting
          </a>
        </div>

        <!-- Before/After metrics -->
        <div class="flex flex-col sm:flex-row items-center justify-center gap-6 mb-8">
          <div class="bg-red-500/10 border border-red-500/20 rounded-xl px-6 py-3">
            <div class="text-xs text-red-400 font-bold uppercase tracking-wider mb-0.5">Before</div>
            <div class="text-white font-bold">2 hrs/estimate, climbing roofs</div>
          </div>
          <i class="fas fa-arrow-right text-cyan-400 text-xl hidden sm:block"></i>
          <i class="fas fa-arrow-down text-cyan-400 text-xl sm:hidden"></i>
          <div class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-xl px-6 py-3">
            <div class="text-xs text-[#00FF88] font-bold uppercase tracking-wider mb-0.5">After</div>
            <div class="text-white font-bold">60 seconds, from your truck</div>
          </div>
        </div>

        <p class="text-sm text-gray-400">
          No credit card required. 3 free reports. Then $7 USD per report.
          <br/>Questions? <a href="mailto:reports@reusecanada.ca" class="text-cyan-400 hover:underline">reports@reusecanada.ca</a>
          &nbsp;·&nbsp; <a href="/privacy" class="text-cyan-400 hover:underline">Privacy Policy</a> &nbsp;·&nbsp; <a href="/terms" class="text-cyan-400 hover:underline">Terms</a>
        </p>
      </div>
    </section>
  `;
}

// ============================================================
// FOOTER CROSS-LINKS — Internal linking for SEO
// ============================================================
function renderFooterCrossLinks() {
  const popularCities = [
    { name: 'New York', slug: 'new-york' },
    { name: 'Los Angeles', slug: 'los-angeles' },
    { name: 'Chicago', slug: 'chicago' },
    { name: 'Houston', slug: 'houston' },
    { name: 'Dallas', slug: 'dallas' },
    { name: 'Miami', slug: 'miami' },
    { name: 'Atlanta', slug: 'atlanta' },
    { name: 'Denver', slug: 'denver' },
    { name: 'Phoenix', slug: 'phoenix' },
    { name: 'Seattle', slug: 'seattle' },
    { name: 'Nashville', slug: 'nashville' },
    { name: 'Austin', slug: 'austin' },
    { name: 'Calgary', slug: 'calgary' },
    { name: 'Toronto', slug: 'toronto' },
    { name: 'Vancouver', slug: 'vancouver' },
    { name: 'Edmonton', slug: 'edmonton' },
  ];

  const countries = [
    { name: 'United States', slug: 'united-states' },
    { name: 'Canada', slug: 'canada' },
    { name: 'United Kingdom', slug: 'united-kingdom' },
    { name: 'Australia', slug: 'australia' },
    { name: 'Germany', slug: 'germany' },
    { name: 'France', slug: 'france' },
    { name: 'Spain', slug: 'spain' },
    { name: 'Italy', slug: 'italy' },
    { name: 'Japan', slug: 'japan' },
    { name: 'Brazil', slug: 'brazil' },
    { name: 'Mexico', slug: 'mexico' },
    { name: 'New Zealand', slug: 'new-zealand' },
  ];

  return `
    <section style="background:#0A0A0A" class="py-16 border-t border-white/5">
      <div class="max-w-7xl mx-auto px-4">
        <div class="grid md:grid-cols-2 gap-12">
          <div>
            <h4 class="text-white font-bold text-sm uppercase tracking-wider mb-4">
              <i class="fas fa-map-marker-alt text-[#00FF88] mr-2"></i>Roof Measurements by City
            </h4>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              ${popularCities.map(c => `<a href="/roof-measurement/${c.slug}" class="text-gray-500 hover:text-[#00FF88] text-xs transition-colors">${c.name}</a>`).join('')}
            </div>
          </div>
          <div>
            <h4 class="text-white font-bold text-sm uppercase tracking-wider mb-4">
              <i class="fas fa-globe text-[#22d3ee] mr-2"></i>Coverage by Country
            </h4>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              ${countries.map(c => `<a href="/roof-measurement/${c.slug}" class="text-gray-500 hover:text-[#22d3ee] text-xs transition-colors">${c.name}</a>`).join('')}
            </div>
            <a href="/coverage" class="text-[#00FF88] text-xs font-semibold mt-3 inline-block hover:underline">View all 40+ countries →</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

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
          ${[1,2,3,4,5].map(() => '<i class="fas fa-star text-[#00FF88] text-xs"></i>').join('')}
        </div>
        <span class="text-white text-sm font-medium">Trusted by 5,000+ Canadian Roofers</span>
      </div>
      <div class="flex items-center gap-3 flex-1 sm:flex-none justify-end">
        <span class="text-gray-400 text-sm hidden md:inline">Get 3 Free Reports &mdash; No CC Required</span>
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
        <p class="text-gray-400 text-sm">Get 3 free professional roof measurement reports &mdash; no credit card required.</p>
      </div>
      <div class="p-6">
        <div class="space-y-4 mb-6">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-[#00FF88]/10 rounded-full flex items-center justify-center flex-shrink-0"><i class="fas fa-file-alt text-[#00FF88] text-xs"></i></div>
            <span class="text-sm text-gray-300"><strong class="text-white">3 Free Reports</strong> &mdash; professional PDF with 3D area, BOM, solar data</span>
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
            <i class="fas fa-gift mr-2"></i>Claim My 3 Free Reports
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
