// ============================================================
// Website Builder — HTML Template Engine
// Converts AI-generated section data into complete HTML pages
// ============================================================

import type { WBGeneratedPageContent, WBSectionType, WBBrandColors } from '../types'

export function buildPageHTML(
  page: WBGeneratedPageContent,
  colors: WBBrandColors,
  businessName: string,
  phone: string,
  siteId?: number,
  basePath: string = ''
): string {
  const css = buildBaseCSS(colors)
  const sectionsHTML = page.sections.map(section =>
    buildSection(section.type, section.data, colors, phone, basePath)
  ).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${e(page.meta_description)}">
  <title>${e(page.meta_title)}</title>
  ${siteId ? `<meta name="site-id" content="${siteId}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body>
  ${buildNavbar(businessName, phone, basePath)}
  <main>
    ${sectionsHTML}
  </main>
  ${buildFooter(businessName, phone, basePath)}
  <script>${buildBaseJS()}</script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Short helper for escaping any value
function e(val: unknown): string {
  return escapeHtml(String(val || ''))
}

function buildBaseCSS(colors: WBBrandColors): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: ${colors.primary};
      --secondary: ${colors.secondary};
      --accent: ${colors.accent};
      --text: #1a1a1a;
      --text-light: #6b7280;
      --bg-light: #f9fafb;
      --white: #ffffff;
      --font: 'Inter', system-ui, sans-serif;
      --radius: 8px;
      --shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
      --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
    }
    body { font-family: var(--font); color: var(--text); line-height: 1.6; }
    img { max-width: 100%; height: auto; }
    a { color: inherit; text-decoration: none; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 14px 28px; border-radius: var(--radius); font-weight: 600; font-size: 16px; cursor: pointer; transition: all 0.2s; border: none; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: var(--shadow-lg); }
    .btn-secondary { background: transparent; color: white; border: 2px solid white; }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); }
    .btn-outline { background: transparent; color: var(--primary); border: 2px solid var(--primary); }
    .btn-outline:hover { background: var(--primary); color: white; }
    .section { padding: 80px 0; }
    .section-light { background: var(--bg-light); }
    .section-dark { background: var(--secondary); color: white; }
    .section-primary { background: var(--primary); color: white; }
    .section-title { font-size: clamp(28px, 4vw, 42px); font-weight: 800; margin-bottom: 16px; line-height: 1.2; }
    .section-subtitle { font-size: 18px; color: var(--text-light); margin-bottom: 48px; max-width: 600px; }
    .text-center { text-align: center; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 32px; }
    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: var(--shadow); }
    .card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); transition: all 0.2s; }
    .star { color: #f59e0b; font-size: 20px; }
    .navbar { background: var(--secondary); padding: 16px 0; position: sticky; top: 0; z-index: 100; box-shadow: var(--shadow); }
    .navbar-inner { display: flex; justify-content: space-between; align-items: center; }
    .navbar-brand { font-size: 22px; font-weight: 800; color: white; }
    .navbar-links { display: flex; gap: 24px; align-items: center; }
    .navbar-links a { color: rgba(255,255,255,0.85); font-size: 15px; font-weight: 500; transition: color 0.2s; }
    .navbar-links a:hover { color: white; }
    .navbar-phone { background: var(--primary); color: white; padding: 10px 20px; border-radius: var(--radius); font-weight: 700; font-size: 16px; }
    .navbar-phone:hover { opacity: 0.9; }
    .hero { background: var(--secondary); color: white; padding: 100px 0; }
    .hero-headline { font-size: clamp(36px, 6vw, 64px); font-weight: 900; line-height: 1.1; margin-bottom: 24px; }
    .hero-sub { font-size: 20px; opacity: 0.85; margin-bottom: 40px; max-width: 600px; }
    .hero-actions { display: flex; gap: 16px; flex-wrap: wrap; }
    .hero-trust { margin-top: 40px; font-size: 14px; opacity: 0.7; }
    .trust-bar { background: var(--primary); padding: 20px 0; }
    .trust-bar-items { display: flex; justify-content: center; gap: 40px; flex-wrap: wrap; }
    .trust-bar-item { display: flex; align-items: center; gap: 8px; color: white; font-weight: 600; font-size: 15px; }
    .service-card { text-align: center; }
    .service-icon { font-size: 40px; margin-bottom: 16px; }
    .service-name { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .service-desc { color: var(--text-light); font-size: 15px; }
    .review-stars { margin-bottom: 12px; }
    .review-text { font-style: italic; margin-bottom: 16px; color: var(--text-light); }
    .review-author { font-weight: 700; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 32px; text-align: center; }
    .stat-number { font-size: 48px; font-weight: 900; color: var(--primary); line-height: 1; }
    .stat-label { font-size: 16px; color: var(--text-light); margin-top: 8px; }
    .cta-banner { background: var(--primary); color: white; padding: 80px 0; text-align: center; }
    .cta-headline { font-size: clamp(28px, 4vw, 40px); font-weight: 800; margin-bottom: 16px; }
    .cta-sub { font-size: 18px; opacity: 0.9; margin-bottom: 36px; }
    .form-group { margin-bottom: 20px; }
    .form-label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
    .form-input { width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: var(--radius); font-size: 16px; font-family: var(--font); transition: border-color 0.2s; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    textarea.form-input { resize: vertical; min-height: 120px; }
    .form-submit { width: 100%; padding: 16px; background: var(--primary); color: white; border: none; border-radius: var(--radius); font-size: 18px; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
    .form-submit:hover { opacity: 0.9; }
    .contact-info-item { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; font-size: 17px; }
    .contact-icon { font-size: 24px; }
    .footer { background: #111827; color: #9ca3af; padding: 60px 0 30px; }
    .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 40px; margin-bottom: 48px; }
    .footer-brand { font-size: 20px; font-weight: 800; color: white; margin-bottom: 12px; }
    .footer-desc { font-size: 14px; line-height: 1.7; }
    .footer-heading { font-size: 14px; font-weight: 700; color: white; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
    .footer-links { list-style: none; }
    .footer-links li { margin-bottom: 10px; }
    .footer-links a { font-size: 14px; transition: color 0.2s; }
    .footer-links a:hover { color: white; }
    .footer-bottom { border-top: 1px solid #1f2937; padding-top: 24px; text-align: center; font-size: 14px; }
    .faq-item { border-bottom: 1px solid #e5e7eb; padding: 24px 0; }
    .faq-question { font-size: 17px; font-weight: 700; margin-bottom: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .faq-answer { color: var(--text-light); font-size: 15px; line-height: 1.7; }
    .city-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .city-item { background: white; border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); text-align: center; border-top: 3px solid var(--primary); }
    .city-name { font-weight: 700; font-size: 16px; }
    .hamburger { display: none; background: none; border: none; cursor: pointer; padding: 8px; }
    .hamburger span { display: block; width: 24px; height: 2px; background: white; margin: 5px 0; transition: 0.3s; }
    @media (max-width: 768px) {
      .section { padding: 60px 0; }
      .hero { padding: 60px 0; }
      .hero-actions { flex-direction: column; }
      .trust-bar-items { gap: 20px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .navbar-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--secondary); flex-direction: column; padding: 16px 24px; gap: 12px; box-shadow: var(--shadow-lg); }
      .navbar-links.active { display: flex; }
      .hamburger { display: block; }
    }
  `
}

function buildNavbar(businessName: string, phone: string, basePath: string): string {
  return `
  <nav class="navbar">
    <div class="container">
      <div class="navbar-inner">
        <a href="${basePath}/" class="navbar-brand">${e(businessName)}</a>
        <button class="hamburger" onclick="document.querySelector('.navbar-links').classList.toggle('active')" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <div class="navbar-links">
          <a href="${basePath}/">Home</a>
          <a href="${basePath}/services">Services</a>
          <a href="${basePath}/about">About</a>
          <a href="${basePath}/service-areas">Areas</a>
          <a href="${basePath}/contact">Contact</a>
          <a href="tel:${phone.replace(/\D/g, '')}" class="navbar-phone">${e(phone)}</a>
        </div>
      </div>
    </div>
  </nav>`
}

function buildSection(
  type: WBSectionType,
  data: Record<string, unknown>,
  colors: WBBrandColors,
  phone: string,
  basePath: string
): string {
  switch (type) {
    case 'hero': return buildHeroSection(data, phone, basePath)
    case 'trust_bar': return buildTrustBar(data)
    case 'services_grid': return buildServicesGrid(data)
    case 'about_snippet': return buildAboutSnippet(data, basePath)
    case 'reviews': return buildReviews(data)
    case 'stats': return buildStats(data)
    case 'cta_banner': return buildCTABanner(data, basePath)
    case 'service_list': return buildServiceList(data)
    case 'story': return buildStory(data)
    case 'certifications': return buildCertifications(data)
    case 'city_list': return buildCityList(data)
    case 'city_detail': return buildCityDetail(data)
    case 'contact_form': return buildContactForm(data, phone)
    case 'faq': return buildFAQ(data)
    case 'team': return buildTeam(data)
    default: return `<!-- Unknown section: ${type} -->`
  }
}

function buildHeroSection(data: Record<string, unknown>, phone: string, basePath: string): string {
  return `
  <section class="hero">
    <div class="container">
      <h1 class="hero-headline">${e(data.headline) || 'Professional Roofing You Can Trust'}</h1>
      <p class="hero-sub">${e(data.subheadline)}</p>
      <div class="hero-actions">
        <a href="tel:${phone.replace(/\D/g, '')}" class="btn btn-primary">${e(data.cta_primary_text) || 'Call For Free Estimate'}</a>
        ${data.cta_secondary_text ? `<a href="${basePath}/contact" class="btn btn-secondary">${e(data.cta_secondary_text)}</a>` : ''}
      </div>
      ${data.trust_line ? `<p class="hero-trust">${e(data.trust_line)}</p>` : ''}
    </div>
  </section>`
}

function buildTrustBar(data: Record<string, unknown>): string {
  const items = (data.items as Array<{ icon: string; text: string }>) || []
  return `
  <div class="trust-bar">
    <div class="container">
      <div class="trust-bar-items">
        ${items.map(item => `<div class="trust-bar-item">${e(item.icon)} ${e(item.text)}</div>`).join('')}
      </div>
    </div>
  </div>`
}

function buildServicesGrid(data: Record<string, unknown>): string {
  const services = (data.services as Array<{ name: string; description: string; icon_name?: string }>) || []
  const icons: Record<string, string> = {
    shingle: '🏠', metal: '🔧', flat: '📐', tile: '🧱', repair: '🔨',
    inspection: '🔍', storm: '⛈️', insurance: '📋', gutter: '💧',
    emergency: '🚨', commercial: '🏢', default: '✅'
  }
  return `
  <section class="section section-light">
    <div class="container text-center">
      <h2 class="section-title">${e(data.headline) || 'Our Services'}</h2>
      <p class="section-subtitle" style="margin: 0 auto 48px">${e(data.subheadline)}</p>
      <div class="grid-3">
        ${services.map(service => {
          const iconKey = service.icon_name?.toLowerCase() || 'default'
          const icon = icons[iconKey] || icons.default
          return `
          <div class="card service-card">
            <div class="service-icon">${icon}</div>
            <div class="service-name">${e(service.name)}</div>
            <div class="service-desc">${e(service.description)}</div>
          </div>`
        }).join('')}
      </div>
    </div>
  </section>`
}

function buildAboutSnippet(data: Record<string, unknown>, basePath: string): string {
  return `
  <section class="section">
    <div class="container">
      <div class="grid-2" style="align-items: center; gap: 60px;">
        <div>
          <h2 class="section-title">${e(data.headline) || 'About Us'}</h2>
          <p style="font-size: 17px; line-height: 1.8; color: #374151; margin-bottom: 32px;">${e(data.body)}</p>
          <a href="${basePath}/about" class="btn btn-outline">${e(data.cta_text) || 'Learn More About Us'}</a>
        </div>
        <div style="background: #f3f4f6; border-radius: 16px; height: 300px; display: flex; align-items: center; justify-content: center; font-size: 60px;">🏠</div>
      </div>
    </div>
  </section>`
}

function buildReviews(data: Record<string, unknown>): string {
  const reviews = (data.reviews as Array<{ author: string; rating: number; text: string }>) || []
  return `
  <section class="section section-light">
    <div class="container text-center">
      <h2 class="section-title">${e(data.headline) || 'What Our Customers Say'}</h2>
      <div class="grid-3" style="margin-top: 48px;">
        ${reviews.map(review => `
        <div class="card review-card">
          <div class="review-stars">${'⭐'.repeat(review.rating || 5)}</div>
          <p class="review-text">"${e(review.text)}"</p>
          <div class="review-author">— ${e(review.author)}</div>
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildStats(data: Record<string, unknown>): string {
  const items = (data.items as Array<{ number: string; label: string }>) || []
  return `
  <section class="section">
    <div class="container">
      <div class="stats-grid">
        ${items.map(item => `
        <div>
          <div class="stat-number">${e(item.number)}</div>
          <div class="stat-label">${e(item.label)}</div>
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildCTABanner(data: Record<string, unknown>, basePath: string): string {
  const ctaUrl = basePath + (String(data.cta_url || '/contact'))
  return `
  <section class="cta-banner">
    <div class="container">
      <h2 class="cta-headline">${e(data.headline) || 'Ready to Get Started?'}</h2>
      ${data.subheadline ? `<p class="cta-sub">${e(data.subheadline)}</p>` : ''}
      <a href="${ctaUrl}" class="btn btn-secondary" style="font-size: 18px; padding: 16px 40px;">${e(data.cta_text) || 'Get a Free Estimate'}</a>
    </div>
  </section>`
}

function buildServiceList(data: Record<string, unknown>): string {
  const services = (data.services as Array<{ name: string; headline: string; description: string; benefits?: string[] }>) || []
  return `
  <section class="section">
    <div class="container">
      ${services.map((service, i) => `
      <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 48px; align-items: start; margin-bottom: 64px; ${i % 2 === 1 ? 'direction: rtl;' : ''}">
        <div style="direction: ltr; background: #f3f4f6; border-radius: 16px; padding: 40px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">🏠</div>
          <div style="font-size: 20px; font-weight: 800;">${e(service.name)}</div>
        </div>
        <div style="direction: ltr;">
          <h2 style="font-size: 28px; font-weight: 800; margin-bottom: 16px;">${e(service.headline)}</h2>
          <p style="font-size: 16px; color: #4b5563; margin-bottom: 24px; line-height: 1.8;">${e(service.description)}</p>
          ${service.benefits ? `<ul style="list-style: none;">
            ${service.benefits.map(b => `<li style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 15px;">✅ ${e(b)}</li>`).join('')}
          </ul>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </section>`
}

function buildStory(data: Record<string, unknown>): string {
  const paragraphs = (data.paragraphs as string[]) || []
  return `
  <section class="section">
    <div class="container">
      <div class="grid-2" style="gap: 60px; align-items: center;">
        <div>
          <h2 class="section-title">${e(data.headline) || 'Our Story'}</h2>
          ${paragraphs.map(p => `<p style="font-size: 17px; line-height: 1.8; color: #374151; margin-bottom: 20px;">${e(p)}</p>`).join('')}
          ${data.owner_name ? `<p style="font-weight: 700; font-size: 16px; margin-top: 24px;">— ${e(data.owner_name)}</p>` : ''}
        </div>
        <div style="background: #f3f4f6; border-radius: 16px; height: 360px; display: flex; align-items: center; justify-content: center; font-size: 80px;">👷</div>
      </div>
    </div>
  </section>`
}

function buildCertifications(data: Record<string, unknown>): string {
  const items = (data.items as Array<{ name: string; description: string }>) || []
  return `
  <section class="section section-light">
    <div class="container text-center">
      <h2 class="section-title">${e(data.headline) || 'Our Certifications & Credentials'}</h2>
      <div class="grid-3" style="margin-top: 48px;">
        ${items.map(item => `
        <div class="card" style="border-top: 4px solid var(--primary);">
          <div style="font-size: 32px; margin-bottom: 12px;">🏆</div>
          <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">${e(item.name)}</div>
          <div style="color: #6b7280; font-size: 14px;">${e(item.description)}</div>
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildCityList(data: Record<string, unknown>): string {
  const cities = (data.cities as Array<{ name: string; description?: string }>) || []
  return `
  <section class="section">
    <div class="container">
      <h2 class="section-title text-center">${e(data.headline) || 'Areas We Serve'}</h2>
      <div class="city-grid" style="margin-top: 48px;">
        ${cities.map(city => `
        <div class="city-item">
          <div style="font-size: 24px; margin-bottom: 8px;">📍</div>
          <div class="city-name">${e(city.name)}</div>
          ${city.description ? `<div style="font-size: 13px; color: #6b7280; margin-top: 6px;">${e(city.description)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildCityDetail(data: Record<string, unknown>): string {
  const whyUs = (data.why_choose_us as string[]) || []
  return `
  <section class="section">
    <div class="container">
      <div class="grid-2" style="gap: 60px;">
        <div>
          <h2 class="section-title">Roofing in ${e(data.city)}, ${e(data.state)}</h2>
          <p style="font-size: 17px; line-height: 1.8; color: #374151; margin-bottom: 32px;">${e(data.intro_paragraph)}</p>
          ${data.local_note ? `<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 32px;"><p style="font-size: 15px; color: #92400e;">${e(data.local_note)}</p></div>` : ''}
        </div>
        <div>
          <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 20px;">Why ${e(data.city)} Homeowners Choose Us</h3>
          <ul style="list-style: none;">
            ${whyUs.map(item => `<li style="display: flex; gap: 12px; margin-bottom: 16px; font-size: 16px; align-items: flex-start;">✅ <span>${e(item)}</span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
  </section>`
}

function buildContactForm(data: Record<string, unknown>, phone: string): string {
  return `
  <section class="section">
    <div class="container">
      <div class="grid-2" style="gap: 60px;">
        <div>
          <h2 class="section-title">${e(data.headline) || 'Contact Us'}</h2>
          <div style="margin-bottom: 40px;">
            <div class="contact-info-item"><span class="contact-icon">📞</span><a href="tel:${phone.replace(/\D/g, '')}" style="font-weight: 600;">${e(data.phone || phone)}</a></div>
            ${data.email ? `<div class="contact-info-item"><span class="contact-icon">✉️</span><a href="mailto:${e(data.email)}">${e(data.email)}</a></div>` : ''}
            ${data.address_line ? `<div class="contact-info-item"><span class="contact-icon">📍</span>${e(data.address_line)}</div>` : ''}
            ${data.hours ? `<div class="contact-info-item"><span class="contact-icon">🕐</span>${e(data.hours)}</div>` : ''}
          </div>
        </div>
        <div>
          <form id="contact-form" style="background: white; padding: 40px; border-radius: 16px; box-shadow: var(--shadow-lg);">
            <h3 style="font-size: 22px; font-weight: 700; margin-bottom: 24px;">Get a Free Estimate</h3>
            <div class="grid-2" style="gap: 16px; margin-bottom: 0;">
              <div class="form-group"><label class="form-label">Your Name *</label><input class="form-input" type="text" name="name" required placeholder="John Smith"></div>
              <div class="form-group"><label class="form-label">Phone *</label><input class="form-input" type="tel" name="phone" required placeholder="(555) 555-5555"></div>
            </div>
            <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" placeholder="john@example.com"></div>
            <div class="form-group"><label class="form-label">Property Address</label><input class="form-input" type="text" name="address" placeholder="123 Main St"></div>
            <div class="form-group"><label class="form-label">Service Needed</label>
              <select class="form-input" name="service_type">
                <option value="">Select a service...</option>
                <option>Roof Inspection</option>
                <option>Roof Repair</option>
                <option>Roof Replacement</option>
                <option>New Installation</option>
                <option>Storm Damage</option>
                <option>Other</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Message</label><textarea class="form-input" name="message" placeholder="Tell us about your project..."></textarea></div>
            <button type="submit" class="form-submit">Send My Request →</button>
          </form>
        </div>
      </div>
    </div>
  </section>`
}

function buildFAQ(data: Record<string, unknown>): string {
  const items = (data.items as Array<{ question: string; answer: string }>) || []
  return `
  <section class="section section-light">
    <div class="container" style="max-width: 800px;">
      <h2 class="section-title text-center">${e(data.headline) || 'Frequently Asked Questions'}</h2>
      <div style="margin-top: 48px;">
        ${items.map((item, i) => `
        <div class="faq-item">
          <div class="faq-question" onclick="toggleFAQ(${i})">
            ${e(item.question)}
            <span id="faq-icon-${i}">+</span>
          </div>
          <div class="faq-answer" id="faq-${i}" style="display: none;">${e(item.answer)}</div>
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildTeam(data: Record<string, unknown>): string {
  const members = (data.members as Array<{ name: string; role: string; bio?: string }>) || []
  return `
  <section class="section">
    <div class="container text-center">
      <h2 class="section-title">${e(data.headline) || 'Meet Our Team'}</h2>
      <div class="grid-3" style="margin-top: 48px;">
        ${members.map(member => `
        <div class="card" style="text-align: center;">
          <div style="width: 80px; height: 80px; background: #f3f4f6; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 36px;">👷</div>
          <div style="font-weight: 700; font-size: 18px;">${e(member.name)}</div>
          <div style="color: var(--primary); font-size: 14px; font-weight: 600; margin-bottom: 12px;">${e(member.role)}</div>
          ${member.bio ? `<div style="color: #6b7280; font-size: 14px;">${e(member.bio)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>
  </section>`
}

function buildFooter(businessName: string, phone: string, basePath: string): string {
  return `
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-brand">${e(businessName)}</div>
          <p class="footer-desc">Professional roofing services you can trust. Licensed, insured, and committed to quality.</p>
        </div>
        <div>
          <div class="footer-heading">Services</div>
          <ul class="footer-links">
            <li><a href="${basePath}/services">All Services</a></li>
            <li><a href="${basePath}/services">Roof Replacement</a></li>
            <li><a href="${basePath}/services">Roof Repairs</a></li>
            <li><a href="${basePath}/services">Inspections</a></li>
          </ul>
        </div>
        <div>
          <div class="footer-heading">Company</div>
          <ul class="footer-links">
            <li><a href="${basePath}/about">About Us</a></li>
            <li><a href="${basePath}/service-areas">Service Areas</a></li>
            <li><a href="${basePath}/contact">Contact</a></li>
          </ul>
        </div>
        <div>
          <div class="footer-heading">Contact</div>
          <ul class="footer-links">
            <li><a href="tel:${phone.replace(/\D/g, '')}">${e(phone)}</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; ${new Date().getFullYear()} ${e(businessName)}. All rights reserved. | Powered by <a href="https://roofmanager.ca" style="color: var(--primary);">Roof Manager</a></p>
      </div>
    </div>
  </footer>`
}

function buildBaseJS(): string {
  return `
    function toggleFAQ(index) {
      var answer = document.getElementById('faq-' + index);
      var icon = document.getElementById('faq-icon-' + index);
      if (answer.style.display === 'none') {
        answer.style.display = 'block';
        icon.textContent = String.fromCharCode(8722);
      } else {
        answer.style.display = 'none';
        icon.textContent = '+';
      }
    }

    var form = document.getElementById('contact-form');
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var btn = form.querySelector('.form-submit');
        btn.textContent = 'Sending...';
        btn.disabled = true;

        var formData = new FormData(form);
        var data = {};
        formData.forEach(function(v, k) { data[k] = v; });
        var siteId = document.querySelector('meta[name="site-id"]');
        if (siteId) data.site_id = siteId.content;
        data.source = 'contact_form';
        data.source_page = window.location.pathname;

        try {
          var res = await fetch('/api/website-builder/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          if (res.ok) {
            form.innerHTML = '<div style="text-align:center; padding: 40px;"><div style="font-size:48px; margin-bottom:16px;">✅</div><h3 style="font-size:22px; font-weight:700; margin-bottom:8px;">Message Received!</h3><p style="color:#6b7280;">We will be in touch within 1 business day.</p></div>';
          } else {
            throw new Error('Submit failed');
          }
        } catch(err) {
          btn.textContent = 'Try Again';
          btn.disabled = false;
          alert('Something went wrong. Please call us directly.');
        }
      });
    }
  `
}
