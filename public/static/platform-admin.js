/**
 * Platform Administration Modules — Super Admin Frontend
 * Comprehensive UI for all platform management functions:
 * Module 1: Enhanced Customer Onboarding (team accounts, membership tiers)
 * Module 2: Voice Secretary Setup (voice, speed, pause, test-agent)
 * Module 3: Agent Persona & LLM Module (model selector, TTS/STT)
 * Module 4: Prompt & Knowledge Base (system prompt, dynamic vars, objection scripts)
 * Module 5: Cold-Call Centre (SIP mapping, campaigns, CSV, DNC)
 * Module 6: Phase 2 Operations (live dashboard, analytics, costs)
 * Module 7: Agent Fine-Tuning (transcript flagging, prompt updates)
 * Module 8: Roofer Secretary AI Service Panel (minutes, billing, scripts)
 */

/* global SA, saFetch, loadView */

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
window.PA = window.PA || {
  tiers: [], personas: [], campaigns: [], sipMap: [], flags: [],
  servicePanel: null, liveDash: null, voiceConfig: null,
  currentPersona: null, currentCampaign: null,
  view: 'main', subView: null, editCustomerId: null
};

function paFetch(path, opts) { return saFetch('/api/admin/platform' + path, opts); }

// ════════════════════════════════════════════════════════════════
// MODULE 1: ENHANCED CUSTOMER ONBOARDING
// ════════════════════════════════════════════════════════════════
function renderEnhancedOnboardingView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-user-plus mr-2 text-teal-600"></i>Enhanced Customer Onboarding</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Create customer accounts with team members, membership tiers & AI secretary</p></div>' +
      '<button onclick="loadView(\'secretary-manager\')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
    '</div>' +

    // Membership Tier Selector
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-crown mr-2 text-amber-500"></i>Membership Tier</h3>' +
      '<div id="pa-tier-cards" class="grid grid-cols-3 gap-4 mb-4">' +
        '<div class="animate-pulse bg-gray-100 rounded-xl h-32"></div>'.repeat(3) +
      '</div>' +
    '</div>' +

    // Business & Account
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-building mr-2 text-blue-500"></i>Business & Account Details</h3>' +
      '<div class="grid grid-cols-2 gap-4">' +
        paInput('pa-ob-business', 'Business Name', 'Mighty Roofing Co.') +
        paInput('pa-ob-contact', 'Contact Name *', 'John Smith') +
        paInput('pa-ob-email', 'Email (Username) *', 'john@mightyroofing.com', 'email') +
        paInput('pa-ob-password', 'Password *', 'Min 6 characters', 'password') +
        paInput('pa-ob-phone', 'Business Phone', '+1 (780) 555-0123', 'tel') +
        paInput('pa-ob-carrier', 'Phone Carrier', 'Telus / Rogers / etc.') +
      '</div>' +
    '</div>' +

    // Secretary AI Config
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-robot mr-2 text-violet-500"></i>Secretary AI Configuration</h3>' +
      '<div class="grid grid-cols-3 gap-4">' +
        paInput('pa-ob-agent-name', 'Agent Name', 'Sarah') +
        paSelect('pa-ob-agent-voice', 'Agent Voice', ['alloy','shimmer','nova','echo','onyx','fable','ash','coral','sage']) +
        paSelect('pa-ob-mode', 'Secretary Mode', ['full','answering','directory','receptionist','always_on']) +
      '</div>' +
      '<div class="mt-4">' +
        '<label class="block text-xs font-semibold text-gray-500 mb-1">Greeting Script</label>' +
        '<textarea id="pa-ob-greeting" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400 focus:border-transparent" placeholder="Thank you for calling..."></textarea>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-4 mt-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Common Q&A (JSON)</label><textarea id="pa-ob-qa" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono" placeholder="Q: What areas do you serve?&#10;A: We serve the greater Edmonton area."></textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">General Notes</label><textarea id="pa-ob-notes" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" placeholder="Special instructions for the AI agent..."></textarea></div>' +
      '</div>' +
      paInput('pa-ob-agent-phone', 'AI Agent SIP Number', '+14035551234') +
    '</div>' +

    // Directories
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-sitemap mr-2 text-indigo-500"></i>Call Directories (optional)</h3>' +
      '<div id="pa-ob-dirs" class="space-y-3">' +
        [1,2,3,4].map(i => '<div class="grid grid-cols-3 gap-3"><input id="pa-ob-dir-name-'+i+'" placeholder="Dept name" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"><input id="pa-ob-dir-phone-'+i+'" placeholder="Phone/action" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"><input id="pa-ob-dir-notes-'+i+'" placeholder="Notes" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"></div>').join('') +
      '</div>' +
    '</div>' +

    // Team Members
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-users mr-2 text-emerald-500"></i>Team Members (optional)</h3>' +
      '<div id="pa-ob-team" class="space-y-3">' +
        '<div class="grid grid-cols-4 gap-3">' +
          '<input id="pa-ob-tm-name-1" placeholder="Name" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
          '<input id="pa-ob-tm-email-1" placeholder="Email" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
          '<select id="pa-ob-tm-role-1" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select>' +
          '<input id="pa-ob-tm-phone-1" placeholder="Phone" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
        '</div>' +
        '<div class="grid grid-cols-4 gap-3">' +
          '<input id="pa-ob-tm-name-2" placeholder="Name" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
          '<input id="pa-ob-tm-email-2" placeholder="Email" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
          '<select id="pa-ob-tm-role-2" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select>' +
          '<input id="pa-ob-tm-phone-2" placeholder="Phone" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
        '</div>' +
      '</div>' +
      '<button onclick="paAddTeamRow()" class="mt-3 px-3 py-1.5 text-xs font-semibold text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50"><i class="fas fa-plus mr-1"></i>Add Team Member</button>' +
    '</div>' +

    // Submit
    '<div class="flex justify-end gap-3 pb-6">' +
      '<button onclick="loadView(\'secretary-manager\')" class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSubmitOnboarding()" id="pa-ob-submit-btn" class="px-8 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-lg"><i class="fas fa-rocket mr-2"></i>Create Customer & Deploy Secretary</button>' +
    '</div>' +
  '</div>';
}

async function paLoadTiers() {
  try {
    var res = await paFetch('/membership-tiers');
    var data = await res.json();
    PA.tiers = data.tiers || [];
    var el = document.getElementById('pa-tier-cards');
    if (!el) return;
    if (PA.tiers.length === 0) { el.innerHTML = '<p class="col-span-3 text-gray-400 text-sm">No tiers configured. <a href="#" onclick="loadView(\'membership-config\')" class="text-teal-600 underline">Create tiers</a></p>'; return; }
    el.innerHTML = PA.tiers.map(function(t) {
      return '<div class="border-2 rounded-xl p-4 cursor-pointer transition-all hover:shadow-md ' +
        (PA.selectedTier == t.id ? 'border-teal-500 bg-teal-50 shadow-md' : 'border-gray-200 bg-white') +
        '" onclick="PA.selectedTier=' + t.id + ';paLoadTiers()">' +
        '<div class="flex items-center justify-between mb-2"><span class="font-bold text-gray-800">' + t.name + '</span>' +
        '<span class="text-lg font-bold text-teal-600">$' + (t.monthly_price_cents / 100).toFixed(0) + '/mo</span></div>' +
        '<p class="text-xs text-gray-500">' + t.description + '</p>' +
        '<div class="mt-2 flex flex-wrap gap-1">' +
          '<span class="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">' + t.included_reports + ' reports</span>' +
          '<span class="px-2 py-0.5 bg-green-50 text-green-600 rounded text-xs">' + t.included_minutes + ' min</span>' +
          (t.secretary_included ? '<span class="px-2 py-0.5 bg-violet-50 text-violet-600 rounded text-xs">Secretary</span>' : '') +
          (t.cold_call_included ? '<span class="px-2 py-0.5 bg-orange-50 text-orange-600 rounded text-xs">Cold Call</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) { console.error('tiers load error', e); }
}

async function paSubmitOnboarding() {
  var btn = document.getElementById('pa-ob-submit-btn');
  if (btn) btn.disabled = true;
  var dirs = [];
  for (var i = 1; i <= 4; i++) {
    var dn = gv('pa-ob-dir-name-' + i);
    if (dn) dirs.push({ name: dn, phone_or_action: gv('pa-ob-dir-phone-' + i), special_notes: gv('pa-ob-dir-notes-' + i) });
  }
  var team = [];
  for (var j = 1; j <= 5; j++) {
    var tn = gv('pa-ob-tm-name-' + j);
    var te = gv('pa-ob-tm-email-' + j);
    if (tn && te) team.push({ name: tn, email: te, role: gv('pa-ob-tm-role-' + j) || 'member', phone: gv('pa-ob-tm-phone-' + j) || '' });
  }
  try {
    var res = await paFetch('/onboard-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_name: gv('pa-ob-business'), contact_name: gv('pa-ob-contact'),
        email: gv('pa-ob-email'), password: gv('pa-ob-password'),
        phone: gv('pa-ob-phone'), carrier: gv('pa-ob-carrier'),
        membership_tier_id: PA.selectedTier || null,
        agent_name: gv('pa-ob-agent-name') || 'Sarah',
        agent_voice: gv('pa-ob-agent-voice') || 'alloy',
        secretary_mode: gv('pa-ob-mode') || 'full',
        greeting_script: gv('pa-ob-greeting'),
        common_qa: gv('pa-ob-qa'), general_notes: gv('pa-ob-notes'),
        agent_phone_number: gv('pa-ob-agent-phone'),
        directories: dirs, team_members: team
      })
    });
    var data = await res.json();
    if (data.success) {
      alert('Customer onboarded!\n\n' + data.message + '\nTeam members created: ' + data.team_members_created);
      loadView('secretary-manager');
    } else { alert('Error: ' + (data.error || 'Unknown error')); }
  } catch(e) { alert('Error: ' + e.message); }
  if (btn) btn.disabled = false;
}

var paTeamCount = 2;
function paAddTeamRow() {
  paTeamCount++;
  var el = document.getElementById('pa-ob-team');
  if (!el) return;
  var row = document.createElement('div');
  row.className = 'grid grid-cols-4 gap-3';
  row.innerHTML = '<input id="pa-ob-tm-name-'+paTeamCount+'" placeholder="Name" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
    '<input id="pa-ob-tm-email-'+paTeamCount+'" placeholder="Email" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">' +
    '<select id="pa-ob-tm-role-'+paTeamCount+'" class="px-3 py-2 border border-gray-200 rounded-lg text-sm"><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select>' +
    '<input id="pa-ob-tm-phone-'+paTeamCount+'" placeholder="Phone" class="px-3 py-2 border border-gray-200 rounded-lg text-sm">';
  el.appendChild(row);
}

// ════════════════════════════════════════════════════════════════
// MODULE 2: VOICE SECRETARY SETUP
// ════════════════════════════════════════════════════════════════
function renderVoiceSetupView(customerId) {
  PA.editCustomerId = customerId;
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-microphone-alt mr-2 text-violet-600"></i>Voice Secretary Configuration</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Configure voice agent, notifications, speech speed & test the agent</p></div>' +
      '<button onclick="loadView(\'service-panel\')" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-semibold"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
    '</div>' +
    '<div id="pa-voice-content" class="space-y-6"><div class="animate-pulse bg-gray-100 rounded-xl h-64"></div></div>' +
  '</div>';
}

async function paLoadVoiceConfig(customerId) {
  try {
    var res = await paFetch('/customers/' + customerId + '/voice-config');
    var data = await res.json();
    PA.voiceConfig = data.config;
    paRenderVoiceConfigForm();
  } catch(e) { document.getElementById('pa-voice-content').innerHTML = '<p class="text-red-500">Error: ' + e.message + '</p>'; }
}

function paRenderVoiceConfigForm() {
  var c = PA.voiceConfig;
  if (!c) return;
  var el = document.getElementById('pa-voice-content');
  if (!el) return;
  el.innerHTML =
    // Status bar
    '<div class="flex items-center gap-4 p-4 bg-gradient-to-r from-violet-50 to-blue-50 rounded-xl border border-violet-100">' +
      '<div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full ' + (c.is_active ? 'bg-green-500 animate-pulse' : 'bg-red-400') + '"></span><span class="text-sm font-semibold">' + (c.is_active ? 'Active' : 'Inactive') + '</span></div>' +
      '<div class="text-sm text-gray-600"><i class="fas fa-phone mr-1"></i>' + (c.assigned_phone_number || 'No number') + '</div>' +
      '<div class="text-sm text-gray-600"><i class="fas fa-signal mr-1"></i>' + (c.connection_status || 'unknown') + '</div>' +
      '<div class="ml-auto"><button onclick="paTestAgent()" class="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold"><i class="fas fa-play mr-1"></i>Test Agent</button></div>' +
    '</div>' +

    // Voice & Agent
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-user-tie mr-2 text-violet-500"></i>Agent Identity</h3>' +
      '<div class="grid grid-cols-3 gap-4">' +
        paInputV('pa-vc-name', 'Agent Name', c.agent_name) +
        paSelectV('pa-vc-voice', 'Voice', ['alloy','shimmer','nova','echo','onyx','fable','ash','coral','sage'], c.agent_voice) +
        paSelectV('pa-vc-lang', 'Language', ['en','es','fr','de','zh','ja','ko'], c.agent_language) +
      '</div>' +
      '<div class="grid grid-cols-4 gap-4 mt-4">' +
        paSelectV('pa-vc-mode', 'Mode', ['full','answering','directory','receptionist','always_on'], c.secretary_mode) +
        paSelectV('pa-vc-voice-provider', 'Voice Provider', ['openai','elevenlabs','cartesia','deepgram'], c.voice_provider || 'openai') +
        paInputV('pa-vc-voice-model', 'Voice Model ID', c.voice_model_id || '') +
        paSelectV('pa-vc-stt', 'STT Provider', ['deepgram','whisper','google'], c.stt_provider || 'deepgram') +
      '</div>' +
    '</div>' +

    // Speech Tuning
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-sliders-h mr-2 text-blue-500"></i>Speech Tuning</h3>' +
      '<div class="grid grid-cols-2 gap-6">' +
        paSlider('pa-vc-speed', 'Speech Speed', c.voice_speed || 1.0, 0.5, 2.0, 0.1) +
        paSlider('pa-vc-pause', 'Pause Between Replies (ms)', c.voice_pause_ms || 800, 200, 2000, 100) +
        paSlider('pa-vc-stability', 'Voice Stability', c.voice_stability || 0.5, 0, 1, 0.1) +
        paSlider('pa-vc-similarity', 'Voice Similarity', c.voice_similarity || 0.75, 0, 1, 0.05) +
        paSlider('pa-vc-endpointing', 'Endpointing (silence before reply, ms)', c.endpointing_ms || 300, 100, 1000, 50) +
        paSlider('pa-vc-interrupt', 'Interruption Sensitivity', c.interruption_threshold || 0.5, 0, 1, 0.1) +
      '</div>' +
    '</div>' +

    // LLM Config
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-brain mr-2 text-pink-500"></i>LLM Configuration</h3>' +
      '<div class="grid grid-cols-4 gap-4">' +
        paSelectV('pa-vc-llm-provider', 'LLM Provider', ['openai','anthropic','google'], c.llm_provider || 'openai') +
        paSelectV('pa-vc-llm-model', 'Model', ['gpt-4o-mini','gpt-4o','gpt-4-turbo','claude-3.5-sonnet','claude-3-haiku','gemini-2.5-flash','gemini-2.5-pro'], c.llm_model || 'gpt-4o-mini') +
        paSlider('pa-vc-llm-temp', 'Temperature', c.llm_temperature || 0.7, 0, 1, 0.1) +
        paInputV('pa-vc-llm-tokens', 'Max Tokens', c.llm_max_tokens || 200, 'number') +
      '</div>' +
    '</div>' +

    // Notifications
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-bell mr-2 text-amber-500"></i>Notifications</h3>' +
      '<div class="grid grid-cols-3 gap-4">' +
        '<label class="flex items-center gap-2"><input type="checkbox" id="pa-vc-sms-notify" ' + (c.answering_sms_notify ? 'checked' : '') + ' class="rounded"> SMS on new lead</label>' +
        '<label class="flex items-center gap-2"><input type="checkbox" id="pa-vc-email-notify" ' + (c.answering_email_notify ? 'checked' : '') + ' class="rounded"> Email on new lead</label>' +
        paInputV('pa-vc-notify-email', 'Notification Email', c.answering_notify_email || '') +
      '</div>' +
      '<div class="grid grid-cols-2 gap-4 mt-4">' +
        paSelectV('pa-vc-fallback', 'Fallback Action', ['take_message','forward_call','voicemail'], c.answering_fallback_action || 'take_message') +
        paInputV('pa-vc-forward-num', 'Forward Number', c.answering_forward_number || '') +
      '</div>' +
    '</div>' +

    // Greeting & Scripts
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-scroll mr-2 text-teal-500"></i>Scripts</h3>' +
      '<label class="block text-xs font-semibold text-gray-500 mb-1">Greeting Script</label>' +
      '<textarea id="pa-vc-greeting" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (c.greeting_script || '') + '</textarea>' +
      '<div class="grid grid-cols-2 gap-4 mt-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Common Q&A</label><textarea id="pa-vc-qa" rows="4" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + (c.common_qa || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">General Notes</label><textarea id="pa-vc-notes" rows="4" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (c.general_notes || '') + '</textarea></div>' +
      '</div>' +
    '</div>' +

    // Capabilities
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="text-lg font-bold text-gray-700 mb-4"><i class="fas fa-cogs mr-2 text-gray-500"></i>Capabilities</h3>' +
      '<div class="grid grid-cols-2 gap-3">' +
        paCheckbox('pa-vc-book', 'Book Appointments', c.full_can_book_appointments) +
        paCheckbox('pa-vc-send-email', 'Send Emails', c.full_can_send_email) +
        paCheckbox('pa-vc-callback', 'Schedule Callbacks', c.full_can_schedule_callback) +
        paCheckbox('pa-vc-faq', 'Answer FAQ', c.full_can_answer_faq) +
      '</div>' +
      '<div class="grid grid-cols-2 gap-4 mt-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Business Hours (JSON)</label><textarea id="pa-vc-hours" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + (c.full_business_hours || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Services Offered</label><textarea id="pa-vc-services" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (c.full_services_offered || '') + '</textarea></div>' +
      '</div>' +
    '</div>' +

    // Save
    '<div class="flex justify-end gap-3 pb-6">' +
      '<button onclick="loadView(\'service-panel\')" class="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSaveVoiceConfig()" class="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold shadow-lg"><i class="fas fa-save mr-2"></i>Save Voice Config</button>' +
    '</div>';
}

async function paSaveVoiceConfig() {
  try {
    var res = await paFetch('/customers/' + PA.editCustomerId + '/voice-config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: gv('pa-vc-name'), agent_voice: gv('pa-vc-voice'), agent_language: gv('pa-vc-lang'),
        secretary_mode: gv('pa-vc-mode'), voice_provider: gv('pa-vc-voice-provider'), voice_model_id: gv('pa-vc-voice-model'),
        stt_provider: gv('pa-vc-stt'),
        voice_speed: parseFloat(gv('pa-vc-speed')), voice_pause_ms: parseInt(gv('pa-vc-pause')),
        voice_stability: parseFloat(gv('pa-vc-stability')), voice_similarity: parseFloat(gv('pa-vc-similarity')),
        endpointing_ms: parseInt(gv('pa-vc-endpointing')), interruption_threshold: parseFloat(gv('pa-vc-interrupt')),
        llm_provider: gv('pa-vc-llm-provider'), llm_model: gv('pa-vc-llm-model'),
        llm_temperature: parseFloat(gv('pa-vc-llm-temp')), llm_max_tokens: parseInt(gv('pa-vc-llm-tokens')),
        answering_sms_notify: document.getElementById('pa-vc-sms-notify')?.checked ? 1 : 0,
        answering_email_notify: document.getElementById('pa-vc-email-notify')?.checked ? 1 : 0,
        answering_notify_email: gv('pa-vc-notify-email'),
        answering_fallback_action: gv('pa-vc-fallback'), answering_forward_number: gv('pa-vc-forward-num'),
        greeting_script: gv('pa-vc-greeting'), common_qa: gv('pa-vc-qa'), general_notes: gv('pa-vc-notes'),
        full_can_book_appointments: document.getElementById('pa-vc-book')?.checked ? 1 : 0,
        full_can_send_email: document.getElementById('pa-vc-send-email')?.checked ? 1 : 0,
        full_can_schedule_callback: document.getElementById('pa-vc-callback')?.checked ? 1 : 0,
        full_can_answer_faq: document.getElementById('pa-vc-faq')?.checked ? 1 : 0,
        full_business_hours: gv('pa-vc-hours'), full_services_offered: gv('pa-vc-services')
      })
    });
    var data = await res.json();
    if (data.success) alert('Voice config saved!');
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert('Error: ' + e.message); }
}

async function paTestAgent() {
  try {
    var res = await paFetch('/customers/' + PA.editCustomerId + '/test-agent', { method: 'POST' });
    var data = await res.json();
    alert(data.message || 'Test initiated');
  } catch(e) { alert('Error: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
// MODULE 3: AGENT PERSONA & LLM MODULE
// ════════════════════════════════════════════════════════════════
function renderAgentPersonasView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-theater-masks mr-2 text-orange-600"></i>Agent Personas & LLM Configuration</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Configure AI agent personas with model selection, TTS/STT, and latency tuning</p></div>' +
      '<button onclick="paCreatePersona()" class="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-bold shadow-md"><i class="fas fa-plus mr-2"></i>New Persona</button>' +
    '</div>' +
    '<div id="pa-personas-list" class="space-y-4"><div class="animate-pulse bg-gray-100 rounded-xl h-32"></div></div>' +
  '</div>';
}

async function paLoadPersonas() {
  try {
    var res = await paFetch('/agent-personas');
    var data = await res.json();
    PA.personas = data.personas || [];
    paRenderPersonasList();
  } catch(e) { console.error(e); }
}

function paRenderPersonasList() {
  var el = document.getElementById('pa-personas-list');
  if (!el) return;
  if (PA.personas.length === 0) {
    el.innerHTML = '<div class="text-center py-12"><i class="fas fa-theater-masks text-4xl text-gray-200 mb-4"></i><p class="text-gray-400">No personas yet. Create one to get started.</p></div>';
    return;
  }
  el.innerHTML = PA.personas.map(function(p) {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-lg font-bold">' + p.name.charAt(0) + '</div>' +
          '<div><h4 class="font-bold text-gray-800">' + p.name + '</h4><p class="text-xs text-gray-500">' + (p.description || 'No description') + '</p></div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-semibold">' + (p.llm_provider || 'openai') + '/' + (p.llm_model || 'gpt-4o') + '</span>' +
          '<span class="px-2 py-1 bg-violet-50 text-violet-600 rounded text-xs font-semibold">' + (p.tts_provider || 'openai') + ':' + (p.tts_voice_id || 'alloy') + '</span>' +
          '<span class="px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-semibold">' + p.total_calls_made + ' calls</span>' +
          '<button onclick="paEditPersona(' + p.id + ')" class="px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg text-xs font-semibold hover:bg-orange-100"><i class="fas fa-edit mr-1"></i>Edit</button>' +
          '<button onclick="paDeletePersona(' + p.id + ')" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100"><i class="fas fa-trash mr-1"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="mt-3 grid grid-cols-6 gap-2 text-xs text-gray-500">' +
        '<div><span class="font-semibold">Speed:</span> ' + (p.tts_speed || 1.0) + 'x</div>' +
        '<div><span class="font-semibold">STT:</span> ' + (p.stt_provider || 'deepgram') + '</div>' +
        '<div><span class="font-semibold">Endpointing:</span> ' + (p.endpointing_ms || 300) + 'ms</div>' +
        '<div><span class="font-semibold">Interrupt:</span> ' + ((p.interruption_sensitivity || 0.5) * 100).toFixed(0) + '%</div>' +
        '<div><span class="font-semibold">Pause:</span> ' + (p.pause_before_reply_ms || 500) + 'ms</div>' +
        '<div><span class="font-semibold">Temp:</span> ' + (p.llm_temperature || 0.7) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function paCreatePersona() {
  PA.currentPersona = { name: '', description: '', llm_provider: 'openai', llm_model: 'gpt-4o', llm_temperature: 0.7, system_prompt: '', tts_provider: 'openai', tts_voice_id: 'alloy', tts_speed: 1.0, stt_provider: 'deepgram', endpointing_ms: 300, interruption_sensitivity: 0.5, pause_before_reply_ms: 500, script_opening: '', script_value_prop: '', script_objections: '[]', script_closing: '', script_voicemail: '', knowledge_docs: '', dynamic_variables: {} };
  paShowPersonaEditor();
}

async function paEditPersona(id) {
  try {
    var res = await paFetch('/agent-personas/' + id);
    var data = await res.json();
    PA.currentPersona = data.persona;
    PA.currentPersona._variants = data.variants || [];
    paShowPersonaEditor();
  } catch(e) { alert('Error: ' + e.message); }
}

function paShowPersonaEditor() {
  var p = PA.currentPersona;
  var el = document.getElementById('pa-personas-list');
  if (!el) return;
  var isNew = !p.id;
  el.innerHTML =
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">' +
      '<h3 class="text-lg font-bold text-gray-700">' + (isNew ? '<i class="fas fa-plus mr-2 text-orange-500"></i>New Agent Persona' : '<i class="fas fa-edit mr-2 text-orange-500"></i>Edit: ' + p.name) + '</h3>' +

      // Identity
      '<div class="grid grid-cols-2 gap-4">' +
        paInputV('pa-pe-name', 'Persona Name *', p.name) +
        paInputV('pa-pe-desc', 'Description', p.description || '') +
      '</div>' +

      // LLM
      '<h4 class="font-bold text-gray-600 border-b pb-2"><i class="fas fa-brain mr-2 text-pink-500"></i>LLM Configuration</h4>' +
      '<div class="grid grid-cols-4 gap-4">' +
        paSelectV('pa-pe-llm', 'Provider', ['openai','anthropic','google'], p.llm_provider) +
        paSelectV('pa-pe-model', 'Model', ['gpt-4o','gpt-4o-mini','gpt-4-turbo','claude-3.5-sonnet','claude-3-haiku','gemini-2.5-flash','gemini-2.5-pro'], p.llm_model) +
        paSlider('pa-pe-temp', 'Temperature', p.llm_temperature || 0.7, 0, 1, 0.1) +
        '<div></div>' +
      '</div>' +
      '<div><label class="block text-xs font-semibold text-gray-500 mb-1">System Prompt</label>' +
      '<textarea id="pa-pe-prompt" rows="6" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + (p.system_prompt || '') + '</textarea></div>' +

      // TTS/STT
      '<h4 class="font-bold text-gray-600 border-b pb-2"><i class="fas fa-microphone mr-2 text-violet-500"></i>Voice & Speech</h4>' +
      '<div class="grid grid-cols-4 gap-4">' +
        paSelectV('pa-pe-tts', 'TTS Provider', ['openai','elevenlabs','cartesia','deepgram'], p.tts_provider) +
        paInputV('pa-pe-voice', 'Voice ID', p.tts_voice_id) +
        paSlider('pa-pe-speed', 'Speed', p.tts_speed || 1.0, 0.5, 2.0, 0.1) +
        paSelectV('pa-pe-stt', 'STT Provider', ['deepgram','whisper','google'], p.stt_provider) +
      '</div>' +

      // Latency
      '<h4 class="font-bold text-gray-600 border-b pb-2"><i class="fas fa-tachometer-alt mr-2 text-blue-500"></i>Latency & Interruption</h4>' +
      '<div class="grid grid-cols-3 gap-4">' +
        paSlider('pa-pe-endp', 'Endpointing (ms)', p.endpointing_ms || 300, 100, 1000, 50) +
        paSlider('pa-pe-inter', 'Interrupt Sensitivity', p.interruption_sensitivity || 0.5, 0, 1, 0.1) +
        paSlider('pa-pe-pause', 'Pause Before Reply (ms)', p.pause_before_reply_ms || 500, 100, 2000, 100) +
      '</div>' +

      // Scripts
      '<h4 class="font-bold text-gray-600 border-b pb-2"><i class="fas fa-scroll mr-2 text-teal-500"></i>Call Scripts</h4>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Opening Script</label><textarea id="pa-pe-opening" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (p.script_opening || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Value Proposition</label><textarea id="pa-pe-value" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (p.script_value_prop || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Objection Handling (JSON)</label><textarea id="pa-pe-objections" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + (p.script_objections || '[]') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Closing Script</label><textarea id="pa-pe-closing" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (p.script_closing || '') + '</textarea></div>' +
      '</div>' +
      '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Voicemail Script</label><textarea id="pa-pe-voicemail" rows="2" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (p.script_voicemail || '') + '</textarea></div>' +

      // Knowledge Base
      '<h4 class="font-bold text-gray-600 border-b pb-2"><i class="fas fa-book mr-2 text-amber-500"></i>Knowledge Base & Variables</h4>' +
      '<div class="grid grid-cols-2 gap-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Knowledge Docs</label><textarea id="pa-pe-knowledge" rows="4" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (p.knowledge_docs || '') + '</textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Dynamic Variables (JSON)</label><textarea id="pa-pe-vars" rows="4" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + JSON.stringify(typeof p.dynamic_variables === 'string' ? JSON.parse(p.dynamic_variables || '{}') : p.dynamic_variables || {}, null, 2) + '</textarea></div>' +
      '</div>' +

      // Buttons
      '<div class="flex justify-end gap-3">' +
        '<button onclick="paLoadPersonas()" class="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold">Cancel</button>' +
        '<button onclick="paSavePersona()" class="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-bold shadow-md"><i class="fas fa-save mr-2"></i>Save Persona</button>' +
      '</div>' +
    '</div>';
}

async function paSavePersona() {
  var p = PA.currentPersona;
  var payload = {
    name: gv('pa-pe-name'), description: gv('pa-pe-desc'),
    llm_provider: gv('pa-pe-llm'), llm_model: gv('pa-pe-model'), llm_temperature: parseFloat(gv('pa-pe-temp')),
    system_prompt: gv('pa-pe-prompt'),
    tts_provider: gv('pa-pe-tts'), tts_voice_id: gv('pa-pe-voice'), tts_speed: parseFloat(gv('pa-pe-speed')),
    stt_provider: gv('pa-pe-stt'),
    endpointing_ms: parseInt(gv('pa-pe-endp')), interruption_sensitivity: parseFloat(gv('pa-pe-inter')), pause_before_reply_ms: parseInt(gv('pa-pe-pause')),
    script_opening: gv('pa-pe-opening'), script_value_prop: gv('pa-pe-value'),
    script_objections: gv('pa-pe-objections'), script_closing: gv('pa-pe-closing'), script_voicemail: gv('pa-pe-voicemail'),
    knowledge_docs: gv('pa-pe-knowledge')
  };
  try { payload.dynamic_variables = JSON.parse(gv('pa-pe-vars') || '{}'); } catch(e) { payload.dynamic_variables = {}; }
  try {
    var url = p.id ? '/agent-personas/' + p.id : '/agent-personas';
    var res = await paFetch(url, { method: p.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var data = await res.json();
    if (data.success || data.id) { alert('Persona saved!'); paLoadPersonas(); }
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert('Error: ' + e.message); }
}

async function paDeletePersona(id) {
  if (!confirm('Deactivate this persona?')) return;
  try { await paFetch('/agent-personas/' + id, { method: 'DELETE' }); paLoadPersonas(); } catch(e) { alert(e.message); }
}

// ════════════════════════════════════════════════════════════════
// MODULE 5: COLD-CALL CENTRE (SIP mapping, campaigns)
// ════════════════════════════════════════════════════════════════
function renderColdCallCentreView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-headset mr-2 text-red-600"></i>Cold-Call Centre</h2>' +
      '<p class="text-sm text-gray-500 mt-1">SIP trunk mapping, campaign management, CSV upload, DNC lists</p></div>' +
    '</div>' +
    '<div class="flex gap-2 border-b border-gray-200 pb-2">' +
      '<button onclick="paShowCCTab(\'sip\')" id="pa-cc-tab-sip" class="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white">SIP Mapping</button>' +
      '<button onclick="paShowCCTab(\'campaigns\')" id="pa-cc-tab-campaigns" class="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600">Campaigns</button>' +
      '<button onclick="paShowCCTab(\'analytics\')" id="pa-cc-tab-analytics" class="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600">Analytics</button>' +
    '</div>' +
    '<div id="pa-cc-content" class="space-y-4"><div class="animate-pulse bg-gray-100 rounded-xl h-48"></div></div>' +
  '</div>';
}

function paShowCCTab(tab) {
  ['sip','campaigns','analytics'].forEach(function(t) {
    var el = document.getElementById('pa-cc-tab-' + t);
    if (el) { el.className = t === tab ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white' : 'px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200'; }
  });
  if (tab === 'sip') paLoadSipMapping();
  else if (tab === 'campaigns') paLoadCampaigns();
  else if (tab === 'analytics') paLoadCCAnalytics();
}

async function paLoadSipMapping() {
  var el = document.getElementById('pa-cc-content');
  if (!el) return;
  try {
    var res = await paFetch('/sip-mapping');
    var data = await res.json();
    PA.sipMap = data.phones || [];
    if (PA.sipMap.length === 0) { el.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-phone-slash text-4xl mb-4"></i><p>No SIP phones configured. Add phones in the Call Center phone setup first.</p></div>'; return; }
    el.innerHTML = '<div class="space-y-3">' + PA.sipMap.map(function(ph) {
      return '<div class="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">' +
        '<div class="flex items-center gap-4">' +
          '<div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center"><i class="fas fa-phone-alt text-gray-500"></i></div>' +
          '<div><div class="font-semibold text-gray-800">' + (ph.label || ph.assigned_phone_number || 'Unnamed') + '</div>' +
          '<div class="text-xs text-gray-500">' + (ph.assigned_phone_number || 'No number') + ' &bull; ' + (ph.agent_type || 'cold_call') + '</div></div>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
          '<span class="px-2 py-1 rounded text-xs font-semibold ' + (ph.persona_name ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-400') + '">' + (ph.persona_name || 'No persona') + '</span>' +
          '<span class="px-2 py-1 rounded text-xs font-semibold ' + (ph.is_active ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-400') + '">' + (ph.is_active ? 'Active' : 'Inactive') + '</span>' +
          '<button onclick="paEditSipMapping(' + ph.id + ')" class="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100"><i class="fas fa-link mr-1"></i>Map Persona</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

async function paEditSipMapping(phoneId) {
  var ph = PA.sipMap.find(function(p) { return p.id === phoneId; });
  if (!ph) return;
  // Load personas if not loaded
  if (PA.personas.length === 0) {
    try { var r = await paFetch('/agent-personas'); var d = await r.json(); PA.personas = d.personas || []; } catch(e) {}
  }
  var opts = '<option value="">None</option>' + PA.personas.map(function(p) { return '<option value="' + p.id + '" ' + (ph.agent_persona_id == p.id ? 'selected' : '') + '>' + p.name + '</option>'; }).join('');
  var el = document.getElementById('pa-cc-content');
  el.innerHTML = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">' +
    '<h3 class="font-bold text-gray-700"><i class="fas fa-link mr-2 text-blue-500"></i>Map: ' + (ph.label || ph.assigned_phone_number) + '</h3>' +
    '<div class="grid grid-cols-3 gap-4">' +
      '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Agent Persona</label><select id="pa-sip-persona" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">' + opts + '</select></div>' +
      paSelectV('pa-sip-type', 'Agent Type', ['cold_call','answering','secretary'], ph.agent_type || 'cold_call') +
      paInputV('pa-sip-voice', 'Voice ID Override', ph.agent_voice_id || 'alloy') +
    '</div>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paSlider('pa-sip-speed', 'Speed', ph.agent_speed || 1.0, 0.5, 2.0, 0.1) +
      paSlider('pa-sip-pause', 'Pause (ms)', ph.agent_pause_ms || 500, 100, 2000, 100) +
      '<div></div>' +
    '</div>' +
    '<div><label class="block text-xs font-semibold text-gray-500 mb-1">System Prompt Override</label><textarea id="pa-sip-prompt" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (ph.agent_system_prompt || '') + '</textarea></div>' +
    '<div class="flex justify-end gap-3">' +
      '<button onclick="paLoadSipMapping()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSaveSipMapping(' + phoneId + ')" class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-save mr-1"></i>Save</button>' +
    '</div>' +
  '</div>';
}

async function paSaveSipMapping(phoneId) {
  try {
    var res = await paFetch('/sip-mapping/' + phoneId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_persona_id: gv('pa-sip-persona') || null, agent_type: gv('pa-sip-type'),
        agent_voice_id: gv('pa-sip-voice'), agent_speed: parseFloat(gv('pa-sip-speed')),
        agent_pause_ms: parseInt(gv('pa-sip-pause')), agent_system_prompt: gv('pa-sip-prompt')
      })
    });
    var data = await res.json();
    if (data.success) paLoadSipMapping();
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert(e.message); }
}

async function paLoadCampaigns() {
  var el = document.getElementById('pa-cc-content');
  if (!el) return;
  try {
    var res = await paFetch('/campaigns');
    var data = await res.json();
    PA.campaigns = data.campaigns || [];
    el.innerHTML = '<div class="flex justify-end mb-4"><button onclick="paShowCampaignEditor()" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-plus mr-1"></i>New Campaign</button></div>' +
      (PA.campaigns.length === 0 ? '<div class="text-center py-12 text-gray-400">No campaigns yet.</div>' :
      '<div class="space-y-3">' + PA.campaigns.map(function(c) {
        return '<div class="bg-white rounded-xl border border-gray-100 p-4">' +
          '<div class="flex items-center justify-between">' +
            '<div><h4 class="font-bold text-gray-800">' + c.name + '</h4><p class="text-xs text-gray-500">' + (c.persona_name || 'No persona') + ' &bull; ' + (c.prospect_count || 0) + ' prospects &bull; ' + (c.status || 'draft') + '</p></div>' +
            '<div class="flex gap-2">' +
              '<span class="px-2 py-1 rounded text-xs font-semibold ' + (c.status === 'active' ? 'bg-green-50 text-green-600' : c.status === 'paused' ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-50 text-gray-500') + '">' + (c.status || 'draft') + '</span>' +
              '<button onclick="paShowCSVUpload(' + c.id + ')" class="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100"><i class="fas fa-upload mr-1"></i>CSV</button>' +
              '<button onclick="paShowCampaignEditor(' + c.id + ')" class="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100"><i class="fas fa-edit mr-1"></i>Edit</button>' +
            '</div>' +
          '</div>' +
          '<div class="mt-2 flex gap-4 text-xs text-gray-500">' +
            '<span>Days: ' + (c.operating_days || 'mon-fri') + '</span>' +
            '<span>Concurrent: ' + (c.max_concurrent_calls || 1) + '</span>' +
            '<span>Auto-dial: ' + (c.auto_dial ? 'Yes' : 'No') + '</span>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>');
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

function paShowCampaignEditor(campId) {
  var c = campId ? PA.campaigns.find(function(x) { return x.id === campId; }) : { name: '', status: 'draft', operating_days: 'mon,tue,wed,thu,fri', max_concurrent_calls: 1, auto_dial: 0, dnc_list: '' };
  if (!c) return;
  var el = document.getElementById('pa-cc-content');
  // Load personas for dropdown
  var opts = '<option value="">None</option>' + PA.personas.map(function(p) { return '<option value="' + p.id + '" ' + (c.agent_persona_id == p.id ? 'selected' : '') + '>' + p.name + '</option>'; }).join('');
  el.innerHTML = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">' +
    '<h3 class="font-bold text-gray-700"><i class="fas fa-bullhorn mr-2 text-red-500"></i>' + (campId ? 'Edit Campaign' : 'New Campaign') + '</h3>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paInputV('pa-camp-name', 'Name *', c.name) +
      '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Agent Persona</label><select id="pa-camp-persona" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">' + opts + '</select></div>' +
      paSelectV('pa-camp-status', 'Status', ['draft','active','paused','completed'], c.status) +
    '</div>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paInputV('pa-camp-days', 'Operating Days', c.operating_days || 'mon,tue,wed,thu,fri') +
      paInputV('pa-camp-concurrent', 'Max Concurrent Calls', c.max_concurrent_calls || 1, 'number') +
      '<label class="flex items-center gap-2 mt-6"><input type="checkbox" id="pa-camp-auto" ' + (c.auto_dial ? 'checked' : '') + ' class="rounded"> Auto-dial</label>' +
    '</div>' +
    '<div><label class="block text-xs font-semibold text-gray-500 mb-1">DNC List (comma-separated phones)</label><textarea id="pa-camp-dnc" rows="2" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono">' + (c.dnc_list || '') + '</textarea></div>' +
    '<div class="flex justify-end gap-3">' +
      '<button onclick="paLoadCampaigns()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSaveCampaign(' + (campId || 0) + ')" class="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-save mr-1"></i>Save</button>' +
    '</div>' +
  '</div>';
}

async function paSaveCampaign(campId) {
  var payload = { name: gv('pa-camp-name'), agent_persona_id: gv('pa-camp-persona') || null, status: gv('pa-camp-status'), operating_days: gv('pa-camp-days'), max_concurrent_calls: parseInt(gv('pa-camp-concurrent')) || 1, auto_dial: document.getElementById('pa-camp-auto')?.checked ? 1 : 0, dnc_list: gv('pa-camp-dnc') };
  try {
    var url = campId ? '/campaigns/' + campId : '/campaigns';
    var res = await paFetch(url, { method: campId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var data = await res.json();
    if (data.success || data.id) paLoadCampaigns();
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert(e.message); }
}

function paShowCSVUpload(campId) {
  var el = document.getElementById('pa-cc-content');
  el.innerHTML = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">' +
    '<h3 class="font-bold text-gray-700"><i class="fas fa-file-csv mr-2 text-green-500"></i>Upload Prospects CSV — Campaign #' + campId + '</h3>' +
    '<p class="text-sm text-gray-500">Paste CSV data below. Expected columns: company_name, contact_name, phone, email, city, state, job_title, notes, tags</p>' +
    '<textarea id="pa-csv-data" rows="10" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono" placeholder="company_name,contact_name,phone,email,city,state&#10;Acme Roofing,John Doe,+14035551234,john@acme.com,Calgary,AB"></textarea>' +
    '<div class="flex justify-end gap-3">' +
      '<button onclick="paLoadCampaigns()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
      '<button onclick="paProcessCSV(' + campId + ')" class="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-upload mr-1"></i>Import</button>' +
    '</div>' +
  '</div>';
}

async function paProcessCSV(campId) {
  var raw = gv('pa-csv-data');
  if (!raw) { alert('Paste CSV data first'); return; }
  var lines = raw.trim().split('\n');
  var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase().replace(/[^a-z_]/g, ''); });
  var prospects = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = lines[i].split(',');
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = (vals[idx] || '').trim(); });
    if (obj.phone) prospects.push(obj);
  }
  if (prospects.length === 0) { alert('No valid prospects found'); return; }
  try {
    var res = await paFetch('/campaigns/' + campId + '/upload-csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospects: prospects })
    });
    var data = await res.json();
    alert('Imported: ' + data.imported + ', Skipped: ' + data.skipped);
    paLoadCampaigns();
  } catch(e) { alert(e.message); }
}

async function paLoadCCAnalytics() {
  var el = document.getElementById('pa-cc-content');
  if (!el) return;
  try {
    var [dispRes, costRes] = await Promise.all([paFetch('/analytics/dispositions'), paFetch('/analytics/costs')]);
    var disp = await dispRes.json();
    var costs = await costRes.json();
    el.innerHTML =
      '<div class="grid grid-cols-2 gap-6">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
          '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-chart-pie mr-2 text-blue-500"></i>Call Dispositions</h3>' +
          (disp.dispositions && disp.dispositions.length > 0 ? '<div class="space-y-2">' + disp.dispositions.map(function(d) {
            return '<div class="flex justify-between items-center"><span class="text-sm text-gray-600">' + (d.outcome || 'unknown') + '</span><span class="text-sm font-bold">' + d.count + '</span></div>';
          }).join('') + '</div>' : '<p class="text-gray-400 text-sm">No data yet</p>') +
        '</div>' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
          '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-dollar-sign mr-2 text-green-500"></i>Cost Breakdown (30d)</h3>' +
          (costs.daily_costs && costs.daily_costs.length > 0 ? '<div class="space-y-2">' + costs.daily_costs.slice(-7).map(function(d) {
            return '<div class="flex justify-between items-center"><span class="text-sm text-gray-600">' + d.day + '</span><span class="text-sm font-bold">$' + (d.total / 100).toFixed(2) + '</span></div>';
          }).join('') + '</div>' : '<p class="text-gray-400 text-sm">No cost data yet</p>') +
        '</div>' +
      '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

// ════════════════════════════════════════════════════════════════
// MODULE 6: LIVE DASHBOARD
// ════════════════════════════════════════════════════════════════
function renderLiveDashboardView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-satellite-dish mr-2 text-green-600 animate-pulse"></i>Live Operations Dashboard</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Active calls, real-time stats, cost tracking</p></div>' +
      '<button onclick="paLoadLiveDashboard()" class="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold"><i class="fas fa-sync-alt mr-2"></i>Refresh</button>' +
    '</div>' +
    '<div id="pa-live-content" class="space-y-6"><div class="animate-pulse bg-gray-100 rounded-xl h-64"></div></div>' +
  '</div>';
}

async function paLoadLiveDashboard() {
  var el = document.getElementById('pa-live-content');
  if (!el) return;
  try {
    var res = await paFetch('/live-dashboard');
    if (!res || !res.ok) { el.innerHTML = '<p class="text-red-500">Failed to load dashboard data. Check admin session.</p>'; return; }
    var data = await res.json();
    PA.liveDash = data;
    var msgs = data.messages || {};
    el.innerHTML =
      // Stat cards — Secretary data
      '<div class="grid grid-cols-2 md:grid-cols-5 gap-4">' +
        paStatCard('Today Calls', data.today?.total || 0, 'fa-phone-volume', 'bg-blue-500') +
        paStatCard('Today Leads', data.today?.leads || 0, 'fa-user-check', 'bg-violet-500') +
        paStatCard('7d Calls', data.week?.total || 0, 'fa-calendar-week', 'bg-green-500') +
        paStatCard('30d Calls', data.month?.total || 0, 'fa-calendar', 'bg-amber-500') +
        paStatCard('Avg Duration', Math.round(data.today?.avg_duration || 0) + 's', 'fa-clock', 'bg-teal-500') +
      '</div>' +

      // Quick alerts
      '<div class="grid grid-cols-3 gap-4">' +
        '<div class="bg-blue-50 rounded-xl p-4 border border-blue-100"><div class="text-xs text-blue-600 font-semibold mb-1"><i class="fas fa-envelope mr-1"></i>Unread Messages</div><div class="text-2xl font-bold text-blue-800">' + (msgs.unread_messages || 0) + '</div></div>' +
        '<div class="bg-violet-50 rounded-xl p-4 border border-violet-100"><div class="text-xs text-violet-600 font-semibold mb-1"><i class="fas fa-calendar-check mr-1"></i>Pending Appointments</div><div class="text-2xl font-bold text-violet-800">' + (msgs.pending_appointments || 0) + '</div></div>' +
        '<div class="bg-amber-50 rounded-xl p-4 border border-amber-100"><div class="text-xs text-amber-600 font-semibold mb-1"><i class="fas fa-phone-volume mr-1"></i>Pending Callbacks</div><div class="text-2xl font-bold text-amber-800">' + (msgs.pending_callbacks || 0) + '</div></div>' +
      '</div>' +

      // Recent calls
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
        '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-list mr-2 text-blue-500"></i>Recent Secretary Calls</h3>' +
        (data.recent_calls && data.recent_calls.length > 0 ?
          '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-xs text-gray-500 border-b">' +
            '<th class="py-2 text-left">Time</th><th class="text-left">Caller</th><th class="text-left">Service</th><th class="text-left">Outcome</th><th class="text-left">Duration</th><th class="text-left">Lead</th>' +
          '</tr></thead><tbody>' +
          data.recent_calls.map(function(call) {
            var color = call.call_outcome === 'answered' ? 'text-green-600 bg-green-50' : call.call_outcome === 'transferred' ? 'text-blue-600 bg-blue-50' : call.call_outcome === 'voicemail' ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50';
            return '<tr class="border-b border-gray-50"><td class="py-2 text-gray-500 text-xs">' + new Date(call.created_at).toLocaleString() + '</td>' +
              '<td class="font-medium">' + (call.caller_name || call.caller_phone || '-') + '</td>' +
              '<td class="text-xs">' + (call.service_type || '-') + '</td>' +
              '<td><span class="px-2 py-0.5 rounded text-xs font-semibold ' + color + '">' + (call.call_outcome || '-') + '</span></td>' +
              '<td>' + (call.call_duration_seconds || 0) + 's</td>' +
              '<td>' + (call.is_lead ? '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold">LEAD</span>' : '-') + '</td></tr>';
          }).join('') +
          '</tbody></table></div>' : '<p class="text-gray-400 text-sm">No calls yet — calls will appear here as the AI Secretary handles them.</p>') +
      '</div>' +

      // Active secretary agents
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
        '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-headset mr-2 text-green-500"></i>Active AI Secretaries</h3>' +
        (data.top_agents && data.top_agents.length > 0 ?
          '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + data.top_agents.map(function(a) {
            return '<div class="text-center p-4 rounded-xl border border-gray-100 bg-gradient-to-br from-white to-green-50">' +
              '<div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-headset text-green-600"></i></div>' +
              '<div class="font-bold text-gray-800">' + (a.name || 'Sarah') + '</div>' +
              '<div class="text-[10px] text-gray-400">' + (a.company || a.customer_name || '') + '</div>' +
              '<div class="text-xs text-green-600 font-semibold mt-1">' + (a.total_calls || 0) + ' calls</div>' +
              '<div class="text-[10px] text-gray-500">' + (a.mode || 'directory') + ' mode</div></div>';
          }).join('') + '</div>' : '<p class="text-gray-400 text-sm">No active secretaries</p>') +
      '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

// ════════════════════════════════════════════════════════════════
// MODULE 7: TRANSCRIPT FLAGGING
// ════════════════════════════════════════════════════════════════
function renderTranscriptFlaggingView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-flag mr-2 text-yellow-600"></i>Agent Fine-Tuning & Transcript Flagging</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Flag problematic transcripts, suggest fixes, apply to agent prompts</p></div>' +
    '</div>' +
    '<div id="pa-flags-list" class="space-y-4"><div class="animate-pulse bg-gray-100 rounded-xl h-32"></div></div>' +
  '</div>';
}

async function paLoadFlags() {
  try {
    var res = await paFetch('/transcript-flags');
    var data = await res.json();
    PA.flags = data.flags || [];
    paRenderFlags();
  } catch(e) { console.error(e); }
}

function paRenderFlags() {
  var el = document.getElementById('pa-flags-list');
  if (!el) return;
  el.innerHTML =
    // New flag form
    '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-plus-circle mr-2 text-yellow-500"></i>Flag a Transcript</h3>' +
      '<div class="grid grid-cols-3 gap-4">' +
        paInputV('pa-flag-call', 'Call ID', '', 'number') +
        paSelectV('pa-flag-type', 'Call Type', ['cold_call','secretary'], 'cold_call') +
        paSelectV('pa-flag-reason', 'Reason', ['failed_close','bad_objection','confusion','excellent','other'], 'failed_close') +
      '</div>' +
      '<div class="grid grid-cols-2 gap-4 mt-4">' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Flagged Text</label><textarea id="pa-flag-text" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"></textarea></div>' +
        '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Suggested Fix</label><textarea id="pa-flag-fix" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"></textarea></div>' +
      '</div>' +
      '<div class="flex justify-end mt-3"><button onclick="paSubmitFlag()" class="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-flag mr-1"></i>Submit Flag</button></div>' +
    '</div>' +

    // Existing flags
    (PA.flags.length === 0 ? '<div class="text-center py-8 text-gray-400">No flags yet</div>' :
    '<div class="space-y-3">' + PA.flags.map(function(f) {
      return '<div class="bg-white rounded-xl border border-gray-100 p-4">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-3">' +
            '<span class="px-2 py-1 rounded text-xs font-semibold ' + (f.flag_reason === 'excellent' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600') + '">' + f.flag_reason + '</span>' +
            '<span class="text-xs text-gray-500">Call #' + f.call_id + ' &bull; ' + f.call_type + '</span>' +
            '<span class="text-xs text-gray-400">' + new Date(f.created_at).toLocaleDateString() + '</span>' +
          '</div>' +
          (f.applied_to_prompt ? '<span class="px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-semibold">Applied</span>' :
            (f.suggested_fix ? '<button onclick="paApplyFlag(' + f.id + ')" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"><i class="fas fa-magic mr-1"></i>Apply Fix</button>' : '')) +
        '</div>' +
        '<p class="mt-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-3 font-mono">' + f.flagged_text + '</p>' +
        (f.suggested_fix ? '<p class="mt-1 text-sm text-green-700 bg-green-50 rounded-lg p-3"><strong>Fix:</strong> ' + f.suggested_fix + '</p>' : '') +
      '</div>';
    }).join('') + '</div>');
}

async function paSubmitFlag() {
  try {
    var res = await paFetch('/transcript-flags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: parseInt(gv('pa-flag-call')), call_type: gv('pa-flag-type'), flagged_text: gv('pa-flag-text'), flag_reason: gv('pa-flag-reason'), suggested_fix: gv('pa-flag-fix') })
    });
    var data = await res.json();
    if (data.success) paLoadFlags();
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert(e.message); }
}

async function paApplyFlag(flagId) {
  if (!confirm('Apply this fix to the persona prompt?')) return;
  try { await paFetch('/transcript-flags/' + flagId + '/apply', { method: 'POST' }); paLoadFlags(); } catch(e) { alert(e.message); }
}

// ════════════════════════════════════════════════════════════════
// MODULE 8: SERVICE PANEL
// ════════════════════════════════════════════════════════════════
function renderServicePanelView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-server mr-2 text-indigo-600"></i>Roofer Secretary AI Service Panel</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Monitor users, minutes, SIP numbers, monthly billing, edit scripts</p></div>' +
      '<div class="flex gap-2">' +
        '<button onclick="paLoadServicePanel()" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold"><i class="fas fa-sync-alt mr-2"></i>Refresh</button>' +
        '<button onclick="paShowColdCallActivity()" class="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold"><i class="fas fa-phone-alt mr-2"></i>Cold Call Activity</button>' +
      '</div>' +
    '</div>' +
    '<div id="pa-sp-content" class="space-y-6"><div class="animate-pulse bg-gray-100 rounded-xl h-64"></div></div>' +
  '</div>';
}

async function paLoadServicePanel() {
  var el = document.getElementById('pa-sp-content');
  if (!el) return;
  try {
    var res = await paFetch('/service-panel');
    var data = await res.json();
    PA.servicePanel = data;
    var t = data.totals || {};
    el.innerHTML =
      // Summary stats
      '<div class="grid grid-cols-5 gap-4">' +
        paStatCard('Active Agents', t.active_agents, 'fa-robot', 'bg-violet-500') +
        paStatCard('Total Customers', t.total_customers, 'fa-users', 'bg-blue-500') +
        paStatCard('Total Calls', t.total_calls, 'fa-phone', 'bg-green-500') +
        paStatCard('Month Calls', t.month_calls, 'fa-calendar-alt', 'bg-amber-500') +
        paStatCard('Month Minutes', t.month_minutes, 'fa-clock', 'bg-red-500') +
      '</div>' +

      // Customer table
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
        '<h3 class="font-bold text-gray-700 mb-4"><i class="fas fa-table mr-2 text-indigo-500"></i>Onboarded Customers</h3>' +
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-xs text-gray-500 border-b border-gray-200">' +
          '<th class="py-2 text-left">Customer</th><th class="text-left">Agent</th><th class="text-left">Mode</th><th class="text-left">SIP #</th><th class="text-left">Status</th><th class="text-left">Calls</th><th class="text-left">Minutes</th><th class="text-left">Leads</th><th class="text-left">Tier</th><th class="text-left">Actions</th>' +
        '</tr></thead><tbody>' +
        (data.customers || []).map(function(c) {
          var mins = Math.round((c.month_seconds || 0) / 60);
          return '<tr class="border-b border-gray-50 hover:bg-gray-50">' +
            '<td class="py-2"><div class="font-semibold text-gray-800">' + (c.company_name || c.name) + '</div><div class="text-xs text-gray-400">' + c.email + '</div></td>' +
            '<td>' + (c.agent_name || '-') + '<div class="text-xs text-gray-400">' + (c.agent_voice || '-') + '</div></td>' +
            '<td><span class="px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-600">' + (c.secretary_mode || '-') + '</span></td>' +
            '<td class="text-xs">' + (c.assigned_phone_number || '-') + '</td>' +
            '<td><span class="w-2.5 h-2.5 rounded-full inline-block mr-1 ' + (c.secretary_active ? 'bg-green-500' : 'bg-red-400') + '"></span>' + (c.connection_status || '-') + '</td>' +
            '<td class="text-center">' + (c.total_calls || 0) + '</td>' +
            '<td class="text-center">' + mins + ' / ' + (c.monthly_minutes_limit || 500) + '</td>' +
            '<td class="text-center">' + (c.total_leads || 0) + '</td>' +
            '<td><span class="px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-600">' + (c.tier_name || 'Free') + '</span></td>' +
            '<td><div class="flex gap-1">' +
              '<button onclick="paOpenVoiceSetup(' + c.id + ')" class="px-2 py-1 bg-violet-50 text-violet-600 rounded text-xs font-semibold hover:bg-violet-100" title="Voice Config"><i class="fas fa-microphone-alt"></i></button>' +
              '<button onclick="paQuickEdit(' + c.id + ')" class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-semibold hover:bg-blue-100" title="Quick Edit"><i class="fas fa-edit"></i></button>' +
            '</div></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
      '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

function paOpenVoiceSetup(customerId) {
  PA.editCustomerId = customerId;
  var root = document.getElementById('content');
  if (root) root.innerHTML = renderVoiceSetupView(customerId);
  paLoadVoiceConfig(customerId);
}

async function paQuickEdit(customerId) {
  var c = (PA.servicePanel?.customers || []).find(function(x) { return x.id === customerId; });
  if (!c) return;
  var el = document.getElementById('pa-sp-content');
  el.innerHTML = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">' +
    '<h3 class="font-bold text-gray-700"><i class="fas fa-edit mr-2 text-blue-500"></i>Quick Edit: ' + (c.company_name || c.name) + '</h3>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paInputV('pa-qe-name', 'Agent Name', c.agent_name || 'Sarah') +
      paSelectV('pa-qe-voice', 'Voice', ['alloy','shimmer','nova','echo','onyx','fable','ash','coral','sage'], c.agent_voice || 'alloy') +
      paSelectV('pa-qe-mode', 'Mode', ['full','answering','directory','receptionist','always_on'], c.secretary_mode || 'full') +
    '</div>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paSlider('pa-qe-speed', 'Speed', c.voice_speed || 1.0, 0.5, 2.0, 0.1) +
      paSelectV('pa-qe-llm', 'LLM Model', ['gpt-4o-mini','gpt-4o','claude-3.5-sonnet','gemini-2.5-flash'], c.llm_model || 'gpt-4o-mini') +
      '<label class="flex items-center gap-2 mt-6"><input type="checkbox" id="pa-qe-active" ' + (c.secretary_active ? 'checked' : '') + ' class="rounded"> Active</label>' +
    '</div>' +
    '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Greeting Script</label><textarea id="pa-qe-greeting" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (c.greeting_script || '') + '</textarea></div>' +
    '<div class="flex justify-end gap-3">' +
      '<button onclick="paLoadServicePanel()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSaveQuickEdit(' + customerId + ')" class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-save mr-1"></i>Save</button>' +
    '</div>' +
  '</div>';
}

async function paSaveQuickEdit(customerId) {
  try {
    var res = await paFetch('/service-panel/' + customerId + '/quick-edit', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: gv('pa-qe-name'), agent_voice: gv('pa-qe-voice'), secretary_mode: gv('pa-qe-mode'),
        voice_speed: parseFloat(gv('pa-qe-speed')), llm_model: gv('pa-qe-llm'),
        is_active: document.getElementById('pa-qe-active')?.checked ? 1 : 0,
        greeting_script: gv('pa-qe-greeting')
      })
    });
    var data = await res.json();
    if (data.success) paLoadServicePanel();
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert(e.message); }
}

async function paShowColdCallActivity() {
  var el = document.getElementById('pa-sp-content');
  if (!el) return;
  try {
    var res = await paFetch('/service-panel/cold-call-activity');
    var data = await res.json();
    el.innerHTML =
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-700"><i class="fas fa-phone-alt mr-2 text-red-500"></i>Outbound Cold Call Activity</h3>' +
        '<button onclick="paLoadServicePanel()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold"><i class="fas fa-arrow-left mr-1"></i>Back to Service Panel</button>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-6">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
          '<h4 class="font-bold text-gray-700 mb-3">Active Campaigns</h4>' +
          (data.campaigns && data.campaigns.length > 0 ? data.campaigns.map(function(c) {
            return '<div class="flex items-center justify-between py-2 border-b border-gray-50"><div><span class="font-semibold">' + c.name + '</span><div class="text-xs text-gray-400">' + (c.persona_name || '-') + ' &bull; ' + (c.called || 0) + '/' + (c.total || 0) + ' called</div></div><span class="px-2 py-0.5 rounded text-xs font-semibold ' + (c.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500') + '">' + c.status + '</span></div>';
          }).join('') : '<p class="text-gray-400 text-sm">No campaigns</p>') +
        '</div>' +
        '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
          '<h4 class="font-bold text-gray-700 mb-3">Agents</h4>' +
          (data.agents && data.agents.length > 0 ? data.agents.map(function(a) {
            return '<div class="flex items-center justify-between py-2 border-b border-gray-50"><div><span class="font-semibold">' + a.name + '</span><div class="text-xs text-gray-400">' + a.total_calls + ' calls &bull; ' + ((a.success_rate || 0) * 100).toFixed(1) + '%</div></div><span class="px-2 py-0.5 rounded text-xs font-semibold ' + (a.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500') + '">' + a.status + '</span></div>';
          }).join('') : '<p class="text-gray-400 text-sm">No agents</p>') +
        '</div>' +
      '</div>';
  } catch(e) { el.innerHTML = '<p class="text-red-500">' + e.message + '</p>'; }
}

// ════════════════════════════════════════════════════════════════
// MODULE: MEMBERSHIP CONFIG
// ════════════════════════════════════════════════════════════════
function renderMembershipConfigView() {
  return '<div class="space-y-6">' +
    '<div class="flex items-center justify-between">' +
      '<div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-crown mr-2 text-amber-500"></i>Membership Tiers & Pricing</h2>' +
      '<p class="text-sm text-gray-500 mt-1">Define membership plans, welcome packages, and custom pricing</p></div>' +
      '<button onclick="paShowTierEditor()" class="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-bold shadow-md"><i class="fas fa-plus mr-2"></i>New Tier</button>' +
    '</div>' +
    '<div id="pa-tiers-content" class="space-y-4"><div class="animate-pulse bg-gray-100 rounded-xl h-32"></div></div>' +
  '</div>';
}

async function paLoadMembershipConfig() {
  try {
    var res = await paFetch('/membership-tiers');
    var data = await res.json();
    PA.tiers = data.tiers || [];
    paRenderTiersList();
  } catch(e) { console.error(e); }
}

function paRenderTiersList() {
  var el = document.getElementById('pa-tiers-content');
  if (!el) return;
  if (PA.tiers.length === 0) { el.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-crown text-4xl mb-4"></i><p>No membership tiers. Create one to get started.</p></div>'; return; }
  el.innerHTML = '<div class="grid grid-cols-3 gap-6">' + PA.tiers.map(function(t) {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<h4 class="text-xl font-bold text-gray-800">' + t.name + '</h4>' +
        '<div class="flex gap-1">' +
          '<button onclick="paEditTier(' + t.id + ')" class="px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-xs font-semibold hover:bg-amber-100"><i class="fas fa-edit"></i></button>' +
          '<button onclick="paDeleteTier(' + t.id + ')" class="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="text-3xl font-bold text-teal-600 mb-2">$' + (t.monthly_price_cents / 100).toFixed(0) + '<span class="text-sm text-gray-400 font-normal">/mo</span></div>' +
      '<p class="text-sm text-gray-500 mb-4">' + (t.description || '') + '</p>' +
      '<div class="space-y-2 text-sm">' +
        '<div class="flex items-center gap-2"><i class="fas fa-file-alt text-blue-500 w-4"></i>' + t.included_reports + ' reports/mo</div>' +
        '<div class="flex items-center gap-2"><i class="fas fa-clock text-green-500 w-4"></i>' + t.included_minutes + ' minutes/mo</div>' +
        (t.secretary_included ? '<div class="flex items-center gap-2"><i class="fas fa-robot text-violet-500 w-4"></i>AI Secretary included</div>' : '') +
        (t.cold_call_included ? '<div class="flex items-center gap-2"><i class="fas fa-headset text-red-500 w-4"></i>Cold Call included</div>' : '') +
        (t.welcome_credits > 0 ? '<div class="flex items-center gap-2"><i class="fas fa-gift text-amber-500 w-4"></i>' + t.welcome_credits + ' welcome credits</div>' : '') +
        (t.welcome_discount_pct > 0 ? '<div class="flex items-center gap-2"><i class="fas fa-percent text-pink-500 w-4"></i>' + t.welcome_discount_pct + '% first month discount</div>' : '') +
      '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function paShowTierEditor(tier) {
  var t = tier || { name: '', description: '', monthly_price_cents: 0, included_reports: 0, included_minutes: 0, secretary_included: 0, cold_call_included: 0, welcome_credits: 0, welcome_discount_pct: 0, sort_order: 0 };
  var el = document.getElementById('pa-tiers-content');
  el.innerHTML = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">' +
    '<h3 class="font-bold text-gray-700">' + (t.id ? 'Edit Tier: ' + t.name : 'New Membership Tier') + '</h3>' +
    '<div class="grid grid-cols-3 gap-4">' +
      paInputV('pa-tier-name', 'Tier Name *', t.name) +
      paInputV('pa-tier-price', 'Monthly Price ($)', (t.monthly_price_cents / 100).toFixed(0), 'number') +
      paInputV('pa-tier-order', 'Sort Order', t.sort_order || 0, 'number') +
    '</div>' +
    '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Description</label><textarea id="pa-tier-desc" rows="2" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + (t.description || '') + '</textarea></div>' +
    '<div class="grid grid-cols-4 gap-4">' +
      paInputV('pa-tier-reports', 'Reports/mo', t.included_reports || 0, 'number') +
      paInputV('pa-tier-minutes', 'Minutes/mo', t.included_minutes || 0, 'number') +
      paInputV('pa-tier-credits', 'Welcome Credits', t.welcome_credits || 0, 'number') +
      paInputV('pa-tier-discount', 'First Month Discount %', t.welcome_discount_pct || 0, 'number') +
    '</div>' +
    '<div class="flex gap-6">' +
      paCheckbox('pa-tier-secretary', 'Include Secretary AI', t.secretary_included) +
      paCheckbox('pa-tier-coldcall', 'Include Cold Call', t.cold_call_included) +
    '</div>' +
    '<div class="flex justify-end gap-3">' +
      '<button onclick="paLoadMembershipConfig()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold">Cancel</button>' +
      '<button onclick="paSaveTier(' + (t.id || 0) + ')" class="px-6 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-save mr-1"></i>Save</button>' +
    '</div>' +
  '</div>';
}

function paEditTier(id) { var t = PA.tiers.find(function(x) { return x.id === id; }); if (t) paShowTierEditor(t); }

async function paSaveTier(tierId) {
  var payload = {
    name: gv('pa-tier-name'), description: gv('pa-tier-desc'),
    monthly_price_cents: Math.round(parseFloat(gv('pa-tier-price') || '0') * 100),
    included_reports: parseInt(gv('pa-tier-reports')) || 0, included_minutes: parseInt(gv('pa-tier-minutes')) || 0,
    secretary_included: document.getElementById('pa-tier-secretary')?.checked ? 1 : 0,
    cold_call_included: document.getElementById('pa-tier-coldcall')?.checked ? 1 : 0,
    welcome_credits: parseInt(gv('pa-tier-credits')) || 0, welcome_discount_pct: parseInt(gv('pa-tier-discount')) || 0,
    sort_order: parseInt(gv('pa-tier-order')) || 0
  };
  try {
    var url = tierId ? '/membership-tiers/' + tierId : '/membership-tiers';
    var res = await paFetch(url, { method: tierId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var data = await res.json();
    if (data.success || data.id) paLoadMembershipConfig();
    else alert('Error: ' + (data.error || 'Unknown'));
  } catch(e) { alert(e.message); }
}

async function paDeleteTier(id) {
  if (!confirm('Deactivate this tier?')) return;
  try { await paFetch('/membership-tiers/' + id, { method: 'DELETE' }); paLoadMembershipConfig(); } catch(e) { alert(e.message); }
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function paInput(id, label, ph, type) { return '<div><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + ph + '" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400 focus:border-transparent"></div>'; }
function paInputV(id, label, val, type) { return '<div><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + (val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : '') + '" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"></div>'; }
function paSelect(id, label, opts) { return '<div><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + '</label><select id="' + id + '" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + opts.map(function(o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select></div>'; }
function paSelectV(id, label, opts, val) { return '<div><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + '</label><select id="' + id + '" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">' + opts.map(function(o) { return '<option value="' + o + '" ' + (o === val ? 'selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div>'; }
function paSlider(id, label, val, min, max, step) { return '<div><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + ': <span id="' + id + '-val" class="text-blue-600 font-bold">' + val + '</span></label><input id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" oninput="document.getElementById(\'' + id + '-val\').textContent=this.value" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"></div>'; }
function paCheckbox(id, label, checked) { return '<label class="flex items-center gap-2"><input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' class="rounded text-blue-600"><span class="text-sm text-gray-700">' + label + '</span></label>'; }
function paStatCard(label, value, icon, bg, extra) { return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-center"><div class="w-10 h-10 rounded-xl ' + bg + ' text-white flex items-center justify-center mx-auto mb-2 ' + (extra || '') + '"><i class="fas ' + icon + '"></i></div><div class="text-2xl font-bold text-gray-800">' + value + '</div><div class="text-xs text-gray-500">' + label + '</div></div>'; }
