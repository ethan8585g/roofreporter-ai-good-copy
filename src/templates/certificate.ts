// Certificate of New Roof Installation — HTML template
// Returns a print-ready HTML document (letter format) for insurance documentation.
// Supports 4 template styles: classic, modern, bold, minimal

export interface CertificateArgs {
  companyName: string
  companyLogo?: string
  companyAddress?: string
  companyPhone?: string
  companyEmail?: string
  licenseNumber?: string  // Contractor license / registration number
  customerName: string
  propertyAddress: string
  proposalNumber: string
  signedAt: string        // ISO date string
  scopeOfWork?: string
  materials?: string
  totalAmount?: number
  accentColor?: string    // defaults to #1a5c38 (certificate green)
  secondaryColor?: string // defaults to #f5b041 (gold accent)
  fontFamily?: string     // defaults to 'EB Garamond'
  templateStyle?: 'classic' | 'modern' | 'bold' | 'minimal'
  customMessage?: string
  watermarkEnabled?: boolean
  logoAlignment?: 'left' | 'center' | 'right'
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

// Font import URLs for supported fonts
const FONT_IMPORTS: Record<string, string> = {
  'EB Garamond': "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap",
  'Playfair Display': "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@400;500;600&display=swap",
  'Montserrat': "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap",
  'Lora': "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap",
  'Merriweather': "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Inter:wght@400;500;600&display=swap",
  'Raleway': "https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap",
}

export function generateRoofInstallationCertificateHTML(args: CertificateArgs): string {
  const style = args.templateStyle || 'classic'
  switch (style) {
    case 'modern': return generateModernCertificate(args)
    case 'bold': return generateBoldCertificate(args)
    case 'minimal': return generateMinimalCertificate(args)
    default: return generateClassicCertificate(args)
  }
}

// ─── Shared helpers ───────────────────────────────────────────

function fontImport(fontFamily: string): string {
  const url = FONT_IMPORTS[fontFamily] || FONT_IMPORTS['EB Garamond']
  return `@import url('${url}');`
}

function serifFont(fontFamily: string): string {
  if (['Montserrat', 'Raleway'].includes(fontFamily)) return `'${fontFamily}', system-ui, sans-serif`
  return `'${fontFamily}', Georgia, serif`
}

function watermarkCSS(enabled: boolean, companyName: string, color: string): string {
  if (!enabled) return ''
  return `
  .page::before {
    content: '${companyName.replace(/'/g, "\\'")}';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 100px;
    font-weight: 700;
    color: ${color}08;
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
  }`
}

function detailRows(args: CertificateArgs, accentColor: string): string {
  const { customerName, propertyAddress, proposalNumber, licenseNumber, scopeOfWork, materials, totalAmount } = args
  const formattedDate = formatDate(args.signedAt)
  const rows: string[] = []
  rows.push(row('Homeowner / Client', customerName, false))
  rows.push(row('Property Address', propertyAddress, true))
  rows.push(row('Contract Number', proposalNumber, false))
  if (licenseNumber) rows.push(row('Contractor License #', `<span style="font-weight:600">${licenseNumber}</span>`, true))
  rows.push(row('Execution Date', formattedDate, rows.length % 2 === 1))
  if (scopeOfWork) rows.push(row('Scope of Work', scopeOfWork, rows.length % 2 === 1))
  if (materials) rows.push(row('Materials', materials, rows.length % 2 === 1))
  if (totalAmount !== undefined && totalAmount !== null) {
    rows.push(`<div class="detail-row-full total-row" style="background:${accentColor}08">
      <div class="detail-key" style="color:${accentColor};border-bottom:none">Contract Value</div>
      <div class="detail-value" style="border-bottom:none;font-size:15px;font-weight:700;color:${accentColor}">${formatCurrency(totalAmount)}</div>
    </div>`)
  }
  return rows.join('')
}

function row(label: string, value: string, alt: boolean): string {
  return `<div class="detail-row-full"${alt ? ' style="background:#f9fafb"' : ''}>
    <div class="detail-key">${label}</div>
    <div class="detail-value">${value}</div>
  </div>`
}

function logoHTML(companyLogo: string | undefined, companyName: string, accentColor: string, size = 64): string {
  if (companyLogo) return `<img src="${companyLogo}" alt="${companyName}" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:8px">`
  return `<div style="width:${size}px;height:${size}px;background:${accentColor};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.44)}px;color:white">🏠</div>`
}

// ─── CLASSIC ──────────────────────────────────────────────────
// The original elegant certificate with double border frame

function generateClassicCertificate(args: CertificateArgs): string {
  const {
    companyName, companyLogo, companyAddress, companyPhone, companyEmail,
    licenseNumber, customerName, propertyAddress, proposalNumber, signedAt,
    scopeOfWork, materials, totalAmount,
    accentColor = '#1a5c38', fontFamily = 'EB Garamond', customMessage,
    watermarkEnabled = false, logoAlignment = 'left',
  } = args

  const formattedDate = formatDate(signedAt)
  const certNumber = `CERT-${proposalNumber}`
  const sf = serifFont(fontFamily)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of New Roof Installation — ${propertyAddress}</title>
<style>
  ${fontImport(fontFamily)}

  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f5f3ee;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .page {
    width: 8.5in; min-height: 11in; background: #fffef9;
    position: relative; padding: 0.6in 0.65in;
    display: flex; flex-direction: column;
    box-shadow: 0 4px 40px rgba(0,0,0,0.12);
  }

  /* Outer border frame */
  .page::after {
    content: '';
    position: absolute; inset: 0.25in;
    border: 3px solid ${accentColor};
    pointer-events: none;
  }

  /* Inner border frame */
  .border-inner {
    position: absolute; inset: 0.32in;
    border: 1px solid ${accentColor}88;
    pointer-events: none;
  }

  ${watermarkCSS(watermarkEnabled, companyName, accentColor)}

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 20px; border-bottom: 2px solid ${accentColor}33; margin-bottom: 24px;
    ${logoAlignment === 'center' ? 'flex-direction:column;text-align:center;gap:12px;' : ''}
  }

  .company-block { display: flex; align-items: center; gap: 14px; ${logoAlignment === 'right' ? 'flex-direction:row-reverse;' : ''} }
  .company-name { font-family: ${sf}; font-size: 18px; font-weight: 600; color: #1a1a1a; line-height: 1.2; }
  .company-details { font-size: 11px; color: #666; margin-top: 3px; line-height: 1.5; }

  .cert-number-block { text-align: right; }
  .cert-number-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .cert-number-value { font-size: 13px; font-weight: 600; color: ${accentColor}; margin-top: 2px; }
  .cert-date { font-size: 11px; color: #666; margin-top: 3px; }

  .title-section { text-align: center; padding: 20px 0 28px; }
  .seal-ring {
    display: inline-flex; align-items: center; justify-content: center;
    width: 72px; height: 72px; border-radius: 50%;
    border: 3px solid ${accentColor}; background: ${accentColor}12;
    margin-bottom: 18px; font-size: 32px;
  }
  .cert-title { font-family: ${sf}; font-size: 32px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.1; }
  .cert-subtitle { font-size: 13px; color: #888; margin-top: 6px; letter-spacing: 2px; text-transform: uppercase; }

  .certification-body {
    background: ${accentColor}09; border: 1px solid ${accentColor}33;
    border-radius: 8px; padding: 20px 28px; margin-bottom: 28px; text-align: center;
  }
  .certification-text { font-family: ${sf}; font-size: 15px; color: #2d2d2d; line-height: 1.75; }
  .certification-text strong { color: #1a1a1a; font-weight: 600; }

  .details-section { margin-bottom: 28px; }
  .section-label {
    font-size: 10px; font-weight: 600; color: ${accentColor};
    text-transform: uppercase; letter-spacing: 1.5px;
    margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid ${accentColor}33;
  }
  .detail-row-full {
    display: grid; grid-template-columns: 160px 1fr;
    border-bottom: 1px solid #e5e7eb;
  }
  .detail-row-full:last-child { border-bottom: none; }
  .detail-key {
    padding: 10px 14px; font-size: 11px; font-weight: 600; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.5px;
    border-right: 1px solid #e5e7eb;
  }
  .detail-value { padding: 10px 14px; font-size: 13px; color: #1f2937; }

  .signature-section {
    display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
    margin-top: auto; padding-top: 28px; border-top: 1px solid #e5e7eb;
  }
  .sig-block { display: flex; flex-direction: column; }
  .sig-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 28px; }
  .sig-line { border-top: 1.5px solid #374151; padding-top: 6px; }
  .sig-name { font-size: 12px; font-weight: 600; color: #374151; }
  .sig-title { font-size: 10px; color: #9ca3af; margin-top: 2px; }

  .footer-note {
    margin-top: 20px; padding: 12px 16px;
    background: #fef9c3; border: 1px solid #fde68a; border-radius: 6px;
    font-size: 11px; color: #78350f; text-align: center; line-height: 1.5;
  }
  .footer-note strong { font-weight: 600; }

  ${customMessage ? `.custom-msg { text-align:center; font-style:italic; font-size:13px; color:#555; margin-bottom:20px; padding:12px; }` : ''}

  @media print { body { background: white; padding: 0; } .page { box-shadow: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="border-inner"></div>

  <div class="header">
    <div class="company-block">
      ${logoHTML(companyLogo, companyName, accentColor)}
      <div>
        <div class="company-name">${companyName}</div>
        <div class="company-details">
          ${companyAddress ? `${companyAddress}<br>` : ''}
          ${companyPhone || ''}${companyPhone && companyEmail ? ' &nbsp;·&nbsp; ' : ''}${companyEmail || ''}
        </div>
      </div>
    </div>
    <div class="cert-number-block">
      <div class="cert-number-label">Certificate No.</div>
      <div class="cert-number-value">${certNumber}</div>
      <div class="cert-date">Issued: ${formattedDate}</div>
    </div>
  </div>

  <div class="title-section">
    <div class="seal-ring">🏅</div>
    <div class="cert-title">Certificate of New Roof Installation</div>
    <div class="cert-subtitle">Official Documentation for Insurance Purposes</div>
  </div>

  <div class="certification-body">
    <p class="certification-text">
      This is to certify that <strong>${companyName}</strong> has contracted and
      is scheduled to complete the installation of a new roofing system for
      <strong>${customerName}</strong> at the property located at
      <strong>${propertyAddress}</strong>.
      This agreement was formally executed on <strong>${formattedDate}</strong>
      and constitutes a binding contract for new roof installation services.
    </p>
  </div>

  ${customMessage ? `<div class="custom-msg">${customMessage}</div>` : ''}

  <div class="details-section">
    <div class="section-label">Project Details</div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${detailRows(args, accentColor)}
    </div>
  </div>

  <div class="signature-section">
    <div class="sig-block">
      <div class="sig-label">Authorized by Roofing Contractor</div>
      <div class="sig-line">
        <div class="sig-name">${companyName}</div>
        <div class="sig-title">Licensed Roofing Contractor${licenseNumber ? ` · Lic. #${licenseNumber}` : ''}</div>
      </div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Acknowledged by Homeowner</div>
      <div class="sig-line">
        <div class="sig-name">${customerName}</div>
        <div class="sig-title">Property Owner — Signed ${formattedDate}</div>
      </div>
    </div>
  </div>

  <div class="footer-note">
    <strong>Insurance Notice:</strong> This certificate serves as official documentation confirming
    a new roof installation contract has been executed. Present this document to your insurance provider
    as proof of new roof installation to qualify for applicable premium discounts or coverage updates.
  </div>
</div>
</body>
</html>`
}

// ─── MODERN ───────────────────────────────────────────────────
// Clean sans-serif look with gradient header bar and rounded cards

function generateModernCertificate(args: CertificateArgs): string {
  const {
    companyName, companyLogo, companyAddress, companyPhone, companyEmail,
    licenseNumber, customerName, propertyAddress, proposalNumber, signedAt,
    scopeOfWork, materials, totalAmount,
    accentColor = '#1e40af', secondaryColor = '#3b82f6',
    fontFamily = 'Montserrat', customMessage,
    watermarkEnabled = false, logoAlignment = 'left',
  } = args

  const formattedDate = formatDate(signedAt)
  const certNumber = `CERT-${proposalNumber}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of New Roof Installation — ${propertyAddress}</title>
<style>
  ${fontImport(fontFamily)}
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f0f4f8; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .page {
    width: 8.5in; min-height: 11in; background: #ffffff;
    position: relative; padding: 0;
    display: flex; flex-direction: column;
    box-shadow: 0 8px 40px rgba(0,0,0,0.08); border-radius: 4px; overflow: hidden;
  }

  ${watermarkCSS(watermarkEnabled, companyName, accentColor)}

  /* Gradient header bar */
  .header-bar {
    background: linear-gradient(135deg, ${accentColor}, ${secondaryColor});
    padding: 32px 40px; color: white; position: relative;
  }
  .header-bar::after {
    content: ''; position: absolute; bottom: 0; left: 0; right: 0;
    height: 4px; background: linear-gradient(90deg, ${secondaryColor}, ${accentColor}, ${secondaryColor});
  }
  .header-top {
    display: flex; align-items: center; justify-content: space-between;
    ${logoAlignment === 'center' ? 'flex-direction:column;text-align:center;gap:12px;' : ''}
  }
  .company-block { display: flex; align-items: center; gap: 16px; ${logoAlignment === 'right' ? 'flex-direction:row-reverse;' : ''} }
  .company-name { font-family: 'Montserrat', system-ui, sans-serif; font-size: 20px; font-weight: 700; color: white; }
  .company-details { font-size: 11px; color: rgba(255,255,255,0.85); margin-top: 4px; line-height: 1.5; }
  .cert-badge {
    background: rgba(255,255,255,0.15); backdrop-filter: blur(8px);
    border-radius: 12px; padding: 12px 18px; text-align: center;
  }
  .cert-badge-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(255,255,255,0.7); }
  .cert-badge-value { font-size: 14px; font-weight: 700; color: white; margin-top: 2px; }
  .cert-badge-date { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 2px; }

  .content { padding: 36px 40px; flex: 1; display: flex; flex-direction: column; }

  .title-section { text-align: center; margin-bottom: 32px; }
  .cert-title { font-family: 'Montserrat', system-ui, sans-serif; font-size: 28px; font-weight: 700; color: ${accentColor}; }
  .cert-subtitle {
    font-size: 12px; color: #94a3b8; margin-top: 8px;
    text-transform: uppercase; letter-spacing: 3px;
  }
  .title-line {
    width: 60px; height: 3px; background: linear-gradient(90deg, ${accentColor}, ${secondaryColor});
    margin: 16px auto 0; border-radius: 2px;
  }

  .certification-body {
    background: #f8fafc; border-radius: 12px; padding: 24px 32px;
    margin-bottom: 28px; text-align: center;
    border-left: 4px solid ${accentColor};
  }
  .certification-text { font-size: 14px; color: #334155; line-height: 1.8; }
  .certification-text strong { color: ${accentColor}; font-weight: 600; }

  .details-section { margin-bottom: 28px; }
  .section-label {
    font-size: 11px; font-weight: 700; color: ${accentColor};
    text-transform: uppercase; letter-spacing: 1.5px;
    margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .section-label::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }

  .details-card {
    background: #f8fafc; border-radius: 12px; overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .detail-row-full {
    display: grid; grid-template-columns: 170px 1fr;
    border-bottom: 1px solid #e2e8f0;
  }
  .detail-row-full:last-child { border-bottom: none; }
  .detail-key {
    padding: 12px 16px; font-size: 11px; font-weight: 600; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.5px;
    border-right: 1px solid #e2e8f0; background: white;
  }
  .detail-value { padding: 12px 16px; font-size: 13px; color: #1e293b; }

  .signature-section {
    display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
    margin-top: auto; padding-top: 28px; border-top: 2px solid #e2e8f0;
  }
  .sig-block { display: flex; flex-direction: column; }
  .sig-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 28px; }
  .sig-line { border-top: 2px solid #334155; padding-top: 8px; }
  .sig-name { font-size: 12px; font-weight: 600; color: #334155; }
  .sig-title { font-size: 10px; color: #94a3b8; margin-top: 2px; }

  ${customMessage ? `.custom-msg { text-align:center; font-style:italic; font-size:13px; color:#64748b; margin-bottom:24px; padding:12px 16px; background:#f1f5f9; border-radius:8px; }` : ''}

  .footer-bar {
    background: ${accentColor}; color: white; padding: 14px 40px;
    font-size: 11px; text-align: center; line-height: 1.5;
  }

  @media print { body { background: white; padding: 0; } .page { box-shadow: none; border-radius: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="header-bar">
    <div class="header-top">
      <div class="company-block">
        ${logoHTML(companyLogo, companyName, 'rgba(255,255,255,0.2)')}
        <div>
          <div class="company-name">${companyName}</div>
          <div class="company-details">
            ${companyAddress ? `${companyAddress}<br>` : ''}
            ${companyPhone || ''}${companyPhone && companyEmail ? ' · ' : ''}${companyEmail || ''}
          </div>
        </div>
      </div>
      <div class="cert-badge">
        <div class="cert-badge-label">Certificate No.</div>
        <div class="cert-badge-value">${certNumber}</div>
        <div class="cert-badge-date">${formattedDate}</div>
      </div>
    </div>
  </div>

  <div class="content">
    <div class="title-section">
      <div class="cert-title">Certificate of New Roof Installation</div>
      <div class="cert-subtitle">Official Documentation for Insurance Purposes</div>
      <div class="title-line"></div>
    </div>

    <div class="certification-body">
      <p class="certification-text">
        This is to certify that <strong>${companyName}</strong> has contracted and
        is scheduled to complete the installation of a new roofing system for
        <strong>${customerName}</strong> at the property located at
        <strong>${propertyAddress}</strong>.
        This agreement was formally executed on <strong>${formattedDate}</strong>
        and constitutes a binding contract for new roof installation services.
      </p>
    </div>

    ${customMessage ? `<div class="custom-msg">${customMessage}</div>` : ''}

    <div class="details-section">
      <div class="section-label">Project Details</div>
      <div class="details-card">
        ${detailRows(args, accentColor)}
      </div>
    </div>

    <div class="signature-section">
      <div class="sig-block">
        <div class="sig-label">Authorized by Roofing Contractor</div>
        <div class="sig-line">
          <div class="sig-name">${companyName}</div>
          <div class="sig-title">Licensed Roofing Contractor${licenseNumber ? ` · Lic. #${licenseNumber}` : ''}</div>
        </div>
      </div>
      <div class="sig-block">
        <div class="sig-label">Acknowledged by Homeowner</div>
        <div class="sig-line">
          <div class="sig-name">${customerName}</div>
          <div class="sig-title">Property Owner — Signed ${formattedDate}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer-bar">
    <strong>Insurance Notice:</strong> This certificate serves as official documentation confirming
    a new roof installation contract has been executed. Present to your insurance provider for premium discounts.
  </div>
</div>
</body>
</html>`
}

// ─── BOLD ─────────────────────────────────────────────────────
// Dark header, strong contrast, gold accents — authoritative look

function generateBoldCertificate(args: CertificateArgs): string {
  const {
    companyName, companyLogo, companyAddress, companyPhone, companyEmail,
    licenseNumber, customerName, propertyAddress, proposalNumber, signedAt,
    scopeOfWork, materials, totalAmount,
    accentColor = '#b91c1c', secondaryColor = '#f59e0b',
    fontFamily = 'Playfair Display', customMessage,
    watermarkEnabled = false, logoAlignment = 'left',
  } = args

  const formattedDate = formatDate(signedAt)
  const certNumber = `CERT-${proposalNumber}`
  const sf = serifFont(fontFamily)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of New Roof Installation — ${propertyAddress}</title>
<style>
  ${fontImport(fontFamily)}
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #1a1a1a; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .page {
    width: 8.5in; min-height: 11in; background: #ffffff;
    position: relative; padding: 0;
    display: flex; flex-direction: column;
    box-shadow: 0 12px 60px rgba(0,0,0,0.3);
  }

  ${watermarkCSS(watermarkEnabled, companyName, accentColor)}

  /* Dark top banner */
  .top-banner {
    background: #111827; padding: 36px 44px 28px; color: white;
    border-bottom: 4px solid ${secondaryColor};
  }
  .banner-flex {
    display: flex; align-items: center; justify-content: space-between;
    ${logoAlignment === 'center' ? 'flex-direction:column;text-align:center;gap:16px;' : ''}
  }
  .company-block { display: flex; align-items: center; gap: 16px; ${logoAlignment === 'right' ? 'flex-direction:row-reverse;' : ''} }
  .company-name { font-family: ${sf}; font-size: 22px; font-weight: 700; color: white; letter-spacing: -0.3px; }
  .company-details { font-size: 11px; color: #9ca3af; margin-top: 4px; line-height: 1.5; }

  .cert-seal {
    width: 80px; height: 80px; border-radius: 50%;
    border: 3px solid ${secondaryColor}; background: ${secondaryColor}20;
    display: flex; align-items: center; justify-content: center;
    font-size: 36px; flex-shrink: 0;
  }

  .content { padding: 32px 44px; flex: 1; display: flex; flex-direction: column; }

  .title-section { text-align: center; margin-bottom: 28px; position: relative; }
  .cert-title { font-family: ${sf}; font-size: 34px; font-weight: 700; color: #111827; }
  .cert-subtitle {
    font-size: 12px; color: ${secondaryColor}; margin-top: 8px;
    text-transform: uppercase; letter-spacing: 4px; font-weight: 600;
  }
  .cert-number-line {
    font-size: 12px; color: #6b7280; margin-top: 8px;
  }
  .cert-number-line strong { color: ${accentColor}; }

  .certification-body {
    background: #fffbeb; border: 2px solid ${secondaryColor}44;
    border-radius: 4px; padding: 20px 28px; margin-bottom: 28px; text-align: center;
  }
  .certification-text { font-family: ${sf}; font-size: 15px; color: #1f2937; line-height: 1.8; }
  .certification-text strong { color: ${accentColor}; font-weight: 700; }

  .details-section { margin-bottom: 28px; }
  .section-label {
    font-size: 11px; font-weight: 700; color: #111827;
    text-transform: uppercase; letter-spacing: 2px;
    margin-bottom: 12px; padding-bottom: 8px;
    border-bottom: 2px solid ${secondaryColor};
  }

  .detail-row-full {
    display: grid; grid-template-columns: 170px 1fr;
    border-bottom: 1px solid #e5e7eb;
  }
  .detail-row-full:last-child { border-bottom: none; }
  .detail-key {
    padding: 12px 16px; font-size: 11px; font-weight: 700; color: #374151;
    text-transform: uppercase; letter-spacing: 0.5px;
    border-right: 1px solid #e5e7eb; background: #f9fafb;
  }
  .detail-value { padding: 12px 16px; font-size: 13px; color: #111827; }

  .signature-section {
    display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
    margin-top: auto; padding-top: 28px; border-top: 2px solid #111827;
  }
  .sig-block { display: flex; flex-direction: column; }
  .sig-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin-bottom: 28px; }
  .sig-line { border-top: 2px solid #111827; padding-top: 8px; }
  .sig-name { font-size: 12px; font-weight: 700; color: #111827; }
  .sig-title { font-size: 10px; color: #6b7280; margin-top: 2px; }

  ${customMessage ? `.custom-msg { text-align:center; font-family:${sf}; font-style:italic; font-size:14px; color:#4b5563; margin-bottom:24px; padding:16px; border-left:3px solid ${secondaryColor}; background:#fffbeb; }` : ''}

  .footer-note {
    background: #111827; color: #d1d5db; padding: 14px 44px;
    font-size: 11px; text-align: center; line-height: 1.5;
  }
  .footer-note strong { color: ${secondaryColor}; }

  @media print { body { background: white; padding: 0; } .page { box-shadow: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="top-banner">
    <div class="banner-flex">
      <div class="company-block">
        ${logoHTML(companyLogo, companyName, accentColor)}
        <div>
          <div class="company-name">${companyName}</div>
          <div class="company-details">
            ${companyAddress ? `${companyAddress}<br>` : ''}
            ${companyPhone || ''}${companyPhone && companyEmail ? ' · ' : ''}${companyEmail || ''}
          </div>
        </div>
      </div>
      <div class="cert-seal">🏅</div>
    </div>
  </div>

  <div class="content">
    <div class="title-section">
      <div class="cert-title">Certificate of New Roof Installation</div>
      <div class="cert-subtitle">Official Insurance Documentation</div>
      <div class="cert-number-line">Certificate <strong>${certNumber}</strong> · Issued ${formattedDate}</div>
    </div>

    <div class="certification-body">
      <p class="certification-text">
        This is to certify that <strong>${companyName}</strong> has contracted and
        is scheduled to complete the installation of a new roofing system for
        <strong>${customerName}</strong> at the property located at
        <strong>${propertyAddress}</strong>.
        This agreement was formally executed on <strong>${formattedDate}</strong>
        and constitutes a binding contract for new roof installation services.
      </p>
    </div>

    ${customMessage ? `<div class="custom-msg">${customMessage}</div>` : ''}

    <div class="details-section">
      <div class="section-label">Project Details</div>
      <div style="border:1px solid #e5e7eb;overflow:hidden">
        ${detailRows(args, accentColor)}
      </div>
    </div>

    <div class="signature-section">
      <div class="sig-block">
        <div class="sig-label">Authorized by Roofing Contractor</div>
        <div class="sig-line">
          <div class="sig-name">${companyName}</div>
          <div class="sig-title">Licensed Roofing Contractor${licenseNumber ? ` · Lic. #${licenseNumber}` : ''}</div>
        </div>
      </div>
      <div class="sig-block">
        <div class="sig-label">Acknowledged by Homeowner</div>
        <div class="sig-line">
          <div class="sig-name">${customerName}</div>
          <div class="sig-title">Property Owner — Signed ${formattedDate}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer-note">
    <strong>Insurance Notice:</strong> This certificate serves as official documentation confirming
    a new roof installation contract has been executed. Present to your insurance provider for premium discounts.
  </div>
</div>
</body>
</html>`
}

// ─── MINIMAL ──────────────────────────────────────────────────
// Ultra-clean, lots of whitespace, thin lines, understated elegance

function generateMinimalCertificate(args: CertificateArgs): string {
  const {
    companyName, companyLogo, companyAddress, companyPhone, companyEmail,
    licenseNumber, customerName, propertyAddress, proposalNumber, signedAt,
    scopeOfWork, materials, totalAmount,
    accentColor = '#374151', secondaryColor = '#6b7280',
    fontFamily = 'Lora', customMessage,
    watermarkEnabled = false, logoAlignment = 'left',
  } = args

  const formattedDate = formatDate(signedAt)
  const certNumber = `CERT-${proposalNumber}`
  const sf = serifFont(fontFamily)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of New Roof Installation — ${propertyAddress}</title>
<style>
  ${fontImport(fontFamily)}
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f8f8f8; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .page {
    width: 8.5in; min-height: 11in; background: #ffffff;
    position: relative; padding: 0.8in 0.75in;
    display: flex; flex-direction: column;
    box-shadow: 0 2px 20px rgba(0,0,0,0.06);
  }

  ${watermarkCSS(watermarkEnabled, companyName, accentColor)}

  .header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding-bottom: 24px; margin-bottom: 32px;
    border-bottom: 1px solid #e5e5e5;
    ${logoAlignment === 'center' ? 'flex-direction:column;align-items:center;text-align:center;gap:12px;' : ''}
  }
  .company-block { display: flex; align-items: center; gap: 14px; ${logoAlignment === 'right' ? 'flex-direction:row-reverse;' : ''} }
  .company-name { font-family: ${sf}; font-size: 16px; font-weight: 600; color: #1a1a1a; }
  .company-details { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.6; }
  .cert-meta { text-align: right; font-size: 11px; color: #999; line-height: 1.8; }
  .cert-meta strong { color: ${accentColor}; font-weight: 600; }

  .title-section { text-align: center; margin-bottom: 40px; }
  .cert-title { font-family: ${sf}; font-size: 26px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.3px; }
  .title-rule { width: 40px; height: 1px; background: ${accentColor}; margin: 16px auto; }
  .cert-subtitle { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 3px; }

  .certification-body {
    max-width: 520px; margin: 0 auto 36px;
    text-align: center;
  }
  .certification-text { font-family: ${sf}; font-size: 14px; color: #444; line-height: 2; }
  .certification-text strong { color: #1a1a1a; font-weight: 600; }

  .details-section { margin-bottom: 36px; }
  .section-label {
    font-size: 9px; font-weight: 600; color: #bbb;
    text-transform: uppercase; letter-spacing: 2px;
    margin-bottom: 12px;
  }

  .detail-row-full {
    display: grid; grid-template-columns: 150px 1fr;
    border-bottom: 1px solid #f0f0f0;
  }
  .detail-row-full:last-child { border-bottom: none; }
  .detail-key {
    padding: 10px 0; font-size: 10px; font-weight: 500; color: #999;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .detail-value { padding: 10px 0; font-size: 13px; color: #333; }

  .signature-section {
    display: grid; grid-template-columns: 1fr 1fr; gap: 48px;
    margin-top: auto; padding-top: 36px;
  }
  .sig-block { display: flex; flex-direction: column; }
  .sig-label { font-size: 9px; color: #bbb; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 32px; }
  .sig-line { border-top: 1px solid #ccc; padding-top: 8px; }
  .sig-name { font-size: 12px; font-weight: 500; color: #333; }
  .sig-title { font-size: 10px; color: #aaa; margin-top: 2px; }

  ${customMessage ? `.custom-msg { text-align:center; font-family:${sf}; font-style:italic; font-size:13px; color:#888; margin-bottom:28px; }` : ''}

  .footer-note {
    margin-top: 24px; font-size: 10px; color: #bbb;
    text-align: center; line-height: 1.6; padding-top: 16px;
    border-top: 1px solid #e5e5e5;
  }

  @media print { body { background: white; padding: 0; } .page { box-shadow: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="company-block">
      ${logoHTML(companyLogo, companyName, accentColor, 48)}
      <div>
        <div class="company-name">${companyName}</div>
        <div class="company-details">
          ${companyAddress ? `${companyAddress}<br>` : ''}
          ${companyPhone || ''}${companyPhone && companyEmail ? ' · ' : ''}${companyEmail || ''}
        </div>
      </div>
    </div>
    <div class="cert-meta">
      Certificate <strong>${certNumber}</strong><br>
      Issued ${formattedDate}
    </div>
  </div>

  <div class="title-section">
    <div class="cert-title">Certificate of New Roof Installation</div>
    <div class="title-rule"></div>
    <div class="cert-subtitle">Insurance Documentation</div>
  </div>

  <div class="certification-body">
    <p class="certification-text">
      This is to certify that <strong>${companyName}</strong> has contracted and
      is scheduled to complete the installation of a new roofing system for
      <strong>${customerName}</strong> at the property located at
      <strong>${propertyAddress}</strong>.
      This agreement was formally executed on <strong>${formattedDate}</strong>
      and constitutes a binding contract for new roof installation services.
    </p>
  </div>

  ${customMessage ? `<div class="custom-msg">${customMessage}</div>` : ''}

  <div class="details-section">
    <div class="section-label">Project Details</div>
    ${detailRows(args, accentColor)}
  </div>

  <div class="signature-section">
    <div class="sig-block">
      <div class="sig-label">Authorized by Roofing Contractor</div>
      <div class="sig-line">
        <div class="sig-name">${companyName}</div>
        <div class="sig-title">Licensed Roofing Contractor${licenseNumber ? ` · Lic. #${licenseNumber}` : ''}</div>
      </div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Acknowledged by Homeowner</div>
      <div class="sig-line">
        <div class="sig-name">${customerName}</div>
        <div class="sig-title">Property Owner — Signed ${formattedDate}</div>
      </div>
    </div>
  </div>

  <div class="footer-note">
    This certificate serves as official documentation confirming a new roof installation
    contract has been executed. Present to your insurance provider for applicable premium discounts.
  </div>
</div>
</body>
</html>`
}
