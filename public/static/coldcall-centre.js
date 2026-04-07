// ============================================================
// COLD CALL CENTRE — Agent Persona, SIP Config, Campaigns, 
// Live Ops, Analytics, Transcript Flagging, A/B Testing
// ============================================================
// ROOFER SECRETARY TRACKING CENTER — Minutes, Billing,
// Cold Call Manager, Script Editor, Optimization
// ============================================================

(function() {
  'use strict';

  // ── COLD CALL CENTRE STATE ─────────────────────────────────
  var CC = window.CC = {
    tab: 'overview',
    personas: [], campaigns: [], phoneLines: [],
    stats: {}, recentCalls: [],
    editPersona: null, editCampaign: null,
    scriptVariants: [], flags: [],
    // Tracking center
    trackTab: 'secretary', // secretary | coldcall
    customers: [], customerDetail: null,
  };

  // ── COLD CALL CENTRE VIEWS ─────────────────────────────────
  window.renderColdCallCentre = function() {
    var tabs = [
      { key: 'overview', icon: 'fa-tachometer-alt', label: 'Overview' },
      { key: 'phone-lines', icon: 'fa-phone-volume', label: 'SIP & Phone Lines' },
      { key: 'personas', icon: 'fa-user-secret', label: 'Agent Personas' },
      { key: 'campaigns', icon: 'fa-bullhorn', label: 'Campaigns' },
      { key: 'live', icon: 'fa-broadcast-tower', label: 'Live Ops' },
      { key: 'analytics', icon: 'fa-chart-bar', label: 'Analytics' },
      { key: 'scripts', icon: 'fa-file-alt', label: 'Script A/B Testing' },
    ];

    var html = '<div class="space-y-6 slide-in">';
    html += '<div class="flex items-center justify-between"><div>' +
      '<h1 class="text-2xl font-bold text-slate-800 flex items-center gap-3">' +
        '<div class="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg"><i class="fas fa-headset text-white text-sm"></i></div>' +
        'Cold Call Centre</h1>' +
      '<p class="text-slate-500 text-sm mt-1">Outbound AI sales calling — configure agents, run campaigns, optimize scripts</p></div></div>';

    // Tabs
    html += '<div class="flex gap-1 overflow-x-auto bg-gray-100 p-1 rounded-xl">';
    tabs.forEach(function(t) {
      var active = CC.tab === t.key;
      html += '<button onclick="CC.tab=\'' + t.key + '\';renderContent()" class="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ' +
        (active ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50') + '">' +
        '<i class="fas ' + t.icon + '"></i>' + t.label + '</button>';
    });
    html += '</div>';

    // Content
    if (CC.tab === 'overview') html += ccRenderOverview();
    else if (CC.tab === 'phone-lines') html += ccRenderPhoneLines();
    else if (CC.tab === 'personas') html += ccRenderPersonas();
    else if (CC.tab === 'campaigns') html += ccRenderCampaigns();
    else if (CC.tab === 'live') html += ccRenderLiveOps();
    else if (CC.tab === 'analytics') html += ccRenderAnalytics();
    else if (CC.tab === 'scripts') html += ccRenderScripts();

    html += '</div>';
    return html;
  };

  // ── PHONE LINES / SIP CONFIG ───────────────────────────────
  function ccRenderPhoneLines() {
    var lines = CC.phoneLines || [];
    var html = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-phone-volume mr-2 text-blue-500"></i>SIP Trunk & Phone Line Configuration</h3>' +
        '<button onclick="ccAddPhoneLine()" class="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-bold"><i class="fas fa-plus mr-1"></i>Add Line</button>' +
      '</div>';

    if (lines.length === 0) {
      html += '<p class="text-gray-400 text-sm py-8 text-center">Loading phone lines...</p>';
    } else {
      html += '<div class="space-y-4">';
      lines.forEach(function(line, i) {
        html += '<div class="bg-gray-50 rounded-xl p-5 border border-gray-200">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<div class="flex items-center gap-3">' +
              '<div class="w-10 h-10 rounded-lg flex items-center justify-center ' + (line.is_active ? 'bg-green-100' : 'bg-gray-200') + '">' +
                '<i class="fas fa-phone ' + (line.is_active ? 'text-green-600' : 'text-gray-400') + '"></i></div>' +
              '<div><h4 class="font-bold text-gray-800 text-sm">' + esc(line.label || 'Phone Line ' + (i+1)) + '</h4>' +
                '<p class="text-xs text-gray-500 font-mono">' + esc(line.assigned_phone_number || 'No number') + '</p></div>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<span class="px-2 py-1 rounded-full text-[10px] font-bold ' + 
                (line.dispatch_type === 'outbound_prompt_leadlist' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700') + '">' +
                (line.dispatch_type === 'outbound_prompt_leadlist' ? 'OUTBOUND' : 'INBOUND') + '</span>' +
              '<span class="px-2 py-1 rounded-full text-[10px] font-bold ' + (line.connection_status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') + '">' +
                (line.connection_status || 'disconnected') + '</span>' +
            '</div>' +
          '</div>' +

          // SIP Config
          '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Dispatch Type</label>' +
              '<select onchange="ccUpdateLine(' + line.id + ',\'dispatch_type\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
                '<option value="outbound_prompt_leadlist"' + (line.dispatch_type === 'outbound_prompt_leadlist' ? ' selected' : '') + '>Outbound — Cold Calling</option>' +
                '<option value="inbound_forwarding"' + (line.dispatch_type === 'inbound_forwarding' ? ' selected' : '') + '>Inbound — AI Answering</option>' +
              '</select></div>' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Linked Agent Persona</label>' +
              '<select onchange="ccUpdateLine(' + line.id + ',\'agent_persona_id\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
                '<option value="">None</option>' +
                (CC.personas || []).map(function(p) { return '<option value="' + p.id + '"' + (line.agent_persona_id == p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
              '</select></div>' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Linked Customer</label>' +
              '<input value="' + esc(line.linked_customer_id || '') + '" onchange="ccUpdateLine(' + line.id + ',\'linked_customer_id\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1 font-mono" placeholder="Customer ID (optional)"></div>' +
          '</div>' +

          // Voice / Agent settings for this line
          '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Voice</label>' +
              '<select onchange="ccUpdateLine(' + line.id + ',\'agent_voice_id\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
                ['alloy','shimmer','nova','echo','onyx','fable','ash','coral','sage'].map(function(v) { return '<option value="' + v + '"' + (line.agent_voice_id === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
              '</select></div>' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Speed</label>' +
              '<input type="number" value="' + (line.agent_speed || 1) + '" min="0.5" max="2" step="0.1" onchange="ccUpdateLine(' + line.id + ',\'agent_speed\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Pause (ms)</label>' +
              '<input type="number" value="' + (line.agent_pause_ms || 500) + '" min="100" max="3000" step="100" onchange="ccUpdateLine(' + line.id + ',\'agent_pause_ms\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
            '<div><label class="text-[10px] font-bold text-gray-500 uppercase">Owner</label>' +
              '<input value="' + esc(line.owner_name || '') + '" onchange="ccUpdateLine(' + line.id + ',\'owner_name\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Admin name"></div>' +
          '</div>' +

          // System prompt for this line
          '<div class="mt-3"><label class="text-[10px] font-bold text-gray-500 uppercase">Agent System Prompt (override)</label>' +
            '<textarea rows="2" onchange="ccUpdateLine(' + line.id + ',\'agent_system_prompt\',this.value)" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Custom system prompt for this phone line...">' + esc(line.agent_system_prompt || '') + '</textarea></div>' +

          '<div class="flex justify-end mt-3">' +
            '<button onclick="ccSaveLine(' + line.id + ')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"><i class="fas fa-save mr-1"></i>Save Line Config</button>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── AGENT PERSONAS ─────────────────────────────────────────
  function ccRenderPersonas() {
    var html = '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-user-secret mr-2 text-purple-500"></i>Agent Personas & LLM Configuration</h3>' +
        '<button onclick="ccNewPersona()" class="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-600 rounded-xl text-xs font-bold"><i class="fas fa-plus mr-1"></i>New Persona</button>' +
      '</div>';

    if (CC.editPersona) {
      html += ccRenderPersonaEditor();
    } else {
      // List
      var personas = CC.personas || [];
      if (personas.length === 0) {
        html += '<div class="text-center py-8"><i class="fas fa-user-secret text-gray-300 text-3xl mb-3"></i><p class="text-gray-400 text-sm">No agent personas yet. Create one to define your AI cold caller.</p></div>';
      } else {
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
        personas.forEach(function(p) {
          html += '<div class="bg-gray-50 rounded-xl p-5 border border-gray-200 hover:border-purple-300 transition-all cursor-pointer" onclick="ccEditPersona(' + p.id + ')">' +
            '<div class="flex items-center justify-between mb-2">' +
              '<h4 class="font-bold text-gray-800">' + esc(p.name) + '</h4>' +
              '<span class="px-2 py-1 rounded-full text-[10px] font-bold ' + (p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500') + '">' + (p.is_active ? 'Active' : 'Inactive') + '</span>' +
            '</div>' +
            '<p class="text-xs text-gray-500 mb-3">' + esc(p.description || 'No description') + '</p>' +
            '<div class="flex gap-2 flex-wrap">' +
              '<span class="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold">' + (p.llm_model || 'gpt-4o') + '</span>' +
              '<span class="px-2 py-0.5 bg-purple-50 text-purple-600 rounded text-[10px] font-bold">' + (p.tts_voice_id || 'alloy') + '</span>' +
              '<span class="px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px] font-bold">' + (p.total_calls_made || 0) + ' calls</span>' +
              '<span class="px-2 py-0.5 bg-green-50 text-green-600 rounded text-[10px] font-bold">' + ((p.conversion_rate || 0) * 100).toFixed(1) + '% conv</span>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function ccRenderPersonaEditor() {
    var p = CC.editPersona;
    return '<div class="space-y-4">' +
      '<div class="flex items-center justify-between"><h4 class="font-bold text-purple-700"><i class="fas fa-edit mr-2"></i>' + (p.id ? 'Edit' : 'New') + ' Agent Persona</h4>' +
        '<button onclick="CC.editPersona=null;renderContent()" class="text-sm text-gray-400 hover:text-gray-600"><i class="fas fa-times mr-1"></i>Cancel</button></div>' +

      // Identity
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div><label class="text-xs font-bold text-gray-500">Persona Name *</label><input id="cc-p-name" value="' + esc(p.name || '') + '" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" placeholder="Aggressive Closer"></div>' +
        '<div><label class="text-xs font-bold text-gray-500">Description</label><input id="cc-p-desc" value="' + esc(p.description || '') + '" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" placeholder="High-energy sales persona"></div>' +
      '</div>' +

      // LLM Config
      '<div class="bg-blue-50 rounded-xl p-4"><h5 class="text-xs font-bold text-blue-700 mb-3"><i class="fas fa-brain mr-1"></i>LLM (Reasoning Engine)</h5>' +
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
          '<div><label class="text-[10px] font-bold text-gray-500">Model</label><select id="cc-p-model" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
            [['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['claude-3.5-sonnet','Claude 3.5 Sonnet'],['gemini-2.5-flash','Gemini 2.5 Flash']].map(function(m) {
              return '<option value="' + m[0] + '"' + (p.llm_model === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
            }).join('') + '</select></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Provider</label><select id="cc-p-llm-provider" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
            [['openai','OpenAI'],['anthropic','Anthropic'],['google','Google']].map(function(pr) {
              return '<option value="' + pr[0] + '"' + (p.llm_provider === pr[0] ? ' selected' : '') + '>' + pr[1] + '</option>';
            }).join('') + '</select></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Temperature</label><input id="cc-p-temp" type="number" value="' + (p.llm_temperature || 0.7) + '" min="0" max="2" step="0.1" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
        '</div></div>' +

      // Voice Config
      '<div class="bg-purple-50 rounded-xl p-4"><h5 class="text-xs font-bold text-purple-700 mb-3"><i class="fas fa-microphone mr-1"></i>Voice (TTS) & Speech (STT)</h5>' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
          '<div><label class="text-[10px] font-bold text-gray-500">TTS Provider</label><select id="cc-p-tts" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
            [['openai','OpenAI'],['elevenlabs','ElevenLabs'],['cartesia','Cartesia'],['deepgram','Deepgram']].map(function(pr) {
              return '<option value="' + pr[0] + '"' + (p.tts_provider === pr[0] ? ' selected' : '') + '>' + pr[1] + '</option>';
            }).join('') + '</select></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Voice ID</label><input id="cc-p-voice" value="' + esc(p.tts_voice_id || 'alloy') + '" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="alloy"></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Speed</label><input id="cc-p-speed" type="number" value="' + (p.tts_speed || 1) + '" min="0.5" max="2" step="0.1" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">STT Provider</label><select id="cc-p-stt" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1">' +
            [['deepgram','Deepgram'],['whisper','Whisper'],['google','Google STT']].map(function(pr) {
              return '<option value="' + pr[0] + '"' + (p.stt_provider === pr[0] ? ' selected' : '') + '>' + pr[1] + '</option>';
            }).join('') + '</select></div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">' +
          '<div><label class="text-[10px] font-bold text-gray-500">Endpointing (silence ms)</label><input id="cc-p-endpoint" type="number" value="' + (p.endpointing_ms || 300) + '" min="100" max="2000" step="50" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Interruption Sensitivity</label><input id="cc-p-interrupt" type="number" value="' + (p.interruption_sensitivity || 0.5) + '" min="0" max="1" step="0.1" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Pause Before Reply (ms)</label><input id="cc-p-pause" type="number" value="' + (p.pause_before_reply_ms || 500) + '" min="0" max="3000" step="100" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1"></div>' +
        '</div></div>' +

      // System Prompt
      '<div class="bg-gray-50 rounded-xl p-4"><h5 class="text-xs font-bold text-gray-700 mb-3"><i class="fas fa-terminal mr-1"></i>System Prompt</h5>' +
        '<textarea id="cc-p-system" rows="6" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono" placeholder="You are a professional sales agent calling on behalf of Roof Manager...">' + esc(p.system_prompt || '') + '</textarea>' +
      '</div>' +

      // Script Sections
      '<div class="bg-orange-50 rounded-xl p-4"><h5 class="text-xs font-bold text-orange-700 mb-3"><i class="fas fa-file-alt mr-1"></i>Script Sections</h5>' +
        '<div class="space-y-3">' +
          '<div><label class="text-[10px] font-bold text-gray-500">Opening Line</label><textarea id="cc-p-opening" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Hi, this is [Agent] calling from Roof Manager...">' + esc(p.script_opening || '') + '</textarea></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Value Proposition</label><textarea id="cc-p-value" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="We help roofing companies automate phone answering...">' + esc(p.script_value_prop || '') + '</textarea></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Objection Handling (JSON array)</label><textarea id="cc-p-objections" rows="3" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono mt-1" placeholder=\'[{"objection":"Too expensive","response":"I completely understand..."}]\'>' + esc(p.script_objections || '') + '</textarea></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Closing Script</label><textarea id="cc-p-closing" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Would you like to schedule a quick demo?">' + esc(p.script_closing || '') + '</textarea></div>' +
          '<div><label class="text-[10px] font-bold text-gray-500">Voicemail Script</label><textarea id="cc-p-voicemail" rows="2" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Hi, this is [Agent] from Roof Manager...">' + esc(p.script_voicemail || '') + '</textarea></div>' +
        '</div></div>' +

      // Knowledge Base
      '<div class="bg-teal-50 rounded-xl p-4"><h5 class="text-xs font-bold text-teal-700 mb-3"><i class="fas fa-book mr-1"></i>Knowledge Base / RAG Documents</h5>' +
        '<textarea id="cc-p-knowledge" rows="4" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mt-1" placeholder="Paste product features, pricing tiers, competitor comparisons... The agent will reference this during calls.">' + esc(p.knowledge_docs || '') + '</textarea>' +
        '<div class="mt-2"><label class="text-[10px] font-bold text-gray-500">Dynamic Variables (JSON)</label><input id="cc-p-vars" value="' + esc(p.dynamic_variables || '{}') + '" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono mt-1" placeholder=\'{"Lead_Name":"{{contact_name}}","Company":"{{company_name}}"}\'></div>' +
      '</div>' +

      // Save
      '<div class="flex justify-end gap-3">' +
        '<button onclick="CC.editPersona=null;renderContent()" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold">Cancel</button>' +
        '<button onclick="ccSavePersona()" class="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold shadow-lg"><i class="fas fa-save mr-2"></i>Save Persona</button>' +
      '</div>' +
    '</div>';
  }

  // ── Overview, Campaigns, Live, Analytics, Scripts ───────────
  function ccRenderOverview() {
    var s = CC.stats || {};
    return '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">' +
      ccStatCard('Total Calls', s.total_calls || 0, 'fa-phone', 'blue') +
      ccStatCard('Today', s.today_calls || 0, 'fa-calendar-day', 'green') +
      ccStatCard('Demos Booked', s.demos_booked || 0, 'fa-calendar-check', 'purple') +
      ccStatCard('Conversion', ((s.conversion_rate || 0) * 100).toFixed(1) + '%', 'fa-chart-line', 'amber') +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"><h4 class="font-bold text-gray-800 text-sm mb-3"><i class="fas fa-bullhorn mr-2 text-orange-500"></i>Active Campaigns</h4>' +
        ((CC.campaigns || []).filter(function(c) { return c.status === 'active'; }).length > 0 ?
          '<div class="space-y-2">' + (CC.campaigns || []).filter(function(c) { return c.status === 'active'; }).map(function(c) {
            return '<div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2"><span class="text-sm font-medium">' + esc(c.name) + '</span><span class="text-xs text-gray-400">' + (c.total_prospects || 0) + ' prospects</span></div>';
          }).join('') + '</div>' : '<p class="text-gray-400 text-xs">No active campaigns</p>') +
      '</div>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"><h4 class="font-bold text-gray-800 text-sm mb-3"><i class="fas fa-history mr-2 text-blue-500"></i>Recent Calls</h4>' +
        ((CC.recentCalls || []).length > 0 ?
          '<div class="space-y-2">' + (CC.recentCalls || []).slice(0, 5).map(function(c) {
            return '<div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2"><span class="text-xs">' + esc(c.contact_name || c.phone) + '</span><span class="text-[10px] px-2 py-0.5 rounded-full ' + (c.outcome === 'demo_booked' ? 'bg-green-100 text-green-700' : c.outcome === 'not_interested' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500') + '">' + (c.outcome || 'pending') + '</span></div>';
          }).join('') + '</div>' : '<p class="text-gray-400 text-xs">No recent calls</p>') +
      '</div>' +
    '</div>';
  }

  function ccRenderCampaigns() {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-bullhorn mr-2 text-orange-500"></i>Campaign Management</h3>' +
        '<div class="flex gap-2">' +
          '<button onclick="ccUploadCSV()" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs font-bold"><i class="fas fa-upload mr-1"></i>Upload CSV</button>' +
          '<button onclick="ccNewCampaign()" class="px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-xl text-xs font-bold"><i class="fas fa-plus mr-1"></i>New Campaign</button>' +
        '</div>' +
      '</div>' +
      '<p class="text-gray-400 text-sm text-center py-6">Campaign builder with CSV upload, agent assignment, and scheduling — loaded from /api/call-center/campaigns</p>' +
    '</div>';
  }

  function ccRenderLiveOps() {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-broadcast-tower mr-2 text-red-500 animate-pulse"></i>Live Operations Dashboard</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
        '<div class="bg-gray-50 rounded-xl p-5 text-center"><div class="text-3xl font-black text-gray-800">0</div><p class="text-xs text-gray-500">Active Calls</p></div>' +
        '<div class="bg-gray-50 rounded-xl p-5 text-center"><div class="text-3xl font-black text-green-600">0</div><p class="text-xs text-gray-500">Calls Today</p></div>' +
        '<div class="bg-gray-50 rounded-xl p-5 text-center"><div class="text-3xl font-black text-purple-600">0</div><p class="text-xs text-gray-500">Queue Size</p></div>' +
      '</div>' +
      '<div class="mt-4 bg-yellow-50 rounded-xl p-4 border border-yellow-200"><p class="text-xs text-yellow-700"><i class="fas fa-info-circle mr-1"></i><strong>Live Monitor:</strong> When calls are active, you can listen in via WebRTC or take over the call. Requires LiveKit connection.</p></div>' +
    '</div>';
  }

  function ccRenderAnalytics() {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-chart-bar mr-2 text-blue-500"></i>Call Analytics & Cost Tracking</h3>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">' +
        ccStatCard('Total Calls', CC.stats?.total_calls || 0, 'fa-phone', 'blue') +
        ccStatCard('Avg Duration', (CC.stats?.avg_duration || 0) + 's', 'fa-clock', 'green') +
        ccStatCard('Demos Booked', CC.stats?.demos_booked || 0, 'fa-calendar-check', 'purple') +
        ccStatCard('Est. Cost', '$' + ((CC.stats?.total_cost_cents || 0) / 100).toFixed(2), 'fa-dollar-sign', 'amber') +
      '</div>' +
      '<p class="text-gray-400 text-sm text-center py-4">Detailed analytics with call disposition charts, recording archive, and per-campaign cost breakdown</p>' +
    '</div>';
  }

  function ccRenderScripts() {
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">' +
      '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-flask mr-2 text-teal-500"></i>Script A/B Testing & Optimization</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
        '<div class="bg-blue-50 rounded-xl p-5 border border-blue-200">' +
          '<h4 class="text-sm font-bold text-blue-800 mb-2"><i class="fas fa-flag mr-1"></i>Transcript Flagging</h4>' +
          '<p class="text-xs text-blue-600">Flag specific parts of call transcripts where the agent failed to close or handled objections poorly. Flagged text can be sent directly to the system prompt editor.</p>' +
          '<button onclick="ccLoadFlags()" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Load Flagged Transcripts</button>' +
        '</div>' +
        '<div class="bg-teal-50 rounded-xl p-5 border border-teal-200">' +
          '<h4 class="text-sm font-bold text-teal-800 mb-2"><i class="fas fa-code-branch mr-1"></i>Script Variants</h4>' +
          '<p class="text-xs text-teal-600">Create multiple script variants (A/B) for each persona. Track which performs better based on conversion rate, call duration, and sentiment.</p>' +
          '<button onclick="ccLoadVariants()" class="mt-3 px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold">Manage Variants</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function ccStatCard(label, val, icon, color) {
    return '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<div class="flex items-center gap-3"><div class="w-10 h-10 bg-' + color + '-100 rounded-lg flex items-center justify-center"><i class="fas ' + icon + ' text-' + color + '-600"></i></div>' +
      '<div><p class="text-2xl font-black text-gray-800">' + val + '</p><p class="text-[10px] text-gray-400 uppercase font-bold">' + label + '</p></div></div></div>';
  }

  // ── API Functions ──────────────────────────────────────────
  window.ccLoadData = async function() {
    try {
      var [statsRes, campaignsRes, phonesRes, personasRes] = await Promise.all([
        saFetch('/api/call-center/stats'),
        saFetch('/api/call-center/campaigns'),
        saFetch('/api/call-center/phone-config'),
        saFetch('/api/call-center/agent-personas'),
      ]);
      if (statsRes) CC.stats = await statsRes.json();
      if (campaignsRes) { var cd = await campaignsRes.json(); CC.campaigns = cd.campaigns || []; }
      if (phonesRes) { var pd = await phonesRes.json(); CC.phoneLines = pd.lines || pd.phones || []; }
      if (personasRes) { var prd = await personasRes.json(); CC.personas = prd.personas || []; }
    } catch(e) { console.error('CC load error:', e); }
    renderContent();
  };

  window.ccNewPersona = function() {
    CC.editPersona = { name: '', description: '', llm_model: 'gpt-4o', tts_voice_id: 'alloy', tts_speed: 1, system_prompt: '' };
    renderContent();
  };

  window.ccEditPersona = function(id) {
    CC.editPersona = (CC.personas || []).find(function(p) { return p.id === id; }) || {};
    renderContent();
  };

  window.ccSavePersona = async function() {
    var p = {
      name: document.getElementById('cc-p-name')?.value,
      description: document.getElementById('cc-p-desc')?.value,
      llm_provider: document.getElementById('cc-p-llm-provider')?.value,
      llm_model: document.getElementById('cc-p-model')?.value,
      llm_temperature: parseFloat(document.getElementById('cc-p-temp')?.value || '0.7'),
      tts_provider: document.getElementById('cc-p-tts')?.value,
      tts_voice_id: document.getElementById('cc-p-voice')?.value,
      tts_speed: parseFloat(document.getElementById('cc-p-speed')?.value || '1'),
      stt_provider: document.getElementById('cc-p-stt')?.value,
      endpointing_ms: parseInt(document.getElementById('cc-p-endpoint')?.value || '300'),
      interruption_sensitivity: parseFloat(document.getElementById('cc-p-interrupt')?.value || '0.5'),
      pause_before_reply_ms: parseInt(document.getElementById('cc-p-pause')?.value || '500'),
      system_prompt: document.getElementById('cc-p-system')?.value,
      script_opening: document.getElementById('cc-p-opening')?.value,
      script_value_prop: document.getElementById('cc-p-value')?.value,
      script_objections: document.getElementById('cc-p-objections')?.value,
      script_closing: document.getElementById('cc-p-closing')?.value,
      script_voicemail: document.getElementById('cc-p-voicemail')?.value,
      knowledge_docs: document.getElementById('cc-p-knowledge')?.value,
      dynamic_variables: document.getElementById('cc-p-vars')?.value,
    };
    if (!p.name) { window.rmToast('Persona name is required', 'warning'); return; }

    try {
      var method = CC.editPersona.id ? 'PUT' : 'POST';
      var url = '/api/call-center/agent-personas' + (CC.editPersona.id ? '/' + CC.editPersona.id : '');
      var res = await fetch(url, { method: method, headers: { ...saHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      window.rmToast('Persona saved!', 'success');
      CC.editPersona = null;
      ccLoadData();
    } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
  };

  window.ccUpdateLine = function(id, field, value) {
    var line = (CC.phoneLines || []).find(function(l) { return l.id === id; });
    if (line) line[field] = value;
  };

  window.ccSaveLine = async function(id) {
    var line = (CC.phoneLines || []).find(function(l) { return l.id === id; });
    if (!line) return;
    try {
      var res = await fetch('/api/call-center/phone-config/' + id, {
        method: 'PUT', headers: { ...saHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(line)
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      window.rmToast('Phone line config saved!', 'success');
    } catch(e) { window.rmToast('Error: ' + e.message, 'error'); }
  };

  window.ccAddPhoneLine = function() { window.rmToast('To add a new phone line, purchase a Twilio number first, then add it here.', 'info'); };
  window.ccNewCampaign = function() { window.rmToast('Campaign builder — redirecting to existing campaign UI', 'info'); CC.tab = 'campaigns'; renderContent(); };
  window.ccUploadCSV = function() { window.rmToast('CSV upload for prospect lists', 'info'); };
  window.ccLoadFlags = function() { window.rmToast('Loading flagged transcripts...', 'info'); };
  window.ccLoadVariants = function() { window.rmToast('Loading script variants...', 'info'); };

})();
