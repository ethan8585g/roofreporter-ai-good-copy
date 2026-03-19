// ============================================================
// CUSTOMER ONBOARDING WIZARD — Full-featured modular onboarding
// Modules: Account + Team | Voice Secretary | Membership | Deploy
// ============================================================

(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var OB = window.OB = {
    step: 1,
    totalSteps: 4,
    modules: { account: true, voice: true, membership: true, deploy: true },
    // Form data
    business: '', contactName: '', email: '', password: '', phone: '', carrier: '',
    teamMembers: [],
    // Voice config
    agentName: 'Sarah', voiceId: 'alloy', voiceProvider: 'openai', mode: 'full',
    speed: 1.0, pauseMs: 800, endpointingMs: 300, interruptSensitivity: 0.5,
    greeting: '', qa: '', notes: '',
    sttProvider: 'deepgram', llmProvider: 'openai', llmModel: 'gpt-4o-mini',
    // Membership
    selectedTier: null, tiers: [],
    // Phone
    personalPhone: '', agentPhone: '',
    directories: [{}, {}, {}, {}],
    // Deploy
    deploying: false, deployed: false, deployResult: null,
    testCallActive: false
  };

  // ── Render ─────────────────────────────────────────────────
  window.renderOnboardingWizard = function() {
    var html = '<div class="space-y-6 slide-in">';

    // Header
    html += '<div class="flex items-center justify-between">' +
      '<div class="flex items-center gap-3">' +
        '<button onclick="SA.smView=\'list\';loadView(\'secretary-manager\')" class="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center"><i class="fas fa-arrow-left text-gray-500"></i></button>' +
        '<div><h2 class="text-2xl font-black text-gray-900"><i class="fas fa-rocket mr-2 text-teal-500"></i>Customer Onboarding</h2>' +
        '<p class="text-sm text-gray-500">Create account, configure AI, set membership, deploy — all in one wizard</p></div>' +
      '</div>' +
      '<div class="flex items-center gap-2 bg-gray-100 rounded-xl px-4 py-2">' +
        '<span class="text-sm font-bold text-gray-700">Step ' + OB.step + ' / ' + OB.totalSteps + '</span>' +
      '</div>' +
    '</div>';

    // Module toggles
    html += '<div class="flex gap-2 flex-wrap">';
    var mods = [
      { key: 'account', icon: 'fa-user-plus', label: 'Account & Team', required: true },
      { key: 'voice', icon: 'fa-headset', label: 'Voice Secretary' },
      { key: 'membership', icon: 'fa-crown', label: 'Membership & Pricing' },
      { key: 'deploy', icon: 'fa-rocket', label: 'Deploy & Test', required: true }
    ];
    mods.forEach(function(m, i) {
      var active = OB.modules[m.key];
      var stepNum = i + 1;
      var isCurrent = OB.step === stepNum;
      html += '<button onclick="' + (m.required ? '' : 'OB.modules.' + m.key + '=!' + active + ';renderContent()') + '" class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all ' +
        (isCurrent ? 'border-teal-500 bg-teal-50 text-teal-700' : active ? 'border-gray-200 bg-white text-gray-600 hover:border-gray-300' : 'border-gray-100 bg-gray-50 text-gray-400 line-through') +
        (m.required ? ' cursor-default' : '') + '">' +
        '<i class="fas ' + m.icon + '"></i>' + m.label +
        (m.required ? '<span class="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded">Required</span>' : '') +
      '</button>';
    });
    html += '</div>';

    // Progress bar
    html += '<div class="h-2 bg-gray-200 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-teal-500 to-blue-500 transition-all duration-500" style="width:' + (OB.step / OB.totalSteps * 100) + '%"></div></div>';

    // Current step content
    if (OB.step === 1) html += renderStep1_Account();
    else if (OB.step === 2) html += renderStep2_Voice();
    else if (OB.step === 3) html += renderStep3_Membership();
    else if (OB.step === 4) html += renderStep4_Deploy();

    // Navigation
    html += '<div class="flex justify-between items-center pt-4 border-t border-gray-200">';
    if (OB.step > 1) {
      html += '<button onclick="OB.step--;renderContent()" class="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold"><i class="fas fa-arrow-left mr-2"></i>Back</button>';
    } else {
      html += '<div></div>';
    }
    if (OB.step < OB.totalSteps) {
      html += '<button onclick="obNextStep()" class="px-8 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-lg"><i class="fas fa-arrow-right mr-2"></i>Continue</button>';
    } else {
      html += '<button onclick="obDeployCustomer()" class="px-8 py-3 bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-600 hover:to-blue-700 text-white rounded-xl text-sm font-bold shadow-lg" ' + (OB.deploying ? 'disabled' : '') + '><i class="fas fa-rocket mr-2"></i>' + (OB.deploying ? 'Deploying...' : 'Deploy Customer Account') + '</button>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  };

  // ── Step 1: Account & Team Members ─────────────────────────
  function renderStep1_Account() {
    var html = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-4 text-lg"><i class="fas fa-building mr-2 text-blue-500"></i>Business & Admin Account</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        obInput('smo-business', 'Business Name *', OB.business, 'ABC Roofing Ltd', 'OB.business=this.value') +
        obInput('smo-name', 'Contact Name *', OB.contactName, 'John Smith', 'OB.contactName=this.value') +
        obInput('smo-email', 'Email (username) *', OB.email, 'john@abcroofing.ca', 'OB.email=this.value', 'email') +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">' +
        obInput('smo-password', 'Password *', OB.password, 'Secure password', 'OB.password=this.value', 'text') +
        obInput('smo-phone', 'Business Phone', OB.phone, '+1 403 555 1234', 'OB.phone=this.value', 'tel') +
        obInput('smo-carrier', 'Carrier', OB.carrier, 'Telus, Rogers, Bell...', 'OB.carrier=this.value') +
      '</div>' +
    '</div>';

    // Team Members
    html += '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-users mr-2 text-purple-500"></i>Team Members <span class="text-sm font-normal text-gray-400">(optional)</span></h3>' +
        '<button onclick="obAddTeamMember()" class="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-600 rounded-xl text-xs font-bold"><i class="fas fa-plus mr-1"></i>Add Member</button>' +
      '</div>';

    if (OB.teamMembers.length === 0) {
      html += '<p class="text-gray-400 text-sm py-4 text-center">No team members yet. Add them here or after account creation.</p>';
    } else {
      html += '<div class="space-y-3">';
      OB.teamMembers.forEach(function(tm, i) {
        html += '<div class="bg-gray-50 rounded-xl p-4 flex items-center gap-3">' +
          '<div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center"><i class="fas fa-user text-purple-500 text-xs"></i></div>' +
          '<div class="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">' +
            '<input value="' + esc(tm.name) + '" onchange="OB.teamMembers[' + i + '].name=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Name">' +
            '<input value="' + esc(tm.email) + '" onchange="OB.teamMembers[' + i + '].email=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Email">' +
            '<input value="' + esc(tm.password) + '" onchange="OB.teamMembers[' + i + '].password=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Password">' +
            '<select onchange="OB.teamMembers[' + i + '].role=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm">' +
              '<option value="member"' + (tm.role === 'member' ? ' selected' : '') + '>Member</option>' +
              '<option value="manager"' + (tm.role === 'manager' ? ' selected' : '') + '>Manager</option>' +
              '<option value="admin"' + (tm.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' +
          '</div>' +
          '<button onclick="OB.teamMembers.splice(' + i + ',1);renderContent()" class="w-8 h-8 bg-red-50 hover:bg-red-100 rounded-lg flex items-center justify-center text-red-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>' +
        '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── Step 2: Voice Secretary Setup ──────────────────────────
  function renderStep2_Voice() {
    var html = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-headset mr-2 text-violet-500"></i>Voice Agent Configuration</h3>' +
        '<button onclick="geminiAutoGenerateConfig()" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-xs font-bold shadow-md"><i class="fas fa-magic mr-1.5"></i>AI Auto-Generate</button>' +
      '</div>';

    // Agent identity
    html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' +
      obInput('smo-agent-name', 'Agent Name', OB.agentName, 'Sarah', 'OB.agentName=this.value') +
      '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Voice</label>' +
        '<select id="smo-voice" onchange="OB.voiceId=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm">' +
          ['alloy','shimmer','nova','echo','onyx','fable','ash','coral','sage'].map(function(v) {
            return '<option value="' + v + '"' + (OB.voiceId === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Mode</label>' +
        '<select id="smo-mode" onchange="OB.mode=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm">' +
          [['full','Full Secretary'],['answering','Answering Service'],['directory','Directory'],['receptionist','Receptionist'],['always_on','Always On']].map(function(m) {
            return '<option value="' + m[0] + '"' + (OB.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
          }).join('') +
        '</select></div>' +
      '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Voice Provider</label>' +
        '<select id="smo-voice-provider" onchange="OB.voiceProvider=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm">' +
          [['openai','OpenAI TTS'],['elevenlabs','ElevenLabs'],['cartesia','Cartesia'],['deepgram','Deepgram']].map(function(p) {
            return '<option value="' + p[0] + '"' + (OB.voiceProvider === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
          }).join('') +
        '</select></div>' +
    '</div>';

    // Speed, Pause, Endpointing sliders
    html += '<div class="mt-6 bg-gray-50 rounded-xl p-5">' +
      '<h4 class="text-sm font-bold text-gray-700 mb-4"><i class="fas fa-sliders-h mr-2 text-blue-500"></i>Voice Tuning</h4>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">' +
        obSlider('ob-speed', 'Speaking Speed', OB.speed, 0.5, 2.0, 0.1, 'OB.speed=parseFloat(this.value)', OB.speed + 'x') +
        obSlider('ob-pause', 'Reply Pause', OB.pauseMs, 200, 2000, 50, 'OB.pauseMs=parseInt(this.value)', OB.pauseMs + 'ms') +
        obSlider('ob-endpoint', 'Silence Wait (endpointing)', OB.endpointingMs, 100, 1000, 50, 'OB.endpointingMs=parseInt(this.value)', OB.endpointingMs + 'ms') +
        obSlider('ob-interrupt', 'Interruption Sensitivity', OB.interruptSensitivity, 0, 1, 0.1, 'OB.interruptSensitivity=parseFloat(this.value)', Math.round(OB.interruptSensitivity * 100) + '%') +
      '</div>' +
    '</div>';

    // Notification settings
    html += '<div class="mt-4 bg-amber-50 rounded-xl p-5 border border-amber-200">' +
      '<h4 class="text-sm font-bold text-amber-800 mb-3"><i class="fas fa-bell mr-2"></i>Call Notifications</h4>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        obCheckbox('ob-notif-leads', 'New leads booked', true) +
        obCheckbox('ob-notif-important', 'Important / urgent calls', true) +
        obCheckbox('ob-notif-callbacks', 'Callbacks scheduled', true) +
      '</div>' +
    '</div>';

    // Greeting, QA, Notes
    html += '<div class="mt-4 space-y-4">' +
      '<div><div class="flex items-center justify-between mb-1.5"><label class="text-xs font-semibold text-gray-500">Greeting Script</label><button onclick="geminiGenerateGreeting()" class="text-xs text-purple-500 hover:text-purple-700 font-medium"><i class="fas fa-magic mr-1"></i>AI Generate</button></div>' +
        '<textarea id="smo-greeting" rows="3" onchange="OB.greeting=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Thank you for calling [Business]. How may I help you?">' + esc(OB.greeting) + '</textarea></div>' +
      '<div><div class="flex items-center justify-between mb-1.5"><label class="text-xs font-semibold text-gray-500">Common Q&A</label><button onclick="geminiGenerateQA()" class="text-xs text-purple-500 hover:text-purple-700 font-medium"><i class="fas fa-magic mr-1"></i>AI Generate</button></div>' +
        '<textarea id="smo-qa" rows="3" onchange="OB.qa=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono" placeholder="Q: What are your hours? | A: Monday-Friday 8am-6pm">' + esc(OB.qa) + '</textarea></div>' +
      '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">Business Notes</label>' +
        '<textarea id="smo-notes" rows="3" onchange="OB.notes=this.value" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Special instructions for the AI agent...">' + esc(OB.notes) + '</textarea></div>' +
    '</div>';

    // Test Agent
    html += '<div class="mt-4 bg-gradient-to-r from-violet-50 to-blue-50 rounded-xl p-5 border border-violet-200">' +
      '<div class="flex items-center justify-between">' +
        '<div><h4 class="text-sm font-bold text-violet-800"><i class="fas fa-volume-up mr-2"></i>Test Your Agent</h4>' +
          '<p class="text-xs text-violet-600 mt-0.5">Press the speaker to hear a sample greeting, or call the test number</p></div>' +
        '<div class="flex gap-2">' +
          '<button onclick="obTestVoice()" class="w-12 h-12 bg-violet-600 hover:bg-violet-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all"><i class="fas fa-volume-up text-lg"></i></button>' +
          '<button onclick="obTestCall()" class="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold shadow-md"><i class="fas fa-phone mr-1.5"></i>Test Call</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Phone assignment
    html += '<div class="mt-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6">' +
      '<h3 class="font-bold text-blue-800 mb-4"><i class="fas fa-phone-alt mr-2"></i>Phone Number Assignment</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div><label class="text-xs font-bold text-blue-700 block mb-1.5">Customer\'s Cell / Business Line</label>' +
          '<input id="smo-personal-phone" value="' + esc(OB.personalPhone) + '" onchange="OB.personalPhone=this.value" class="w-full border-2 border-blue-200 rounded-xl px-4 py-2.5 text-sm font-mono" placeholder="+1 403 555 1234">' +
          '<p class="text-[10px] text-blue-600 mt-1">They forward FROM this number when unavailable</p></div>' +
        '<div><label class="text-xs font-bold text-purple-700 block mb-1.5">AI Agent Phone (SIP)</label>' +
          '<input id="smo-agent-phone" value="' + esc(OB.agentPhone) + '" onchange="OB.agentPhone=this.value" class="w-full border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm font-mono" placeholder="+1 484 964 9758">' +
          '<p class="text-[10px] text-purple-600 mt-1">Twilio/LiveKit # the AI uses</p></div>' +
      '</div>' +
    '</div>';

    // Directories
    html += '<div class="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-sitemap mr-2 text-sky-400"></i>Call Routing Directories</h3>' +
      '<div class="grid grid-cols-3 gap-2 mb-2 text-[11px] text-gray-500 font-semibold uppercase tracking-wider"><span>Department</span><span>Phone / Action</span><span>Notes</span></div>' +
      '<div class="space-y-2">';
    var dirDefaults = ['Sales', 'Service', 'Emergency', 'Billing'];
    for (var i = 0; i < 4; i++) {
      var d = OB.directories[i] || {};
      html += '<div class="grid grid-cols-3 gap-2">' +
        '<input value="' + esc(d.name || '') + '" onchange="OB.directories[' + i + '].name=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="' + dirDefaults[i] + '">' +
        '<input value="' + esc(d.phone || '') + '" onchange="OB.directories[' + i + '].phone=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="+1 403 555 ' + (i+1) + (i+1) + (i+1) + (i+1) + '">' +
        '<input value="' + esc(d.notes || '') + '" onchange="OB.directories[' + i + '].notes=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="' + dirDefaults[i] + ' line">' +
      '</div>';
    }
    html += '</div></div>';

    html += '</div>';
    return html;
  }

  // ── Step 3: Membership & Pricing ───────────────────────────
  function renderStep3_Membership() {
    var html = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-2 text-lg"><i class="fas fa-crown mr-2 text-amber-500"></i>Select Membership Tier</h3>' +
      '<p class="text-sm text-gray-500 mb-6">Choose a plan for this customer. This sets their included reports, minutes, and features.</p>';

    var tiers = [
      { id: 1, name: 'Starter', price: '$249', desc: 'AI Secretary answering — perfect for solo roofers', reports: 5, minutes: 500, features: ['AI Phone Secretary', '500 mins/mo', '5 Roof Reports/mo', 'Call Logs & Leads'], color: 'blue', icon: 'fa-seedling' },
      { id: 2, name: 'Pro', price: '$499', desc: 'Full AI Secretary + CRM + priority support', reports: 20, minutes: 2000, features: ['Everything in Starter', '2,000 mins/mo', '20 Roof Reports/mo', 'CRM + Email Outreach', 'Priority Support'], color: 'purple', icon: 'fa-star', popular: true },
      { id: 3, name: 'Enterprise', price: '$999', desc: 'Everything — Secretary, Cold Call, unlimited, white-label', reports: 999, minutes: 10000, features: ['Everything in Pro', 'Unlimited Reports', '10,000 mins/mo', 'Cold Call Module', 'White-Label', 'Dedicated Support'], color: 'amber', icon: 'fa-crown' }
    ];

    html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-6">';
    tiers.forEach(function(t) {
      var selected = OB.selectedTier === t.id;
      html += '<div onclick="OB.selectedTier=' + t.id + ';renderContent()" class="relative cursor-pointer rounded-2xl border-2 p-6 transition-all hover:shadow-lg ' +
        (selected ? 'border-' + t.color + '-500 bg-' + t.color + '-50 shadow-md ring-2 ring-' + t.color + '-200' : 'border-gray-200 hover:border-' + t.color + '-300') + '">' +
        (t.popular ? '<div class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-600 text-white text-[10px] font-bold rounded-full">MOST POPULAR</div>' : '') +
        '<div class="flex items-center gap-3 mb-4">' +
          '<div class="w-10 h-10 bg-' + t.color + '-100 rounded-xl flex items-center justify-center"><i class="fas ' + t.icon + ' text-' + t.color + '-600"></i></div>' +
          '<div><h4 class="font-bold text-gray-800">' + t.name + '</h4><p class="text-2xl font-black text-' + t.color + '-600">' + t.price + '<span class="text-xs font-normal text-gray-400">/mo</span></p></div>' +
        '</div>' +
        '<p class="text-xs text-gray-500 mb-4">' + t.desc + '</p>' +
        '<ul class="space-y-1.5">' +
          t.features.map(function(f) { return '<li class="text-xs text-gray-600 flex items-center gap-2"><i class="fas fa-check text-green-500 text-[10px]"></i>' + f + '</li>'; }).join('') +
        '</ul>' +
        (selected ? '<div class="mt-4 flex items-center justify-center gap-2 text-' + t.color + '-600 text-xs font-bold"><i class="fas fa-check-circle"></i>Selected</div>' : '') +
      '</div>';
    });
    html += '</div>';

    // Welcome package customization
    html += '<div class="mt-6 bg-gradient-to-r from-green-50 to-teal-50 rounded-xl p-5 border border-green-200">' +
      '<h4 class="text-sm font-bold text-green-800 mb-3"><i class="fas fa-gift mr-2"></i>Welcome Package (optional)</h4>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div><label class="text-xs font-semibold text-green-700 block mb-1.5">Bonus Roof Reports</label><input id="ob-welcome-reports" type="number" value="3" class="w-full border border-green-200 rounded-lg px-3 py-2 text-sm" min="0" max="50"></div>' +
        '<div><label class="text-xs font-semibold text-green-700 block mb-1.5">Discount %</label><input id="ob-welcome-discount" type="number" value="10" class="w-full border border-green-200 rounded-lg px-3 py-2 text-sm" min="0" max="50"></div>' +
        '<div><label class="text-xs font-semibold text-green-700 block mb-1.5">Welcome Message</label><input id="ob-welcome-msg" class="w-full border border-green-200 rounded-lg px-3 py-2 text-sm" placeholder="Welcome to RoofReporterAI!"></div>' +
      '</div>' +
    '</div>';

    html += '</div>';
    return html;
  }

  // ── Step 4: Review & Deploy ────────────────────────────────
  function renderStep4_Deploy() {
    var html = '<div class="space-y-4">';

    // Summary
    html += '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 mb-4 text-lg"><i class="fas fa-clipboard-check mr-2 text-teal-500"></i>Review & Deploy</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
        '<div>' +
          '<h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Account</h4>' +
          '<div class="space-y-1 text-sm">' +
            '<p><span class="text-gray-400 w-24 inline-block">Business:</span><strong>' + esc(OB.business || '—') + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Contact:</span><strong>' + esc(OB.contactName || '—') + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Email:</span><strong>' + esc(OB.email || '—') + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Phone:</span><strong>' + esc(OB.phone || '—') + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Team:</span><strong>' + OB.teamMembers.length + ' members</strong></p>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Secretary AI</h4>' +
          '<div class="space-y-1 text-sm">' +
            '<p><span class="text-gray-400 w-24 inline-block">Agent:</span><strong>' + esc(OB.agentName) + '</strong> (' + OB.voiceId + ')</p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Mode:</span><strong>' + OB.mode + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Speed:</span><strong>' + OB.speed + 'x</strong> | Pause: <strong>' + OB.pauseMs + 'ms</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">AI Phone:</span><strong class="font-mono">' + esc(OB.agentPhone || '—') + '</strong></p>' +
            '<p><span class="text-gray-400 w-24 inline-block">Tier:</span><strong>' + (OB.selectedTier ? ['','Starter','Pro','Enterprise'][OB.selectedTier] : 'None') + '</strong></p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Deploy checklist
    var checks = [
      { label: 'Customer account created (username + password)', done: !!OB.email && !!OB.password },
      { label: 'Secretary AI configured (greeting + voice)', done: !!OB.greeting || !!OB.agentName },
      { label: 'Phone number assigned', done: !!OB.agentPhone },
      { label: 'Membership tier selected', done: !!OB.selectedTier },
    ];
    html += '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h4 class="font-bold text-gray-800 mb-3"><i class="fas fa-tasks mr-2 text-blue-500"></i>Deploy Checklist</h4>' +
      '<div class="space-y-2">';
    checks.forEach(function(ch) {
      html += '<div class="flex items-center gap-3 text-sm">' +
        '<div class="w-6 h-6 rounded-full flex items-center justify-center ' + (ch.done ? 'bg-green-100' : 'bg-gray-100') + '">' +
          '<i class="fas ' + (ch.done ? 'fa-check text-green-600' : 'fa-circle text-gray-300') + ' text-xs"></i>' +
        '</div>' +
        '<span class="' + (ch.done ? 'text-gray-700' : 'text-gray-400') + '">' + ch.label + '</span>' +
      '</div>';
    });
    html += '</div></div>';

    // Deploy actions
    html += '<div class="bg-gradient-to-r from-teal-50 to-blue-50 rounded-2xl border border-teal-200 p-6">' +
      '<h4 class="font-bold text-teal-800 mb-2"><i class="fas fa-rocket mr-2"></i>What happens when you deploy:</h4>' +
      '<ol class="text-sm text-teal-700 space-y-1 list-decimal ml-5">' +
        '<li>Customer account created with email + password login</li>' +
        '<li>Team member accounts created (if any)</li>' +
        '<li>Secretary AI config saved with voice/speed/pause settings</li>' +
        '<li>LiveKit SIP trunk + dispatch rule created for the AI phone number</li>' +
        '<li>Membership tier assigned with welcome package</li>' +
        '<li>Customer gets access to their dashboard at /customer/dashboard</li>' +
      '</ol>' +
    '</div>';

    if (OB.deployed) {
      html += '<div class="bg-green-50 rounded-2xl border-2 border-green-300 p-6 text-center">' +
        '<i class="fas fa-check-circle text-green-500 text-4xl mb-3"></i>' +
        '<h3 class="text-lg font-bold text-green-800">Customer Deployed Successfully!</h3>' +
        '<p class="text-sm text-green-600 mt-1">Customer ID: ' + (OB.deployResult?.customer_id || '?') + ' | Email: ' + esc(OB.email) + '</p>' +
        '<div class="flex justify-center gap-3 mt-4">' +
          '<button onclick="SA.smView=\'list\';loadView(\'secretary-manager\')" class="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold">View in Secretary Manager</button>' +
          '<button onclick="obResetWizard()" class="px-4 py-2 bg-white text-green-700 border border-green-300 rounded-xl text-sm font-bold">Onboard Another</button>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  // ── Helper functions ───────────────────────────────────────
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function obInput(id, label, val, ph, onchange, type) {
    return '<div><label class="text-xs font-semibold text-gray-500 block mb-1.5">' + label + '</label>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val) + '" onchange="' + onchange + '" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-teal-400 focus:outline-none" placeholder="' + ph + '"></div>';
  }

  function obSlider(id, label, val, min, max, step, onchange, display) {
    return '<div>' +
      '<div class="flex justify-between items-center mb-1"><label class="text-xs font-semibold text-gray-600">' + label + '</label><span class="text-xs font-mono font-bold text-blue-600">' + display + '</span></div>' +
      '<input id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" ' +
      'oninput="' + onchange + ';this.parentNode.querySelector(\'span\').textContent=this.value+(this.id.includes(\'speed\')? \'x\' : this.id.includes(\'interrupt\')? \'%\' : \'ms\')" ' +
      'class="w-full accent-blue-500">' +
    '</div>';
  }

  function obCheckbox(id, label, checked) {
    return '<label class="flex items-center gap-2 cursor-pointer">' +
      '<input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + ' class="w-4 h-4 accent-amber-500 rounded">' +
      '<span class="text-xs text-amber-800">' + label + '</span>' +
    '</label>';
  }

  // ── Navigation ─────────────────────────────────────────────
  window.obNextStep = function() {
    // Validate current step
    if (OB.step === 1) {
      if (!OB.business || !OB.email || !OB.password) {
        alert('Please fill in Business Name, Email, and Password');
        return;
      }
    }
    OB.step = Math.min(OB.step + 1, OB.totalSteps);
    renderContent();
  };

  window.obAddTeamMember = function() {
    OB.teamMembers.push({ name: '', email: '', password: '', role: 'member' });
    renderContent();
  };

  window.obResetWizard = function() {
    OB.step = 1; OB.deployed = false; OB.deployResult = null;
    OB.business = ''; OB.contactName = ''; OB.email = ''; OB.password = '';
    OB.phone = ''; OB.carrier = ''; OB.teamMembers = [];
    OB.greeting = ''; OB.qa = ''; OB.notes = '';
    OB.personalPhone = ''; OB.agentPhone = '';
    OB.selectedTier = null; OB.directories = [{},{},{},{}];
    renderContent();
  };

  // ── Test voice / call ──────────────────────────────────────
  window.obTestVoice = function() {
    var text = OB.greeting || ('Thank you for calling ' + (OB.business || 'our company') + '. This is ' + OB.agentName + ', how may I help you today?');
    if ('speechSynthesis' in window) {
      var u = new SpeechSynthesisUtterance(text);
      u.rate = OB.speed;
      u.pitch = OB.voiceId === 'echo' || OB.voiceId === 'onyx' ? 0.8 : 1.1;
      speechSynthesis.speak(u);
    } else {
      alert('Voice preview: "' + text + '"');
    }
  };

  window.obTestCall = function() {
    alert('Test Call: This will initiate a test call to the configured AI agent. Make sure LiveKit and Twilio are configured in your environment.\n\nAgent: ' + OB.agentName + '\nVoice: ' + OB.voiceId + '\nSpeed: ' + OB.speed + 'x');
  };

  // ── Deploy ─────────────────────────────────────────────────
  window.obDeployCustomer = async function() {
    if (!OB.email || !OB.password) {
      alert('Email and Password are required'); return;
    }
    if (!confirm('Deploy customer account for ' + OB.business + ' (' + OB.email + ')?')) return;

    OB.deploying = true;
    renderContent();

    try {
      var res = await fetch('/api/admin/superadmin/secretary-manager/onboard', {
        method: 'POST',
        headers: { ...saHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: OB.business,
          contact_name: OB.contactName,
          email: OB.email,
          password: OB.password,
          phone: OB.phone,
          carrier: OB.carrier,
          // Team
          team_members: OB.teamMembers.filter(function(t) { return t.email; }),
          // Voice config
          agent_name: OB.agentName,
          agent_voice: OB.voiceId,
          voice_provider: OB.voiceProvider,
          secretary_mode: OB.mode,
          voice_speed: OB.speed,
          voice_pause_ms: OB.pauseMs,
          endpointing_ms: OB.endpointingMs,
          interruption_threshold: OB.interruptSensitivity,
          stt_provider: OB.sttProvider,
          llm_provider: OB.llmProvider,
          llm_model: OB.llmModel,
          greeting_script: OB.greeting,
          common_qa: OB.qa,
          general_notes: OB.notes,
          // Phone
          personal_phone: OB.personalPhone,
          agent_phone: OB.agentPhone,
          directories: OB.directories.filter(function(d) { return d.name; }),
          // Membership
          membership_tier_id: OB.selectedTier,
          welcome_reports: parseInt(document.getElementById('ob-welcome-reports')?.value || '0'),
          welcome_discount: parseInt(document.getElementById('ob-welcome-discount')?.value || '0'),
        })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);

      OB.deployed = true;
      OB.deployResult = data;
      alert('Customer deployed!\nID: ' + data.customer_id + '\nEmail: ' + OB.email + '\n\nNext: Have customer forward their cell to the AI number.');
    } catch(e) {
      alert('Deploy failed: ' + e.message);
    }

    OB.deploying = false;
    renderContent();
  };

})();
