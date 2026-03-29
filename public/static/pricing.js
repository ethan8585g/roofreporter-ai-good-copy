// ============================================================
// Pricing Page — Membership plans + report credit packs
// Plans: Free / Pro ($49.99/mo) / Pro Plus ($199/mo) / Enterprise (contact)
// Report packs: 1=$5, 25=$106.25, 100=$350 (USD)
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('pricing-root');
  if (!root) return;

  try {
    const res = await fetch('/api/square/packages');
    const data = await res.json();
    const packages = data.packages || [];
    renderPricing(root, packages);
  } catch (e) {
    root.innerHTML = '<div class="text-center text-red-500 py-8">Failed to load pricing. Please try again.</div>';
  }
});

function renderPricing(root, packages) {
  root.innerHTML = `
    <!-- Free Reports Banner -->
    <div class="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-8 mb-12 text-white text-center shadow-lg">
      <div class="flex items-center justify-center gap-3 mb-3">
        <i class="fas fa-gift text-3xl"></i>
        <h2 class="text-3xl font-extrabold">3 Free Reports When You Sign Up</h2>
      </div>
      <p class="text-green-100 text-lg mb-6">No credit card required. Create an account and get 3 professional roof measurement reports — completely free.</p>
      <a href="/customer/login" class="inline-flex items-center gap-2 bg-white text-green-700 font-bold py-3 px-8 rounded-xl text-lg shadow-lg transition-all hover:scale-105 hover:bg-green-50">
        <i class="fas fa-user-plus"></i>
        Sign Up Free
      </a>
    </div>

    <div class="text-center mb-12">
      <h1 class="text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h1>
      <p class="text-lg text-gray-600 max-w-2xl mx-auto">Start with 3 free reports. Choose a membership plan, then buy report credits as you need them.</p>
    </div>

    <!-- Membership Plans -->
    <h2 class="text-2xl font-bold text-gray-800 mb-2 text-center">Membership Plans</h2>
    <p class="text-center text-gray-500 mb-8">Report credits are purchased separately and work with any plan.</p>
    <div class="grid md:grid-cols-4 gap-5 mb-16 max-w-6xl mx-auto">

      <!-- Free -->
      <div class="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col">
        <div class="mb-4">
          <span class="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold">FREE</span>
        </div>
        <h3 class="text-xl font-black text-gray-900 mb-1">Free</h3>
        <div class="mb-4">
          <span class="text-4xl font-black text-gray-900">$0</span>
          <span class="text-gray-400 text-sm ml-1">/month</span>
        </div>
        <ul class="space-y-2 text-sm text-gray-600 mb-6 flex-1">
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>3 free trial reports</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Buy reports individually ($5 USD each)</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Full CRM suite</li>
          <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5"></i>No team members</li>
          <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5"></i>Includes platform ads</li>
        </ul>
        <a href="/customer/login" class="block w-full py-2.5 text-center font-bold rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition-all">
          Get Started Free
        </a>
      </div>

      <!-- Pro -->
      <div class="bg-gradient-to-br from-brand-800 to-brand-900 rounded-2xl p-6 flex flex-col relative ring-2 ring-brand-500 shadow-xl">
        <div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-500 text-white px-4 py-1 rounded-full text-xs font-bold">MOST POPULAR</div>
        <div class="mb-4">
          <span class="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-bold"><i class="fas fa-crown mr-1"></i>PRO</span>
        </div>
        <h3 class="text-xl font-black text-white mb-1">Pro</h3>
        <div class="mb-4">
          <span class="text-4xl font-black text-white">$49.99</span>
          <span class="text-brand-300 text-sm ml-1">/month USD</span>
        </div>
        <ul class="space-y-2 text-sm text-brand-100 mb-6 flex-1">
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Up to 5 team members</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>No ads</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Full CRM suite</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Custom branding on reports</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Priority support</li>
        </ul>
        <a href="/customer/login" class="block w-full py-2.5 text-center font-bold rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-sm transition-all hover:scale-[1.02] shadow-lg">
          <i class="fas fa-rocket mr-1"></i>Get Pro
        </a>
      </div>

      <!-- Pro Plus -->
      <div class="bg-white rounded-2xl border border-purple-200 ring-2 ring-purple-200 p-6 flex flex-col relative">
        <div class="mb-4">
          <span class="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-bold"><i class="fas fa-star mr-1"></i>PRO PLUS</span>
        </div>
        <h3 class="text-xl font-black text-gray-900 mb-1">Pro Plus</h3>
        <div class="mb-4">
          <span class="text-4xl font-black text-gray-900">$199</span>
          <span class="text-gray-400 text-sm ml-1">/month USD</span>
        </div>
        <ul class="space-y-2 text-sm text-gray-600 mb-6 flex-1">
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Up to 25 team members</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>No ads</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Full CRM suite</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Custom branding on reports</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>Priority support</li>
        </ul>
        <a href="/customer/login" class="block w-full py-2.5 text-center font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm transition-all hover:scale-[1.02]">
          <i class="fas fa-star mr-1"></i>Get Pro Plus
        </a>
      </div>

      <!-- Enterprise -->
      <div class="bg-gray-900 rounded-2xl border border-gray-700 p-6 flex flex-col">
        <div class="mb-4">
          <span class="px-3 py-1 bg-gray-700 text-gray-200 rounded-full text-xs font-bold"><i class="fas fa-building mr-1"></i>ENTERPRISE</span>
        </div>
        <h3 class="text-xl font-black text-white mb-1">Enterprise</h3>
        <div class="mb-4">
          <span class="text-2xl font-black text-white">Contact Us</span>
        </div>
        <ul class="space-y-2 text-sm text-gray-300 mb-6 flex-1">
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Unlimited team members</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>No ads</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Dedicated onboarding</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>Custom pricing on reports</li>
          <li class="flex items-start gap-2"><i class="fas fa-check text-green-400 mt-0.5"></i>SLA & priority support</li>
        </ul>
        <a href="mailto:support@roofreporterai.com" class="block w-full py-2.5 text-center font-bold rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm transition-all">
          <i class="fas fa-envelope mr-1"></i>Contact for Pricing
        </a>
      </div>
    </div>

    <!-- Report Credit Packs -->
    <h2 class="text-2xl font-bold text-gray-800 mb-2 text-center">Report Credit Packs</h2>
    <p class="text-center text-gray-500 mb-8">Credits work with any plan. Buy in bulk and save — credits never expire.</p>
    <div class="grid md:grid-cols-3 gap-5 mb-16 max-w-4xl mx-auto">
      ${packages.map((pkg, i) => {
        const priceUsd = (pkg.price_cents / 100).toFixed(2);
        const priceEach = (pkg.price_cents / 100 / pkg.credits).toFixed(2);
        const isBest = pkg.credits >= 100;
        const isPopular = pkg.credits === 25;
        return `
          <div class="bg-white rounded-xl border ${isBest ? 'border-brand-500 ring-2 ring-brand-200' : isPopular ? 'border-accent-400 ring-2 ring-accent-200' : 'border-gray-200'} p-6 text-center hover:shadow-md transition-shadow relative flex flex-col">
            ${isBest ? '<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-500 text-white px-3 py-0.5 rounded-full text-[10px] font-bold">BEST VALUE</div>' : ''}
            ${isPopular ? '<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent-500 text-white px-3 py-0.5 rounded-full text-[10px] font-bold">POPULAR</div>' : ''}
            <h3 class="font-black text-gray-800 text-lg mb-1">${pkg.name}</h3>
            <div class="text-xs text-gray-400 mb-3">${pkg.credits} ${pkg.credits === 1 ? 'report' : 'reports'}</div>
            <div class="mb-1">
              <span class="text-4xl font-black text-gray-900">$${priceUsd}</span>
              <span class="text-gray-400 text-xs ml-1">USD</span>
            </div>
            <p class="text-sm font-semibold text-brand-600 mb-4">$${priceEach}/report</p>
            <a href="/customer/login" class="block w-full py-2.5 mt-auto ${isBest ? 'bg-brand-600 hover:bg-brand-700' : isPopular ? 'bg-accent-500 hover:bg-accent-600' : 'bg-sky-600 hover:bg-sky-700'} text-white font-bold rounded-lg text-sm transition-all hover:scale-[1.02]">
              Buy ${pkg.credits === 1 ? '1 Credit' : pkg.credits + ' Credits'}
            </a>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Plan comparison table -->
    <div class="max-w-5xl mx-auto mb-12">
      <h2 class="text-xl font-bold text-gray-800 mb-6 text-center">Plan Comparison</h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left px-6 py-3 font-semibold text-gray-700">Feature</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Free</th>
              <th class="text-center px-4 py-3 font-semibold text-brand-700 bg-brand-50">Pro</th>
              <th class="text-center px-4 py-3 font-semibold text-purple-700">Pro Plus</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Enterprise</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">Monthly Price</td>
              <td class="text-center px-4 py-3 text-gray-500">$0</td>
              <td class="text-center px-4 py-3 font-bold text-brand-700 bg-brand-50/50">$49.99 USD</td>
              <td class="text-center px-4 py-3 font-bold text-purple-700">$199 USD</td>
              <td class="text-center px-4 py-3 text-gray-500">Contact</td>
            </tr>
            <tr class="bg-gray-50/50">
              <td class="px-6 py-3 font-medium text-gray-800">Free Trial Reports</td>
              <td class="text-center px-4 py-3">3</td>
              <td class="text-center px-4 py-3 bg-brand-50/50">3</td>
              <td class="text-center px-4 py-3">3</td>
              <td class="text-center px-4 py-3">Custom</td>
            </tr>
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">Team Members</td>
              <td class="text-center px-4 py-3 text-red-400"><i class="fas fa-times"></i></td>
              <td class="text-center px-4 py-3 font-semibold text-brand-700 bg-brand-50/50">Up to 5</td>
              <td class="text-center px-4 py-3 font-semibold text-purple-700">Up to 25</td>
              <td class="text-center px-4 py-3 font-semibold text-gray-700">Unlimited</td>
            </tr>
            <tr class="bg-gray-50/50">
              <td class="px-6 py-3 font-medium text-gray-800">Platform Ads</td>
              <td class="text-center px-4 py-3 text-amber-500">Yes</td>
              <td class="text-center px-4 py-3 text-green-600 bg-brand-50/50"><i class="fas fa-check"></i> Ad-free</td>
              <td class="text-center px-4 py-3 text-green-600"><i class="fas fa-check"></i> Ad-free</td>
              <td class="text-center px-4 py-3 text-green-600"><i class="fas fa-check"></i> Ad-free</td>
            </tr>
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">Individual Report</td>
              <td class="text-center px-4 py-3">$5 USD</td>
              <td class="text-center px-4 py-3 bg-brand-50/50">$5 USD</td>
              <td class="text-center px-4 py-3">$5 USD</td>
              <td class="text-center px-4 py-3 text-gray-500">Custom</td>
            </tr>
            <tr class="bg-gray-50/50">
              <td class="px-6 py-3 font-medium text-gray-800">25-Pack</td>
              <td class="text-center px-4 py-3">$106.25 USD</td>
              <td class="text-center px-4 py-3 bg-brand-50/50">$106.25 USD</td>
              <td class="text-center px-4 py-3">$106.25 USD</td>
              <td class="text-center px-4 py-3 text-gray-500">Custom</td>
            </tr>
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">100-Pack</td>
              <td class="text-center px-4 py-3">$350 USD</td>
              <td class="text-center px-4 py-3 bg-brand-50/50">$350 USD</td>
              <td class="text-center px-4 py-3">$350 USD</td>
              <td class="text-center px-4 py-3 text-gray-500">Custom</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-center text-gray-400 text-xs mt-4">All prices in USD. Report credits never expire. Enterprise requires manual onboarding — contact us to get started.</p>
    </div>

    <!-- Every Report Includes -->
    <div class="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-12 text-center text-white mb-12">
      <h2 class="text-2xl font-bold mb-4">Every Report Includes</h2>
      <div class="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
        <div>
          <i class="fas fa-satellite text-accent-400 text-3xl mb-3"></i>
          <h3 class="font-semibold mb-1">14 Satellite Images</h3>
          <p class="text-gray-300 text-sm">Overhead, aerial, street-view, close-up quadrants</p>
        </div>
        <div>
          <i class="fas fa-ruler-combined text-accent-400 text-3xl mb-3"></i>
          <h3 class="font-semibold mb-1">Precise Measurements</h3>
          <p class="text-gray-300 text-sm">3D roof area, perimeter side-by-side, pitch per facet</p>
        </div>
        <div>
          <i class="fas fa-file-invoice-dollar text-accent-400 text-3xl mb-3"></i>
          <h3 class="font-semibold mb-1">Material Takeoff</h3>
          <p class="text-gray-300 text-sm">Full bill of materials with pricing</p>
        </div>
      </div>
      <a href="/customer/login" class="inline-block mt-8 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-xl text-lg transition-all hover:scale-105 shadow-lg">
        <i class="fas fa-gift mr-2"></i>Sign Up — 3 Free Reports
      </a>
    </div>
  `;
}
