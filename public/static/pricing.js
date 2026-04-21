// ============================================================
// Pricing Page — Public, fetches packages and renders cards
// Pricing: 4 free → $7 USD individual → 25-pack ($150) → 100-pack ($500)
// Membership: $49.99/mo — 5 team members + ad-free
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Pricing content is now SSR'd — no need to re-render.
  // This script is kept for any future dynamic enhancements
  // (e.g. fetching live Square package IDs for checkout links).
});

function renderPricing(root, packages) {
  root.innerHTML = `
    <!-- Free Reports Banner -->
    <div class="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-8 mb-12 text-white text-center shadow-lg">
      <div class="flex items-center justify-center gap-3 mb-3">
        <i class="fas fa-gift text-3xl"></i>
        <h2 class="text-3xl font-extrabold">4 Free Reports When You Sign Up</h2>
      </div>
      <p class="text-green-100 text-lg mb-6">No credit card required. Create an account and get 3 professional roof measurement reports — completely free.</p>
      <a href="/customer/login" class="inline-flex items-center gap-2 bg-white text-green-700 font-bold py-3 px-8 rounded-xl text-lg shadow-lg transition-all hover:scale-105 hover:bg-green-50">
        <i class="fas fa-user-plus"></i>
        Sign Up Free
      </a>
    </div>

    <div class="text-center mb-12">
      <h1 class="text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h1>
      <p class="text-lg text-gray-600 max-w-2xl mx-auto">Start with 4 free reports. After that, buy individual reports or save with credit packs.</p>
    </div>

    <!-- How it works -->
    <div class="bg-white rounded-2xl border border-gray-200 p-8 mb-12">
      <h2 class="text-xl font-bold text-gray-800 mb-6 text-center"><i class="fas fa-route text-brand-500 mr-2"></i>How It Works</h2>
      <div class="grid md:grid-cols-4 gap-6">
        <div class="text-center">
          <div class="w-14 h-14 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-brand-700 font-bold text-lg">1</span>
          </div>
          <h3 class="font-semibold text-gray-800 mb-1">Create Account</h3>
          <p class="text-sm text-gray-500">Sign up free — get 3 reports instantly</p>
        </div>
        <div class="text-center">
          <div class="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-green-700 font-bold text-lg">2</span>
          </div>
          <h3 class="font-semibold text-gray-800 mb-1">Use Free Reports</h3>
          <p class="text-sm text-gray-500">4 free reports included with every account</p>
        </div>
        <div class="text-center">
          <div class="w-14 h-14 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-brand-700 font-bold text-lg">3</span>
          </div>
          <h3 class="font-semibold text-gray-800 mb-1">Enter Address</h3>
          <p class="text-sm text-gray-500">Type the property address and submit</p>
        </div>
        <div class="text-center">
          <div class="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-green-700 font-bold text-lg">4</span>
          </div>
          <h3 class="font-semibold text-gray-800 mb-1">Get Your Report</h3>
          <p class="text-sm text-gray-500">AI-powered analysis with full measurements in seconds</p>
        </div>
      </div>
    </div>

    <!-- Per-Report Pricing -->
    <h2 class="text-2xl font-bold text-gray-800 mb-6 text-center">Individual Report</h2>
    <div class="max-w-lg mx-auto mb-16">
      <div class="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg transition-shadow ring-2 ring-brand-500 relative">
        <div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-500 text-white px-4 py-1 rounded-full text-xs font-bold">PAY PER REPORT</div>
        <div class="text-center mb-6">
          <div class="w-14 h-14 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <i class="fas fa-bolt text-brand-500 text-xl"></i>
          </div>
          <h3 class="text-xl font-bold text-gray-800">Roof Measurement Report</h3>
          <p class="text-sm text-gray-500 mt-1">Delivered instantly — no subscription required</p>
        </div>
        <div class="text-center mb-6">
          <span class="text-5xl font-black text-gray-900">$7</span>
          <span class="text-gray-500 text-sm ml-1">USD / report</span>
        </div>
        <ul class="space-y-3 mb-6 text-sm">
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>Satellite-based roof area & perimeter</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>Pitch & azimuth analysis per facet</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>Complete material takeoff with CAD pricing</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>Edge breakdown (ridge, hip, valley, eave, rake)</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>AI roof geometry overlay with SVG diagram</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>14-image gallery (overhead, aerial, street-view)</li>
          <li class="flex items-center gap-2 text-gray-600"><i class="fas fa-check text-green-500"></i>Perimeter side-by-side measurements in ft & in</li>
        </ul>
        <a href="/customer/login" class="block w-full py-3 text-center font-bold rounded-xl transition-all hover:scale-[1.02] bg-brand-600 hover:bg-brand-700 text-white shadow-lg">
          Get Started
        </a>
      </div>
    </div>

    <!-- Credit Packs -->
    <h2 class="text-2xl font-bold text-gray-800 mb-2 text-center">Credit Packs — Save More</h2>
    <p class="text-center text-gray-500 mb-8">Buy credits in bulk and use them anytime. Credits never expire.</p>
    <div class="grid md:grid-cols-2 gap-5 mb-16 max-w-2xl mx-auto">
      ${packages.filter(pkg => pkg.credits > 1).map((pkg, i) => {
        const priceEach = (pkg.price_cents / 100 / pkg.credits).toFixed(2);
        const savings = Math.round((1 - (pkg.price_cents / 100) / (pkg.credits * 5)) * 100);
        const isBest = i === packages.filter(p => p.credits > 1).length - 1;
        const isPopular = i === 0; // 25-pack
        return `
          <div class="bg-white rounded-xl border ${isBest ? 'border-brand-500 ring-2 ring-brand-200' : isPopular ? 'border-accent-400 ring-2 ring-accent-200' : 'border-gray-200'} p-5 text-center hover:shadow-md transition-shadow relative">
            ${isBest ? '<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-500 text-white px-3 py-0.5 rounded-full text-[10px] font-bold">BEST VALUE</div>' : ''}
            ${isPopular ? '<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent-500 text-white px-3 py-0.5 rounded-full text-[10px] font-bold">POPULAR</div>' : ''}
            <h3 class="font-bold text-gray-800 text-lg mb-1">${pkg.name}</h3>
            <div class="text-xs text-gray-500 mb-3">${pkg.credits} reports</div>
            <div class="mb-2">
              <span class="text-3xl font-black text-gray-900">$${(pkg.price_cents / 100).toFixed(0)}</span>
              <span class="text-gray-400 text-xs ml-1">USD</span>
            </div>
            <p class="text-sm font-semibold text-brand-600 mb-1">$${priceEach}/report</p>
            ${savings > 0 ? `<span class="inline-block bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold mb-3">Save ${savings}%</span>` : '<div class="mb-3"></div>'}
            <a href="/customer/login" class="block w-full py-2.5 ${isBest || isPopular ? 'bg-brand-600 hover:bg-brand-700' : 'bg-sky-600 hover:bg-sky-700'} text-white font-bold rounded-lg text-sm transition-all hover:scale-[1.02]">
              Buy ${pkg.credits} Credits
            </a>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Membership Add-on -->
    <div class="max-w-2xl mx-auto mb-16">
      <h2 class="text-2xl font-bold text-gray-800 mb-2 text-center">Team Membership</h2>
      <p class="text-center text-gray-500 mb-8">Add team members and go ad-free for one flat monthly price.</p>
      <div class="bg-gradient-to-br from-brand-800 to-brand-900 rounded-2xl p-8 text-white shadow-xl text-center">
        <span class="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-bold"><i class="fas fa-users mr-1"></i>TEAM</span>
        <h3 class="text-4xl font-black mt-4 mb-1">$49.99 <span class="text-lg font-normal text-brand-200">/month</span></h3>
        <p class="text-brand-200 mb-6 text-sm">Add up to 5 team members to your account and remove all ads.</p>
        <ul class="space-y-3 text-sm text-left max-w-xs mx-auto mb-8">
          <li class="flex items-center gap-2"><i class="fas fa-check-circle text-green-400"></i>Up to 5 team member accounts</li>
          <li class="flex items-center gap-2"><i class="fas fa-check-circle text-green-400"></i>Ad-free experience for your whole team</li>
          <li class="flex items-center gap-2"><i class="fas fa-check-circle text-green-400"></i>Shared credit pool — one billing account</li>
          <li class="flex items-center gap-2"><i class="fas fa-check-circle text-green-400"></i>Cancel anytime</li>
        </ul>
        <a href="/customer/login" class="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white font-bold py-3 px-8 rounded-xl transition-all hover:scale-105 shadow-lg">
          <i class="fas fa-users"></i>
          Add Team Membership
        </a>
        <p class="text-brand-300 text-xs mt-4"><i class="fas fa-info-circle mr-1"></i>Reports are billed separately — $7 USD each or via credit packs.</p>
      </div>
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
          <p class="text-gray-300 text-sm">Full bill of materials with Canadian pricing</p>
        </div>
      </div>
      <a href="/customer/login" class="inline-block mt-8 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-xl text-lg transition-all hover:scale-105 shadow-lg">
        <i class="fas fa-gift mr-2"></i>Sign Up — 4 Free Reports
      </a>
    </div>

    <!-- Pricing Comparison Table -->
    <div class="max-w-4xl mx-auto mb-12">
      <h2 class="text-xl font-bold text-gray-800 mb-6 text-center">Pricing Comparison</h2>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left px-6 py-3 font-semibold text-gray-700">Package</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Reports</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Price/Report</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Total</th>
              <th class="text-center px-4 py-3 font-semibold text-gray-700">Savings</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">Individual</td>
              <td class="text-center px-4 py-3">1</td>
              <td class="text-center px-4 py-3">$7.00</td>
              <td class="text-center px-4 py-3 font-semibold">$7</td>
              <td class="text-center px-4 py-3 text-gray-400">—</td>
            </tr>
            <tr class="bg-gray-50/50">
              <td class="px-6 py-3 font-medium text-gray-800">25-Pack <span class="text-xs bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded font-bold ml-1">POPULAR</span></td>
              <td class="text-center px-4 py-3">25</td>
              <td class="text-center px-4 py-3">$6.00</td>
              <td class="text-center px-4 py-3 font-semibold">$150</td>
              <td class="text-center px-4 py-3"><span class="text-green-600 font-semibold">Save 21%</span></td>
            </tr>
            <tr>
              <td class="px-6 py-3 font-medium text-gray-800">100-Pack <span class="text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-bold ml-1">BEST VALUE</span></td>
              <td class="text-center px-4 py-3">100</td>
              <td class="text-center px-4 py-3">$5.00</td>
              <td class="text-center px-4 py-3 font-semibold">$500</td>
              <td class="text-center px-4 py-3"><span class="text-green-600 font-semibold">Save 40%</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-center text-gray-400 text-xs mt-4">All prices in USD. Credits never expire.</p>
    </div>
  `;
}
