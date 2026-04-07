// ============================================================
// Google Business Profile Dashboard — Reviews & Posts
// ============================================================

(function() {
  'use strict';

  var root = document.getElementById('gbp-root');
  if (!root) return;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  // ============================================================
  // STATE
  // ============================================================
  var state = {
    connected: false,
    business_name: null,
    account_id: null,
    location_id: null,
    connected_at: null,
    reviews: [],
    posts: [],
    insights: null,
    loading: false,
    syncing: false,
    message: null,
    replyingTo: null,
    replyText: '',
    postText: '',
    postCtaType: '',
    postCtaUrl: '',
    creatingPost: false
  };

  // ============================================================
  // API CALLS
  // ============================================================
  function apiGet(path) {
    return fetch('/api/google-business' + path, { headers: authHeaders() }).then(function(r) { return r.json(); });
  }
  function apiPost(path, body) {
    return fetch('/api/google-business' + path, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) { return r.json(); });
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    var h = '';

    // Page header
    h += '<div class="max-w-6xl mx-auto px-4 py-6">';
    h += '<div class="flex items-center justify-between mb-6">';
    h += '<div><h1 class="text-2xl font-bold text-white">Google Business Profile</h1>';
    h += '<p class="text-gray-400 text-sm mt-1">Manage reviews, posts, and business presence</p></div>';
    h += '<a href="/customer/dashboard" class="text-gray-400 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i> Dashboard</a>';
    h += '</div>';

    // Connection status card
    h += '<div class="rounded-xl p-6 mb-6" style="background:#111111;border:1px solid #222">';
    if (!state.connected) {
      h += '<div class="flex items-center gap-4">';
      h += '<div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:#1a1a2e"><i class="fas fa-store text-2xl text-green-400"></i></div>';
      h += '<div class="flex-1">';
      h += '<h2 class="text-lg font-bold text-white">Connect Google Business Profile</h2>';
      h += '<p class="text-gray-400 text-sm mt-1">Link your Google Business Profile to manage reviews, reply to customers, create posts, and track your business performance — all from Roof Manager.</p>';
      h += '</div>';
      h += '<button onclick="window._gbpConnect()" class="px-5 py-2.5 rounded-lg font-semibold text-white text-sm" style="background:#34a853">Connect Profile</button>';
      h += '</div>';
    } else {
      h += '<div class="flex items-center justify-between">';
      h += '<div class="flex items-center gap-4">';
      h += '<div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:#0d2818"><i class="fas fa-store text-2xl text-green-400"></i></div>';
      h += '<div>';
      h += '<h2 class="text-lg font-bold text-white">' + (state.business_name || 'Business Profile Connected') + '</h2>';
      if (state.connected_at) h += '<p class="text-gray-500 text-xs mt-0.5">Connected ' + new Date(state.connected_at).toLocaleDateString() + '</p>';
      h += '</div></div>';
      h += '<div class="flex items-center gap-3">';
      h += '<button onclick="window._gbpSync()" class="px-4 py-2 rounded-lg font-semibold text-white text-sm" style="background:#34a853"' + (state.syncing ? ' disabled' : '') + '>';
      h += state.syncing ? '<i class="fas fa-spinner fa-spin mr-1"></i> Syncing...' : '<i class="fas fa-sync mr-1"></i> Sync Reviews';
      h += '</button>';
      h += '<button onclick="window._gbpDisconnect()" class="px-4 py-2 rounded-lg font-semibold text-gray-400 text-sm border border-gray-700 hover:text-red-400 hover:border-red-800">Disconnect</button>';
      h += '</div></div>';
    }
    h += '</div>';

    // Message
    if (state.message) {
      h += '<div class="rounded-xl p-4 mb-6 text-sm" style="background:#111111;border:1px solid #222;color:#9ca3af"><i class="fas fa-info-circle mr-2 text-green-400"></i>' + state.message + '</div>';
    }

    if (state.connected) {
      // Business info + metrics
      if (state.insights) {
        h += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">';
        h += metricCard('Avg Rating', state.insights.average_rating ? state.insights.average_rating.toFixed(1) + ' / 5' : 'N/A', 'fa-star', '#fbbc05');
        h += metricCard('Total Reviews', String(state.insights.total_reviews || 0), 'fa-comments', '#4285f4');
        h += metricCard('Posts', String(state.insights.total_posts || 0), 'fa-newspaper', '#34a853');
        h += metricCard('Profile', state.business_name ? 'Active' : 'Linked', 'fa-store', '#ea4335');
        h += '</div>';
      }

      // Two-column layout: Reviews + Posts
      h += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';

      // Reviews section
      h += '<div>';
      h += '<div class="rounded-xl overflow-hidden" style="background:#111111;border:1px solid #222">';
      h += '<div class="px-6 py-4 border-b flex items-center justify-between" style="border-color:#222">';
      h += '<h3 class="text-white font-bold"><i class="fas fa-star text-yellow-400 mr-2"></i>Reviews</h3>';
      h += '<span class="text-gray-500 text-xs">' + state.reviews.length + ' review(s)</span>';
      h += '</div>';

      if (state.reviews.length === 0) {
        h += '<div class="px-6 py-10 text-center">';
        h += '<i class="fas fa-star text-2xl text-gray-700 mb-3"></i>';
        h += '<p class="text-gray-400 text-sm">No reviews found. Sync your reviews to see them here.</p>';
        h += '</div>';
      } else {
        for (var i = 0; i < state.reviews.length; i++) {
          var r = state.reviews[i];
          h += '<div class="px-6 py-4" style="border-top:1px solid #1a1a1a">';
          h += '<div class="flex items-center justify-between mb-2">';
          h += '<span class="text-white font-medium text-sm">' + escapeHtml(r.reviewer_name || 'Anonymous') + '</span>';
          h += '<span class="text-gray-500 text-xs">' + (r.review_date ? new Date(r.review_date).toLocaleDateString() : '') + '</span>';
          h += '</div>';
          // Star rating
          h += '<div class="mb-2">';
          for (var s = 1; s <= 5; s++) {
            h += '<i class="fas fa-star text-xs ' + (s <= r.star_rating ? 'text-yellow-400' : 'text-gray-700') + ' mr-0.5"></i>';
          }
          h += '</div>';
          if (r.comment) {
            h += '<p class="text-gray-300 text-sm mb-2">' + escapeHtml(r.comment) + '</p>';
          }
          // Reply
          if (r.reply_text) {
            h += '<div class="rounded-lg p-3 mt-2" style="background:#0a0a0a;border:1px solid #1a1a1a">';
            h += '<p class="text-xs text-gray-500 mb-1"><i class="fas fa-reply mr-1"></i>Your reply' + (r.reply_date ? ' - ' + new Date(r.reply_date).toLocaleDateString() : '') + '</p>';
            h += '<p class="text-gray-300 text-sm">' + escapeHtml(r.reply_text) + '</p>';
            h += '</div>';
          } else {
            if (state.replyingTo === r.id) {
              h += '<div class="mt-2">';
              h += '<textarea id="reply-text-' + r.id + '" class="w-full rounded-lg p-2 text-sm text-white" style="background:#0a0a0a;border:1px solid #333" rows="2" placeholder="Write your reply...">' + escapeHtml(state.replyText) + '</textarea>';
              h += '<div class="flex gap-2 mt-2">';
              h += '<button onclick="window._gbpSubmitReply(' + r.id + ')" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style="background:#34a853">Send Reply</button>';
              h += '<button onclick="window._gbpCancelReply()" class="px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700">Cancel</button>';
              h += '</div></div>';
            } else {
              h += '<button onclick="window._gbpReply(' + r.id + ')" class="text-xs text-blue-400 hover:text-blue-300 mt-1"><i class="fas fa-reply mr-1"></i>Reply</button>';
            }
          }
          h += '</div>';
        }
      }
      h += '</div>'; // reviews card
      h += '</div>'; // reviews column

      // Posts section
      h += '<div>';
      // Create post
      h += '<div class="rounded-xl p-6 mb-6" style="background:#111111;border:1px solid #222">';
      h += '<h3 class="text-white font-bold mb-3"><i class="fas fa-plus-circle text-green-400 mr-2"></i>Create Post</h3>';
      h += '<textarea id="post-content" class="w-full rounded-lg p-3 text-sm text-white mb-3" style="background:#0a0a0a;border:1px solid #333" rows="3" placeholder="Share an update with your customers...">' + escapeHtml(state.postText) + '</textarea>';
      h += '<div class="flex items-center gap-3 mb-3">';
      h += '<select id="post-cta-type" class="rounded-lg px-3 py-2 text-sm text-white" style="background:#0a0a0a;border:1px solid #333">';
      h += '<option value="">No call-to-action</option>';
      h += '<option value="LEARN_MORE"' + (state.postCtaType === 'LEARN_MORE' ? ' selected' : '') + '>Learn More</option>';
      h += '<option value="BOOK"' + (state.postCtaType === 'BOOK' ? ' selected' : '') + '>Book</option>';
      h += '<option value="ORDER"' + (state.postCtaType === 'ORDER' ? ' selected' : '') + '>Order</option>';
      h += '<option value="CALL"' + (state.postCtaType === 'CALL' ? ' selected' : '') + '>Call</option>';
      h += '<option value="SIGN_UP"' + (state.postCtaType === 'SIGN_UP' ? ' selected' : '') + '>Sign Up</option>';
      h += '</select>';
      h += '<input id="post-cta-url" type="url" class="flex-1 rounded-lg px-3 py-2 text-sm text-white" style="background:#0a0a0a;border:1px solid #333" placeholder="CTA URL (optional)" value="' + escapeHtml(state.postCtaUrl) + '">';
      h += '</div>';
      h += '<button onclick="window._gbpCreatePost()" class="px-4 py-2 rounded-lg font-semibold text-white text-sm" style="background:#34a853"' + (state.creatingPost ? ' disabled' : '') + '>';
      h += state.creatingPost ? '<i class="fas fa-spinner fa-spin mr-1"></i> Posting...' : '<i class="fas fa-paper-plane mr-1"></i> Publish Post';
      h += '</button>';
      h += '</div>';

      // Posts history
      h += '<div class="rounded-xl overflow-hidden" style="background:#111111;border:1px solid #222">';
      h += '<div class="px-6 py-4 border-b flex items-center justify-between" style="border-color:#222">';
      h += '<h3 class="text-white font-bold"><i class="fas fa-newspaper text-green-400 mr-2"></i>Posts</h3>';
      h += '<span class="text-gray-500 text-xs">' + state.posts.length + ' post(s)</span>';
      h += '</div>';

      if (state.posts.length === 0) {
        h += '<div class="px-6 py-10 text-center">';
        h += '<i class="fas fa-newspaper text-2xl text-gray-700 mb-3"></i>';
        h += '<p class="text-gray-400 text-sm">No posts yet. Create your first post above to engage your customers.</p>';
        h += '</div>';
      } else {
        for (var j = 0; j < state.posts.length; j++) {
          var p = state.posts[j];
          h += '<div class="px-6 py-4" style="border-top:1px solid #1a1a1a">';
          h += '<div class="flex items-center justify-between mb-2">';
          h += '<span class="text-xs font-medium px-2 py-0.5 rounded" style="background:#0d2818;color:#34a853">' + (p.status || 'PUBLISHED') + '</span>';
          h += '<span class="text-gray-500 text-xs">' + (p.created_at ? new Date(p.created_at).toLocaleDateString() : '') + '</span>';
          h += '</div>';
          h += '<p class="text-gray-300 text-sm">' + escapeHtml(p.content || '') + '</p>';
          if (p.call_to_action_type) {
            h += '<p class="text-xs text-blue-400 mt-1"><i class="fas fa-external-link-alt mr-1"></i>' + p.call_to_action_type + (p.call_to_action_url ? ': ' + escapeHtml(p.call_to_action_url) : '') + '</p>';
          }
          h += '</div>';
        }
      }
      h += '</div>'; // posts card
      h += '</div>'; // posts column

      h += '</div>'; // grid
    }

    h += '</div>'; // max-w container
    root.innerHTML = h;
  }

  function metricCard(label, value, icon, color) {
    return '<div class="rounded-xl p-4" style="background:#111111;border:1px solid #222">' +
      '<div class="flex items-center gap-3 mb-2">' +
      '<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:' + color + '22"><i class="fas ' + icon + '" style="color:' + color + ';font-size:14px"></i></div>' +
      '<span class="text-gray-400 text-xs">' + label + '</span></div>' +
      '<div class="text-xl font-bold text-white">' + value + '</div></div>';
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ============================================================
  // ACTIONS
  // ============================================================
  window._gbpConnect = function() {
    apiGet('/connect').then(function(data) {
      if (data.auth_url) {
        window.open(data.auth_url, 'gbp_connect', 'width=600,height=700');
      } else {
        window.rmToast(data.error || 'Failed to start connection', 'info');
      }
    });
  };

  window._gbpDisconnect = function() {
    if (!(await window.rmConfirm('Disconnect your Google Business Profile? Your cached data will remain.'))) return
    apiPost('/disconnect').then(function() {
      state.connected = false;
      state.business_name = null;
      state.connected_at = null;
      render();
    });
  };

  window._gbpSync = function() {
    state.syncing = true;
    state.message = null;
    render();
    apiPost('/sync').then(function(data) {
      state.syncing = false;
      if (data.error) {
        state.message = data.error;
      } else {
        state.message = data.message || 'Sync complete.';
        loadReviews();
        loadInsights();
      }
      render();
    }).catch(function() {
      state.syncing = false;
      state.message = 'Sync failed. Please try again.';
      render();
    });
  };

  window._gbpReply = function(reviewId) {
    state.replyingTo = reviewId;
    state.replyText = '';
    render();
  };

  window._gbpCancelReply = function() {
    state.replyingTo = null;
    state.replyText = '';
    render();
  };

  window._gbpSubmitReply = function(reviewId) {
    var el = document.getElementById('reply-text-' + reviewId);
    var text = el ? el.value.trim() : '';
    if (!text) { window.rmToast('Please enter a reply.', 'warning'); return; }

    apiPost('/reviews/' + reviewId + '/reply', { reply: text }).then(function(data) {
      if (data.success) {
        state.replyingTo = null;
        state.replyText = '';
        loadReviews();
      } else {
        window.rmToast(data.error || 'Failed to submit reply.', 'info');
      }
    });
  };

  window._gbpCreatePost = function() {
    var contentEl = document.getElementById('post-content');
    var ctaTypeEl = document.getElementById('post-cta-type');
    var ctaUrlEl = document.getElementById('post-cta-url');
    var content = contentEl ? contentEl.value.trim() : '';
    if (!content) { window.rmToast('Please enter post content.', 'warning'); return; }

    state.creatingPost = true;
    render();

    apiPost('/posts', {
      content: content,
      call_to_action_type: ctaTypeEl ? ctaTypeEl.value : '',
      call_to_action_url: ctaUrlEl ? ctaUrlEl.value : ''
    }).then(function(data) {
      state.creatingPost = false;
      if (data.success) {
        state.postText = '';
        state.postCtaType = '';
        state.postCtaUrl = '';
        state.message = 'Post published successfully!';
        loadPosts();
        loadInsights();
      } else {
        state.message = data.error || 'Failed to create post.';
      }
      render();
    }).catch(function() {
      state.creatingPost = false;
      state.message = 'Failed to create post. Please try again.';
      render();
    });
  };

  // Listen for OAuth popup messages
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'gbp_connected') {
      loadStatus();
      loadReviews();
      loadPosts();
      loadInsights();
    }
  });

  // ============================================================
  // INIT
  // ============================================================
  function loadStatus() {
    apiGet('/status').then(function(data) {
      state.connected = data.connected;
      state.business_name = data.business_name;
      state.account_id = data.account_id;
      state.location_id = data.location_id;
      state.connected_at = data.connected_at;
      render();
    });
  }

  function loadReviews() {
    apiGet('/reviews').then(function(data) {
      state.reviews = data.reviews || [];
      render();
    });
  }

  function loadPosts() {
    apiGet('/posts').then(function(data) {
      state.posts = data.posts || [];
      render();
    });
  }

  function loadInsights() {
    apiGet('/insights').then(function(data) {
      state.insights = data;
      render();
    });
  }

  // Check URL for connected param
  if (window.location.search.indexOf('connected=true') !== -1) {
    history.replaceState(null, '', window.location.pathname);
  }

  loadStatus();
  loadReviews();
  loadPosts();
  loadInsights();
  render();
})();
