// Certificate of New Roof Installation — HTML template
// Returns a print-ready HTML document (letter format) for insurance documentation.

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

export function generateRoofInstallationCertificateHTML(args: CertificateArgs): string {
  const {
    companyName,
    companyLogo,
    companyAddress,
    companyPhone,
    companyEmail,
    licenseNumber,
    customerName,
    propertyAddress,
    proposalNumber,
    signedAt,
    scopeOfWork,
    materials,
    totalAmount,
    accentColor = '#1a5c38',
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
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap');

  @page {
    size: letter;
    margin: 0;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f5f3ee;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 20px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 8.5in;
    min-height: 11in;
    background: #fffef9;
    position: relative;
    padding: 0.6in 0.65in;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 40px rgba(0,0,0,0.12);
  }

  /* Outer border frame */
  .page::before {
    content: '';
    position: absolute;
    inset: 0.25in;
    border: 3px solid ${accentColor};
    pointer-events: none;
  }

  /* Inner border frame */
  .page::after {
    content: '';
    position: absolute;
    inset: 0.32in;
    border: 1px solid ${accentColor}88;
    pointer-events: none;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 20px;
    border-bottom: 2px solid ${accentColor}33;
    margin-bottom: 24px;
  }

  .company-block {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .company-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 8px;
  }

  .company-logo-placeholder {
    width: 64px;
    height: 64px;
    background: ${accentColor};
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: white;
  }

  .company-name {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
    line-height: 1.2;
  }

  .company-details {
    font-size: 11px;
    color: #666;
    margin-top: 3px;
    line-height: 1.5;
  }

  .cert-number-block {
    text-align: right;
  }

  .cert-number-label {
    font-size: 10px;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .cert-number-value {
    font-size: 13px;
    font-weight: 600;
    color: ${accentColor};
    margin-top: 2px;
  }

  .cert-date {
    font-size: 11px;
    color: #666;
    margin-top: 3px;
  }

  /* ── Seal / Title Area ── */
  .title-section {
    text-align: center;
    padding: 20px 0 28px;
  }

  .seal-ring {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: 3px solid ${accentColor};
    background: ${accentColor}12;
    margin-bottom: 18px;
    font-size: 32px;
  }

  .cert-title {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: 32px;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: -0.5px;
    line-height: 1.1;
  }

  .cert-subtitle {
    font-size: 13px;
    color: #888;
    margin-top: 6px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* ── Certification Text ── */
  .certification-body {
    background: ${accentColor}09;
    border: 1px solid ${accentColor}33;
    border-radius: 8px;
    padding: 20px 28px;
    margin-bottom: 28px;
    text-align: center;
  }

  .certification-text {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: 15px;
    color: #2d2d2d;
    line-height: 1.75;
  }

  .certification-text strong {
    color: #1a1a1a;
    font-weight: 600;
  }

  /* ── Details Table ── */
  .details-section {
    margin-bottom: 28px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    color: ${accentColor};
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${accentColor}33;
  }

  .details-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  .detail-row {
    display: contents;
  }

  .detail-row:nth-child(even) .detail-key,
  .detail-row:nth-child(even) .detail-value {
    background: #f9fafb;
  }

  .detail-key {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
  }

  .detail-value {
    padding: 10px 14px;
    font-size: 13px;
    color: #1f2937;
    border-bottom: 1px solid #e5e7eb;
  }

  .detail-row:last-child .detail-key,
  .detail-row:last-child .detail-value {
    border-bottom: none;
  }

  /* Full-width detail rows */
  .detail-row-full .detail-key,
  .detail-row-full .detail-value {
    grid-column: span 1;
  }

  .detail-row-full {
    display: grid;
    grid-template-columns: 160px 1fr;
    border-bottom: 1px solid #e5e7eb;
  }

  .detail-row-full:last-child {
    border-bottom: none;
  }

  .detail-row-full .detail-key {
    border-right: 1px solid #e5e7eb;
    border-bottom: none;
  }

  .detail-row-full .detail-value {
    border-bottom: none;
  }

  /* ── Total Highlight ── */
  .total-row .detail-value {
    font-size: 15px;
    font-weight: 700;
    color: ${accentColor};
  }

  /* ── Signature Area ── */
  .signature-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    margin-top: auto;
    padding-top: 28px;
    border-top: 1px solid #e5e7eb;
  }

  .sig-block {
    display: flex;
    flex-direction: column;
  }

  .sig-label {
    font-size: 10px;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 28px;
  }

  .sig-line {
    border-top: 1.5px solid #374151;
    padding-top: 6px;
  }

  .sig-name {
    font-size: 12px;
    font-weight: 600;
    color: #374151;
  }

  .sig-title {
    font-size: 10px;
    color: #9ca3af;
    margin-top: 2px;
  }

  /* ── Footer Note ── */
  .footer-note {
    margin-top: 20px;
    padding: 12px 16px;
    background: #fef9c3;
    border: 1px solid #fde68a;
    border-radius: 6px;
    font-size: 11px;
    color: #78350f;
    text-align: center;
    line-height: 1.5;
  }

  .footer-note strong {
    font-weight: 600;
  }

  @media print {
    body {
      background: white;
      padding: 0;
    }
    .page {
      box-shadow: none;
      width: 8.5in;
      min-height: 11in;
    }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="company-block">
      ${companyLogo
        ? `<img src="${companyLogo}" alt="${companyName}" class="company-logo">`
        : `<div class="company-logo-placeholder">🏠</div>`
      }
      <div>
        <div class="company-name">${companyName}</div>
        <div class="company-details">
          ${companyAddress ? `${companyAddress}<br>` : ''}
          ${companyPhone ? `${companyPhone}` : ''}
          ${companyPhone && companyEmail ? ' &nbsp;·&nbsp; ' : ''}
          ${companyEmail ? `${companyEmail}` : ''}
        </div>
      </div>
    </div>
    <div class="cert-number-block">
      <div class="cert-number-label">Certificate No.</div>
      <div class="cert-number-value">${certNumber}</div>
      <div class="cert-date">Issued: ${formattedDate}</div>
    </div>
  </div>

  <!-- Title -->
  <div class="title-section">
    <div class="seal-ring">🏅</div>
    <div class="cert-title">Certificate of New Roof Installation</div>
    <div class="cert-subtitle">Official Documentation for Insurance Purposes</div>
  </div>

  <!-- Certification Body Text -->
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

  <!-- Details -->
  <div class="details-section">
    <div class="section-label">Project Details</div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">

      <div class="detail-row-full">
        <div class="detail-key">Homeowner / Client</div>
        <div class="detail-value">${customerName}</div>
      </div>

      <div class="detail-row-full" style="background:#f9fafb">
        <div class="detail-key">Property Address</div>
        <div class="detail-value">${propertyAddress}</div>
      </div>

      <div class="detail-row-full">
        <div class="detail-key">Contract Number</div>
        <div class="detail-value">${proposalNumber}</div>
      </div>

      ${licenseNumber ? `
      <div class="detail-row-full" style="background:#f9fafb">
        <div class="detail-key">Contractor License #</div>
        <div class="detail-value" style="font-weight:600">${licenseNumber}</div>
      </div>
      ` : ''}

      <div class="detail-row-full" style="${licenseNumber ? '' : 'background:#f9fafb'}">
        <div class="detail-key">Execution Date</div>
        <div class="detail-value">${formattedDate}</div>
      </div>

      ${scopeOfWork ? `
      <div class="detail-row-full">
        <div class="detail-key">Scope of Work</div>
        <div class="detail-value">${scopeOfWork}</div>
      </div>
      ` : ''}

      ${materials ? `
      <div class="detail-row-full" style="${scopeOfWork ? 'background:#f9fafb' : ''}">
        <div class="detail-key">Materials</div>
        <div class="detail-value">${materials}</div>
      </div>
      ` : ''}

      ${totalAmount !== undefined && totalAmount !== null ? `
      <div class="detail-row-full total-row" style="background:${accentColor}08">
        <div class="detail-key" style="color:${accentColor};border-bottom:none">Contract Value</div>
        <div class="detail-value" style="border-bottom:none">${formatCurrency(totalAmount)}</div>
      </div>
      ` : ''}

    </div>
  </div>

  <!-- Signatures -->
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

  <!-- Footer Note -->
  <div class="footer-note">
    <strong>Insurance Notice:</strong> This certificate serves as official documentation confirming
    a new roof installation contract has been executed. Present this document to your insurance provider
    as proof of new roof installation to qualify for applicable premium discounts or coverage updates.
  </div>

</div>
</body>
</html>`
}
