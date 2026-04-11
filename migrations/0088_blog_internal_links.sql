-- Migration 0088: Append "Further Reading" internal link sections to blog posts
-- Creates hub-and-spoke clusters across the 30+ post library
-- Each section is appended to existing content (not replacing it)

-- ── EAGLEVIEW COMPARISON CLUSTER ─────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0;space-y:8px">
    <li style="margin-bottom:8px"><a href="/blog/roofmanager-vs-eagleview-accuracy-price" style="color:#00FF88;text-decoration:underline;font-weight:600">RoofManager vs EagleView: Accuracy, Price &amp; Speed — Full 2026 Comparison</a></li>
    <li style="margin-bottom:8px"><a href="/blog/best-roof-measurement-software-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">Best Roof Measurement Software in 2026: Compared for Roofing Contractors</a></li>
    <li><a href="/cheaper-alternative-to-eagleview" style="color:#00FF88;text-decoration:underline;font-weight:600">Cheaper Alternative to EagleView for Canadian Contractors →</a></li>
  </ul>
</div>'
WHERE slug = 'eagleview-cost-2026-alternatives';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/eagleview-cost-2026-alternatives" style="color:#00FF88;text-decoration:underline;font-weight:600">How Much Does EagleView Cost in 2026? (And Cheaper Alternatives)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/best-roof-measurement-software-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">Best Roof Measurement Software in 2026: Full Comparison</a></li>
    <li><a href="/features/measurements" style="color:#00FF88;text-decoration:underline;font-weight:600">See Roof Manager''s AI Measurement Reports →</a></li>
  </ul>
</div>'
WHERE slug = 'roofmanager-vs-eagleview-accuracy-price';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/eagleview-cost-2026-alternatives" style="color:#00FF88;text-decoration:underline;font-weight:600">How Much Does EagleView Cost in 2026?</a></li>
    <li style="margin-bottom:8px"><a href="/blog/roofing-crm-software-comparison-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">Best CRM for Roofing Contractors 2026: JobNimbus vs AccuLynx vs Roof Manager</a></li>
    <li><a href="/features/measurements" style="color:#00FF88;text-decoration:underline;font-weight:600">Try Roof Manager Free — 3 Reports →</a></li>
  </ul>
</div>'
WHERE slug = 'best-roof-measurement-software-2026';

-- ── CRM CLUSTER ───────────────────────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.15)">
  <p style="font-size:12px;font-weight:700;color:#22d3ee;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/best-roof-measurement-software-2026" style="color:#22d3ee;text-decoration:underline;font-weight:600">Best Roof Measurement Software in 2026</a></li>
    <li style="margin-bottom:8px"><a href="/blog/roofing-estimate-accuracy-guide" style="color:#22d3ee;text-decoration:underline;font-weight:600">Why Your Roofing Estimates Are Off (And How to Fix It)</a></li>
    <li><a href="/features/crm" style="color:#22d3ee;text-decoration:underline;font-weight:600">Explore Roof Manager''s Free Roofing CRM →</a></li>
  </ul>
</div>'
WHERE slug = 'roofing-crm-software-comparison-2026';

-- ── EDUCATIONAL / MEASUREMENT CLUSTER ────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/roof-pitch-calculator-guide" style="color:#00FF88;text-decoration:underline;font-weight:600">Roof Pitch Calculator: A Complete Guide for Roofing Contractors</a></li>
    <li style="margin-bottom:8px"><a href="/blog/what-is-a-material-takeoff-roofing" style="color:#00FF88;text-decoration:underline;font-weight:600">What Is a Material Takeoff in Roofing? (And How AI Does It in 60 Seconds)</a></li>
    <li><a href="/features/measurements" style="color:#00FF88;text-decoration:underline;font-weight:600">Get a Free AI Roof Measurement Report →</a></li>
  </ul>
</div>'
WHERE slug = 'how-to-measure-a-roof-without-climbing-2026';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It (3 Methods)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/what-is-a-material-takeoff-roofing" style="color:#00FF88;text-decoration:underline;font-weight:600">What Is a Material Takeoff in Roofing?</a></li>
    <li><a href="/blog/roofing-estimate-accuracy-guide" style="color:#00FF88;text-decoration:underline;font-weight:600">Why Your Roofing Estimates Are Off (And How to Fix It)</a></li>
  </ul>
</div>'
WHERE slug = 'roof-pitch-calculator-guide';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/roof-pitch-calculator-guide" style="color:#00FF88;text-decoration:underline;font-weight:600">Roof Pitch Calculator: A Complete Guide</a></li>
    <li style="margin-bottom:8px"><a href="/blog/roofing-estimate-accuracy-guide" style="color:#00FF88;text-decoration:underline;font-weight:600">Why Your Roofing Estimates Are Off (And How to Fix It)</a></li>
    <li><a href="/features/measurements" style="color:#00FF88;text-decoration:underline;font-weight:600">See How AI Generates Material BOMs in 60 Seconds →</a></li>
  </ul>
</div>'
WHERE slug = 'what-is-a-material-takeoff-roofing';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It (2026)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/roof-pitch-calculator-guide" style="color:#00FF88;text-decoration:underline;font-weight:600">Roof Pitch Calculator Guide</a></li>
    <li><a href="/blog/what-is-a-material-takeoff-roofing" style="color:#00FF88;text-decoration:underline;font-weight:600">What Is a Material Takeoff in Roofing?</a></li>
  </ul>
</div>'
WHERE slug = 'roofing-estimate-accuracy-guide';

-- ── AI / ACCURACY CLUSTER ──────────────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15)">
  <p style="font-size:12px;font-weight:700;color:#00FF88;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#00FF88;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It (3 Methods)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/eagleview-cost-2026-alternatives" style="color:#00FF88;text-decoration:underline;font-weight:600">How Much Does EagleView Cost? (And Cheaper Alternatives)</a></li>
    <li><a href="/features/measurements" style="color:#00FF88;text-decoration:underline;font-weight:600">Try a Free AI Roof Measurement Report →</a></li>
  </ul>
</div>'
WHERE slug = 'ai-roof-measurement-accuracy-explained';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#f59e0b;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist for Contractors (2026)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/alberta-hail-wind-roofing-estimate-automation" style="color:#f59e0b;text-decoration:underline;font-weight:600">Alberta Hail &amp; Wind Damage Estimating: How AI Is Changing the Game</a></li>
    <li><a href="/features/ai-secretary" style="color:#f59e0b;text-decoration:underline;font-weight:600">Meet Your 24/7 AI Roofer Secretary →</a></li>
  </ul>
</div>'
WHERE slug = 'how-ai-phone-receptionist-works-roofing';

-- ── STORM / INSURANCE CLUSTER ─────────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/insurance-roof-claim-documentation-guide" style="color:#f59e0b;text-decoration:underline;font-weight:600">How to Document Roof Damage for Insurance Claims</a></li>
    <li style="margin-bottom:8px"><a href="/blog/alberta-hail-wind-roofing-estimate-automation" style="color:#f59e0b;text-decoration:underline;font-weight:600">Alberta Hail &amp; Wind Damage Estimating with AI</a></li>
    <li><a href="/features/ai-secretary" style="color:#f59e0b;text-decoration:underline;font-weight:600">Capture Every Storm Lead with AI Secretary →</a></li>
  </ul>
</div>'
WHERE slug = 'storm-damage-roof-inspection-checklist-2026';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#f59e0b;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist for Contractors</a></li>
    <li style="margin-bottom:8px"><a href="/blog/ai-roof-measurement-accuracy-explained" style="color:#f59e0b;text-decoration:underline;font-weight:600">How Accurate Are AI Roof Measurement Reports?</a></li>
    <li><a href="/features/measurements" style="color:#f59e0b;text-decoration:underline;font-weight:600">Generate a Report for Any Property in 60 Seconds →</a></li>
  </ul>
</div>'
WHERE slug = 'insurance-roof-claim-documentation-guide';

-- ── CITY GUIDES / GEO CLUSTER ─────────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.15)">
  <p style="font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/alberta-hail-wind-roofing-estimate-automation" style="color:#a78bfa;text-decoration:underline;font-weight:600">Alberta Hail &amp; Wind Damage Estimating with AI</a></li>
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#a78bfa;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist</a></li>
    <li><a href="/features/measurements/calgary" style="color:#a78bfa;text-decoration:underline;font-weight:600">Roof Manager for Calgary Contractors →</a></li>
  </ul>
</div>'
WHERE slug = 'roof-measurement-reports-calgary-contractors';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.15)">
  <p style="font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/roof-measurement-reports-calgary-contractors" style="color:#a78bfa;text-decoration:underline;font-weight:600">How Calgary Roofing Contractors Are Saving $1,500+/Month</a></li>
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#a78bfa;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist</a></li>
    <li><a href="/features/measurements/edmonton" style="color:#a78bfa;text-decoration:underline;font-weight:600">Roof Manager for Edmonton Contractors →</a></li>
  </ul>
</div>'
WHERE slug = 'edmonton-roofing-software-guide-2026';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.15)">
  <p style="font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#a78bfa;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist for Contractors</a></li>
    <li style="margin-bottom:8px"><a href="/blog/insurance-roof-claim-documentation-guide" style="color:#a78bfa;text-decoration:underline;font-weight:600">How to Document Roof Damage for Insurance Claims</a></li>
    <li><a href="/features/measurements/houston" style="color:#a78bfa;text-decoration:underline;font-weight:600">Roof Manager for Houston Contractors →</a></li>
  </ul>
</div>'
WHERE slug = 'houston-roofing-software-guide-2026';

-- ── GEO-BLOG POSTS (0085) ─────────────────────────────────────────────────────

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/roof-measurement-reports-calgary-contractors" style="color:#f59e0b;text-decoration:underline;font-weight:600">How Calgary Contractors Are Saving $1,500+/Month on Measurements</a></li>
    <li style="margin-bottom:8px"><a href="/blog/storm-damage-roof-inspection-checklist-2026" style="color:#f59e0b;text-decoration:underline;font-weight:600">Storm Damage Roof Inspection Checklist for Contractors</a></li>
    <li><a href="/features/measurements/calgary" style="color:#f59e0b;text-decoration:underline;font-weight:600">AI Roof Measurement Software in Calgary &amp; Edmonton →</a></li>
  </ul>
</div>'
WHERE slug = 'alberta-hail-wind-roofing-estimate-automation';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.15)">
  <p style="font-size:12px;font-weight:700;color:#22d3ee;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#22d3ee;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It (3 Methods)</a></li>
    <li style="margin-bottom:8px"><a href="/blog/roof-pitch-calculator-guide" style="color:#22d3ee;text-decoration:underline;font-weight:600">Roof Pitch Calculator: What 1/4" per Foot Actually Means</a></li>
    <li><a href="/features/measurements/vancouver" style="color:#22d3ee;text-decoration:underline;font-weight:600">AI Roof Measurement Software in Vancouver, BC →</a></li>
  </ul>
</div>'
WHERE slug = 'vancouver-flat-roof-drainage-measurement';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.15)">
  <p style="font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#a78bfa;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It</a></li>
    <li style="margin-bottom:8px"><a href="/blog/insurance-roof-claim-documentation-guide" style="color:#a78bfa;text-decoration:underline;font-weight:600">How to Document Roof Damage for Insurance Claims</a></li>
    <li><a href="/features/measurements" style="color:#a78bfa;text-decoration:underline;font-weight:600">AI Measurement Reports with Built-In QST Handling →</a></li>
  </ul>
</div>'
WHERE slug = 'quebec-ice-dam-prevention-roofing';

UPDATE blog_posts SET content = content || '
<hr/>
<div class="rm-further-reading not-prose my-8 rounded-2xl p-6" style="background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.15)">
  <p style="font-size:12px;font-weight:700;color:#22d3ee;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px"><i class="fas fa-book-open" style="margin-right:6px"></i>Further Reading</p>
  <ul style="list-style:none;padding:0;margin:0">
    <li style="margin-bottom:8px"><a href="/blog/how-to-measure-a-roof-without-climbing-2026" style="color:#22d3ee;text-decoration:underline;font-weight:600">How to Measure a Roof Without Climbing It</a></li>
    <li style="margin-bottom:8px"><a href="/blog/insurance-roof-claim-documentation-guide" style="color:#22d3ee;text-decoration:underline;font-weight:600">How to Document Roof Damage for Insurance Claims</a></li>
    <li><a href="/features/measurements" style="color:#22d3ee;text-decoration:underline;font-weight:600">AI Roof Measurement Reports — Native HST Handling →</a></li>
  </ul>
</div>'
WHERE slug = 'atlantic-canada-coastal-roofing-estimates';
