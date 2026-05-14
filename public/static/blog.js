// ============================================================
// Roof Manager Blog — Frontend (blog.js)
// Handles both /blog listing and /blog/:slug post view
// ============================================================
(function () {
  'use strict';

  var API = '/api/blog';
  var currentPage = 1;
  var currentCategory = '';
  var currentSearch = '';
  var allPosts = [];
  var isPostPage = window.location.pathname.startsWith('/blog/') && window.location.pathname !== '/blog/';

  // ── CATEGORY DISPLAY CONFIG ──
  var categoryConfig = {
    'roofing':        { label: 'Roofing',         icon: 'fa-home',           color: 'sky' },
    'technology':     { label: 'Technology',       icon: 'fa-microchip',      color: 'purple' },
    'business':       { label: 'Business',         icon: 'fa-briefcase',      color: 'emerald' },
    'guides':         { label: 'Guides',           icon: 'fa-book',           color: 'amber' },
    'industry':       { label: 'Industry News',    icon: 'fa-newspaper',      color: 'blue' },
    'tips':           { label: 'Tips & Tricks',    icon: 'fa-lightbulb',      color: 'yellow' },
    'case-studies':   { label: 'Case Studies',     icon: 'fa-chart-line',     color: 'rose' },
    'product':        { label: 'Product Updates',  icon: 'fa-rocket',         color: 'indigo' },
    'city-guides':    { label: 'City Guides',      icon: 'fa-map-marker-alt', color: 'teal' },
    'international':  { label: 'International',    icon: 'fa-globe',          color: 'cyan' },
    'ai-voice':       { label: 'AI Voice',         icon: 'fa-microphone',     color: 'violet' },
    'storm-response': { label: 'Storm Response',   icon: 'fa-cloud-bolt',     color: 'slate' },
    'commercial':     { label: 'Commercial',       icon: 'fa-building',       color: 'stone' },
    'marketing':      { label: 'Marketing',        icon: 'fa-bullhorn',       color: 'orange' },
    'insurance':      { label: 'Insurance',        icon: 'fa-shield-alt',     color: 'green' },
    'sales':          { label: 'Sales',            icon: 'fa-handshake',      color: 'pink' }
  };

  // ── UTILITY FUNCTIONS ──
  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  var categoryDarkColors = {
    'sky':    'bg-sky-500/10 text-sky-400',
    'purple': 'bg-purple-500/10 text-purple-400',
    'emerald':'bg-emerald-500/10 text-emerald-400',
    'amber':  'bg-amber-500/10 text-amber-400',
    'blue':   'bg-blue-500/10 text-blue-400',
    'yellow': 'bg-yellow-500/10 text-yellow-400',
    'rose':   'bg-rose-500/10 text-rose-400',
    'indigo': 'bg-indigo-500/10 text-indigo-400',
    'teal':   'bg-teal-500/10 text-teal-400',
    'cyan':   'bg-cyan-500/10 text-cyan-400',
    'violet': 'bg-violet-500/10 text-violet-400',
    'slate':  'bg-slate-500/10 text-slate-300',
    'stone':  'bg-stone-400/10 text-stone-300',
    'orange': 'bg-orange-500/10 text-orange-400',
    'green':  'bg-green-500/10 text-green-400',
    'pink':   'bg-pink-500/10 text-pink-400',
    'gray':   'bg-white/10 text-gray-400'
  };

  function getCategoryBadge(cat) {
    var cfg = categoryConfig[cat] || { label: cat, icon: 'fa-tag', color: 'gray' };
    var darkClass = categoryDarkColors[cfg.color] || 'bg-white/10 text-gray-400';
    return '<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ' + darkClass + '">' +
      '<i class="fas ' + cfg.icon + ' text-[10px]"></i>' + cfg.label + '</span>';
  }

  // ── BLOG LISTING PAGE ──
  function initListingPage() {
    loadCategories();
    loadPosts();

    // Search with debounce
    var searchInput = document.getElementById('blog-search');
    if (searchInput) {
      var timer = null;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentSearch = searchInput.value.trim();
          currentPage = 1;
          loadPosts();
        }, 400);
      });
    }
  }

  function loadCategories() {
    fetch(API + '/categories')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var cats = data.categories || [];
        var heroEl = document.getElementById('blog-categories-hero');
        var filterEl = document.getElementById('blog-category-filters');

        if (heroEl && cats.length > 0) {
          heroEl.innerHTML = cats.map(function (c) {
            var cfg = categoryConfig[c.category] || { label: c.category, icon: 'fa-tag', color: 'sky' };
            return '<button onclick="filterCategory(\'' + c.category + '\')" class="blog-cat-btn px-4 py-2 rounded-full text-sm font-medium bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm transition-all border border-white/20">' +
              '<i class="fas ' + cfg.icon + ' mr-1.5"></i>' + cfg.label + ' <span class="opacity-70 ml-1">(' + c.count + ')</span></button>';
          }).join('');
        }

        if (filterEl) {
          filterEl.innerHTML = '<button onclick="filterCategory(\'\')" class="blog-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-[#00FF88] text-black" data-cat="">All</button>' +
            cats.map(function (c) {
              var cfg = categoryConfig[c.category] || { label: c.category, icon: 'fa-tag' };
              return '<button onclick="filterCategory(\'' + c.category + '\')" class="blog-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 text-gray-400 hover:bg-[#00FF88]/10 hover:text-[#00FF88] transition-all" data-cat="' + c.category + '">' +
                '<i class="fas ' + cfg.icon + ' mr-1"></i>' + cfg.label + '</button>';
            }).join('');
        }
      })
      .catch(function () { });
  }

  window.filterCategory = function (cat) {
    currentCategory = cat;
    currentPage = 1;
    loadPosts();

    // Update active filter button
    var btns = document.querySelectorAll('.blog-filter-btn');
    btns.forEach(function (btn) {
      if (btn.getAttribute('data-cat') === cat) {
        btn.className = 'blog-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-[#00FF88] text-black';
      } else {
        btn.className = 'blog-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 text-gray-400 hover:bg-[#00FF88]/10 hover:text-[#00FF88] transition-all';
      }
    });
  };

  function loadPosts() {
    var params = '?page=' + currentPage + '&limit=12';
    if (currentCategory) params += '&category=' + encodeURIComponent(currentCategory);
    if (currentSearch) params += '&search=' + encodeURIComponent(currentSearch);

    fetch(API + '/posts' + params)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var posts = data.posts || [];
        var pagination = data.pagination || {};
        allPosts = posts;

        var gridEl = document.getElementById('blog-grid');
        var emptyEl = document.getElementById('blog-empty');
        var featEl = document.getElementById('blog-featured');
        var moreEl = document.getElementById('blog-load-more');

        if (posts.length === 0) {
          if (gridEl) gridEl.innerHTML = '';
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (featEl) featEl.innerHTML = '';
          if (moreEl) moreEl.classList.add('hidden');
          return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        // Featured post (first featured or first post on page 1)
        var featured = null;
        var gridPosts = posts;
        if (currentPage === 1 && !currentSearch && !currentCategory) {
          featured = posts.find(function (p) { return p.is_featured; }) || posts[0];
          gridPosts = posts.filter(function (p) { return p !== featured; });
        }

        if (featEl) {
          if (featured) {
            featEl.innerHTML = renderFeaturedPost(featured);
          } else {
            featEl.innerHTML = '';
          }
        }

        if (gridEl) {
          gridEl.innerHTML = gridPosts.map(renderPostCard).join('');
        }

        if (moreEl) {
          if (pagination.has_more) {
            moreEl.classList.remove('hidden');
          } else {
            moreEl.classList.add('hidden');
          }
        }
      })
      .catch(function (err) {
        console.error('Blog load error:', err);
        var gridEl = document.getElementById('blog-grid');
        if (gridEl) gridEl.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">Failed to load articles. Please try again.</div>';
      });
  }

  window.loadMorePosts = function () {
    currentPage++;
    loadPosts();
  };

  function renderFeaturedPost(post) {
    var coverStyle = post.cover_image_url
      ? 'background-image:url(' + escapeHtml(post.cover_image_url) + ');background-size:cover;background-position:center'
      : 'background:linear-gradient(135deg,#111 0%,#1a1a1a 100%)';

    return '<a href="/blog/' + escapeHtml(post.slug) + '" class="block group">' +
      '<div class="bg-[#111111] border border-white/10 rounded-2xl overflow-hidden hover:border-[#00FF88]/30 transition-all duration-300 md:flex">' +
        '<div class="md:w-1/2 h-64 md:h-auto relative" style="' + coverStyle + ';min-height:280px">' +
          '<div class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>' +
          '<div class="absolute top-4 left-4">' +
            '<span class="bg-[#00FF88] text-black text-xs font-bold px-3 py-1.5 rounded-full"><i class="fas fa-star mr-1"></i>Featured</span>' +
          '</div>' +
          (post.cover_image_url ? '' : '<div class="absolute inset-0 flex items-center justify-center"><i class="fas fa-newspaper text-white/30 text-6xl"></i></div>') +
        '</div>' +
        '<div class="md:w-1/2 p-8 flex flex-col justify-center">' +
          '<div class="flex items-center gap-3 mb-3">' +
            getCategoryBadge(post.category) +
            '<span class="text-gray-500 text-xs"><i class="far fa-clock mr-1"></i>' + (post.read_time_minutes || 5) + ' min read</span>' +
          '</div>' +
          '<h2 class="text-2xl md:text-3xl font-bold text-white mb-3 group-hover:text-[#00FF88] transition-colors leading-tight">' + escapeHtml(post.title) + '</h2>' +
          '<p class="text-gray-400 mb-4 leading-relaxed line-clamp-3">' + escapeHtml(post.excerpt) + '</p>' +
          '<div class="flex items-center justify-between mt-auto">' +
            '<div class="flex items-center gap-2">' +
              '<div class="w-8 h-8 bg-[#00FF88]/10 rounded-full flex items-center justify-center"><i class="fas fa-user text-[#00FF88] text-xs"></i></div>' +
              '<div><div class="text-sm font-semibold text-gray-300">' + escapeHtml(post.author_name || 'Roof Manager Team') + '</div>' +
              '<div class="text-xs text-gray-500">' + formatDate(post.published_at) + '</div></div>' +
            '</div>' +
            '<span class="text-[#00FF88] font-semibold text-sm group-hover:translate-x-1 transition-transform">Read More <i class="fas fa-arrow-right ml-1"></i></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</a>';
  }

  function renderPostCard(post) {
    var coverStyle = post.cover_image_url
      ? 'background-image:url(' + escapeHtml(post.cover_image_url) + ');background-size:cover;background-position:center'
      : 'background:linear-gradient(135deg,#111 0%,#1a1a1a 100%)';

    return '<a href="/blog/' + escapeHtml(post.slug) + '" class="block group">' +
      '<article class="bg-[#111111] border border-white/10 rounded-xl overflow-hidden hover:border-[#00FF88]/30 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">' +
        '<div class="h-48 relative" style="' + coverStyle + '">' +
          '<div class="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"></div>' +
          (post.cover_image_url ? '' : '<div class="absolute inset-0 flex items-center justify-center"><i class="fas fa-newspaper text-white/30 text-4xl"></i></div>') +
          '<div class="absolute top-3 left-3">' + getCategoryBadge(post.category) + '</div>' +
        '</div>' +
        '<div class="p-5 flex flex-col flex-1">' +
          '<h3 class="font-bold text-white mb-2 group-hover:text-[#00FF88] transition-colors leading-snug line-clamp-2">' + escapeHtml(post.title) + '</h3>' +
          '<p class="text-gray-400 text-sm mb-4 leading-relaxed line-clamp-3 flex-1">' + escapeHtml(post.excerpt) + '</p>' +
          '<div class="flex items-center justify-between pt-4 border-t border-white/5">' +
            '<span class="text-xs text-gray-500">' + formatDate(post.published_at) + '</span>' +
            '<span class="text-xs text-gray-500"><i class="far fa-clock mr-1"></i>' + (post.read_time_minutes || 5) + ' min</span>' +
          '</div>' +
        '</div>' +
      '</article>' +
    '</a>';
  }

  // ── BLOG POST PAGE ──
  function initPostPage() {
    var pathParts = window.location.pathname.split('/');
    var slug = pathParts[pathParts.length - 1];
    if (!slug) return;

    fetch(API + '/posts/' + encodeURIComponent(slug))
      .then(function (r) {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(function (data) {
        var post = data.post;
        var related = data.related || [];

        if (!post) {
          showNotFound();
          return;
        }

        // Update page title and meta
        document.title = (post.meta_title || post.title) + ' - Roof Manager Blog';
        var metaDesc = document.getElementById('meta-desc');
        if (metaDesc) metaDesc.setAttribute('content', post.meta_description || post.excerpt || '');
        var breadcrumb = document.getElementById('breadcrumb-title');
        if (breadcrumb) breadcrumb.textContent = post.title;
        var bcTitle = document.getElementById('bc-post-title');
        if (bcTitle) bcTitle.textContent = post.title;

        // Render article
        renderArticle(post);

        // Show CTA
        var ctaEl = document.getElementById('blog-cta');
        if (ctaEl) ctaEl.classList.remove('hidden');

        // Related posts
        if (related.length > 0) {
          var relEl = document.getElementById('blog-related');
          var relGrid = document.getElementById('blog-related-grid');
          if (relEl && relGrid) {
            relEl.classList.remove('hidden');
            relGrid.innerHTML = related.map(function (p) {
              return renderPostCard(p);
            }).join('');
          }
        }
      })
      .catch(function () {
        showNotFound();
      });
  }

  function injectPostSchema(content) {
    // innerHTML doesn't execute <script> tags — extract and inject manually
    var re = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    while ((match = re.exec(content)) !== null) {
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = match[1];
      document.head.appendChild(s);
    }
  }

  function autoLinkCountries(containerEl) {
    var countries = [
      'United States', 'Canada', 'Mexico', 'Puerto Rico', 'The Bahamas', 'Antigua and Barbuda',
      'United Kingdom', 'France', 'Germany', 'Spain', 'Italy', 'Portugal', 'Belgium', 'Austria',
      'Switzerland', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Ireland', 'Poland', 'Czechia', 'Greece',
      'Australia', 'Japan', 'New Zealand', 'Indonesia', 'Malaysia', 'Philippines', 'Taiwan', 'Thailand',
      'Brazil', 'Colombia', 'Peru'
    ];

    // Walk text nodes only (don't mess with existing links/tags)
    var walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(function(node) {
      // Skip if already inside a link
      if (node.parentElement && node.parentElement.closest('a')) return;

      var text = node.textContent;
      var replaced = false;

      countries.forEach(function(country) {
        if (text.indexOf(country) !== -1 && !replaced) {
          var parts = text.split(country);
          if (parts.length > 1) {
            var fragment = document.createDocumentFragment();
            parts.forEach(function(part, i) {
              if (i > 0) {
                var link = document.createElement('a');
                link.href = '/coverage';
                link.textContent = country;
                link.style.color = '#00FF88';
                link.style.textDecoration = 'underline';
                link.style.fontWeight = '600';
                link.title = 'See Roof Manager coverage in ' + country;
                fragment.appendChild(link);
              }
              fragment.appendChild(document.createTextNode(part));
            });
            node.parentNode.replaceChild(fragment, node);
            replaced = true;
          }
        }
      });
    });

    // Second pass: link US states and cities to their pages
    var cityLinks = {
      'Texas': '/roof-measurement/united-states',
      'Florida': '/roof-measurement/united-states',
      'California': '/roof-measurement/united-states',
      'Colorado': '/roof-measurement/united-states',
      'Georgia': '/roof-measurement/united-states',
      'New York': '/roof-measurement/new-york',
      'Los Angeles': '/roof-measurement/los-angeles',
      'Chicago': '/roof-measurement/chicago',
      'Houston': '/roof-measurement/houston',
      'Dallas': '/roof-measurement/dallas',
      'Phoenix': '/roof-measurement/phoenix',
      'Denver': '/roof-measurement/denver',
      'Miami': '/roof-measurement/miami',
      'Atlanta': '/roof-measurement/atlanta',
      'Seattle': '/roof-measurement/seattle',
      'Nashville': '/roof-measurement/nashville',
      'Austin': '/roof-measurement/austin',
      'Tampa': '/roof-measurement/tampa',
      'Calgary': '/roof-measurement/calgary',
      'Toronto': '/roof-measurement/toronto',
      'Vancouver': '/roof-measurement/vancouver',
      'Edmonton': '/roof-measurement/edmonton',
      'London': '/roof-measurement/london',
      'Paris': '/roof-measurement/paris',
      'Berlin': '/roof-measurement/berlin',
      'Madrid': '/roof-measurement/madrid',
      'Rome': '/roof-measurement/rome',
      'Amsterdam': '/roof-measurement/amsterdam',
      'Brussels': '/roof-measurement/brussels',
      'Vienna': '/roof-measurement/vienna',
      'Zurich': '/roof-measurement/zurich',
      'Copenhagen': '/roof-measurement/copenhagen',
      'Stockholm': '/roof-measurement/stockholm',
      'Oslo': '/roof-measurement/oslo',
      'Helsinki': '/roof-measurement/helsinki',
      'Dublin': '/roof-measurement/dublin',
      'Prague': '/roof-measurement/prague'
    };

    var walker2 = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false);
    var textNodes2 = [];
    while (walker2.nextNode()) textNodes2.push(walker2.currentNode);

    textNodes2.forEach(function(node) {
      if (node.parentElement && node.parentElement.closest('a')) return;
      var text = node.textContent;
      var replaced = false;
      Object.keys(cityLinks).forEach(function(city) {
        if (text.indexOf(city) !== -1 && !replaced) {
          var parts = text.split(city);
          if (parts.length > 1) {
            var fragment = document.createDocumentFragment();
            parts.forEach(function(part, i) {
              if (i > 0) {
                var link = document.createElement('a');
                link.href = cityLinks[city];
                link.textContent = city;
                link.style.color = '#22d3ee';
                link.style.textDecoration = 'underline';
                link.style.fontWeight = '600';
                link.title = 'Roof measurement reports in ' + city;
                fragment.appendChild(link);
              }
              fragment.appendChild(document.createTextNode(part));
            });
            node.parentNode.replaceChild(fragment, node);
            replaced = true;
          }
        }
      });
    });

    // Third pass: auto-link product phrases to feature hub pages
    var productLinks = [
      // Order matters — longer phrases first to avoid partial matches
      { phrase: 'AI roof measurement reports', url: '/features/measurements', color: '#00FF88', title: 'AI Roof Measurement Reports — Roof Manager' },
      { phrase: 'AI roof measurement report', url: '/features/measurements', color: '#00FF88', title: 'AI Roof Measurement Reports — Roof Manager' },
      { phrase: 'satellite roof measurements', url: '/features/measurements', color: '#00FF88', title: 'Satellite Roof Measurement Reports' },
      { phrase: 'satellite roof measurement', url: '/features/measurements', color: '#00FF88', title: 'Satellite Roof Measurement Reports' },
      { phrase: 'roof measurement reports', url: '/features/measurements', color: '#00FF88', title: 'AI Roof Measurement Reports — Roof Manager' },
      { phrase: 'roof measurement report', url: '/features/measurements', color: '#00FF88', title: 'AI Roof Measurement Reports — Roof Manager' },
      { phrase: 'material bill of materials', url: '/features/measurements', color: '#00FF88', title: 'Material BOM in Roof Measurement Reports' },
      { phrase: 'material BOM', url: '/features/measurements', color: '#00FF88', title: 'Material BOM in Roof Measurement Reports' },
      { phrase: 'roofing CRM software', url: '/features/crm', color: '#22d3ee', title: 'Roofing CRM — Roof Manager' },
      { phrase: 'roofing CRM', url: '/features/crm', color: '#22d3ee', title: 'Roofing CRM — Roof Manager' },
      { phrase: 'AI Roofer Secretary', url: '/features/ai-secretary', color: '#f59e0b', title: 'AI Roofer Secretary — 24/7 Phone Receptionist' },
      { phrase: 'AI phone secretary', url: '/features/ai-secretary', color: '#f59e0b', title: 'AI Roofer Secretary — 24/7 Phone Receptionist' },
      { phrase: 'AI receptionist', url: '/features/ai-secretary', color: '#f59e0b', title: 'AI Roofer Secretary — 24/7 Phone Receptionist' },
      { phrase: 'virtual roof try-on', url: '/features/virtual-try-on', color: '#a78bfa', title: 'Virtual Roof Try-On — AI Visualization' },
      { phrase: 'roof visualization', url: '/features/virtual-try-on', color: '#a78bfa', title: 'Virtual Roof Try-On — AI Visualization' },
      // Comparison page deep-links
      { phrase: 'Roofr alternative',        url: '/roofr-alternative',                color: '#00FF88', title: 'Roofr Alternative for Canadian Contractors' },
      { phrase: 'Roofr pricing',            url: '/roofr-pricing-complaints',         color: '#00FF88', title: 'Is Roofr Too Expensive for Canada?' },
      { phrase: 'RoofSnap alternative',     url: '/roofsnap-vs-roofmanager',          color: '#00FF88', title: 'RoofSnap vs RoofManager for Canada' },
      { phrase: 'EagleView alternative',    url: '/cheaper-alternative-to-eagleview', color: '#00FF88', title: 'Cheaper EagleView Alternative' },
      { phrase: 'cheaper than EagleView',   url: '/cheaper-alternative-to-eagleview', color: '#00FF88', title: 'Cheaper EagleView Alternative' },
      // Blog-to-blog phrase triggers — measurement cluster
      { phrase: 'how to measure a roof without climbing', url: '/blog/how-to-measure-a-roof-without-climbing-2026', color: '#22d3ee', title: 'How to Measure a Roof Without Climbing (2026)' },
      { phrase: 'measure a roof without climbing',        url: '/blog/how-to-measure-a-roof-without-climbing-2026', color: '#22d3ee', title: 'How to Measure a Roof Without Climbing (2026)' },
      { phrase: 'roof pitch calculator',   url: '/blog/roof-pitch-calculator-guide',   color: '#22d3ee', title: 'Roof Pitch Calculator Guide' },
      { phrase: 'pitch factor',            url: '/blog/roof-pitch-calculator-guide',   color: '#22d3ee', title: 'Roof Pitch Calculator Guide' },
      { phrase: 'material takeoff',        url: '/blog/what-is-a-material-takeoff-roofing', color: '#22d3ee', title: 'What Is a Material Takeoff in Roofing?' },
      { phrase: 'estimate accuracy',       url: '/blog/roofing-estimate-accuracy-guide', color: '#22d3ee', title: 'Why Your Roofing Estimates Are Off' },
      // Blog-to-blog — storm / insurance cluster
      { phrase: 'storm damage inspection', url: '/blog/storm-damage-roof-inspection-checklist-2026', color: '#f59e0b', title: 'Storm Damage Roof Inspection Checklist' },
      { phrase: 'hail damage inspection',  url: '/blog/storm-damage-roof-inspection-checklist-2026', color: '#f59e0b', title: 'Storm Damage Roof Inspection Checklist' },
      { phrase: 'insurance claim documentation', url: '/blog/insurance-roof-claim-documentation-guide', color: '#f59e0b', title: 'Roof Insurance Claim Documentation Guide' },
      { phrase: 'document roof damage',    url: '/blog/insurance-roof-claim-documentation-guide', color: '#f59e0b', title: 'How to Document Roof Damage for Insurance' },
      // Blog-to-blog — Alberta / city cluster
      { phrase: 'Alberta hail',            url: '/blog/alberta-hail-wind-roofing-estimate-automation', color: '#a78bfa', title: 'Alberta Hail & Wind Roofing Estimates' },
      { phrase: 'hail damage estimate',    url: '/blog/alberta-hail-wind-roofing-estimate-automation', color: '#a78bfa', title: 'Alberta Hail & Wind Roofing Estimates' },
      { phrase: 'ice dam',                 url: '/blog/quebec-ice-dam-prevention-roofing', color: '#a78bfa', title: 'Ice Dam Prevention Estimating in Quebec' },
      { phrase: 'flat roof drainage',      url: '/blog/vancouver-flat-roof-drainage-measurement', color: '#a78bfa', title: 'Vancouver Flat Roof Drainage Guide' },
      { phrase: 'coastal roofing',         url: '/blog/atlantic-canada-coastal-roofing-estimates', color: '#a78bfa', title: 'Coastal Roofing in Atlantic Canada' },
      { phrase: 'salt air',                url: '/blog/atlantic-canada-coastal-roofing-estimates', color: '#a78bfa', title: 'Coastal Roofing in Atlantic Canada' },
      // Blog-to-blog — EagleView cluster
      { phrase: 'EagleView cost',          url: '/blog/eagleview-cost-2026-alternatives', color: '#00FF88', title: 'How Much Does EagleView Cost in 2026?' },
      { phrase: 'EagleView pricing',       url: '/blog/eagleview-cost-2026-alternatives', color: '#00FF88', title: 'How Much Does EagleView Cost in 2026?' },
      { phrase: 'AI measurement accuracy', url: '/blog/ai-roof-measurement-accuracy-explained', color: '#00FF88', title: 'How Accurate Are AI Roof Measurement Reports?' },
      { phrase: 'AI phone receptionist',   url: '/blog/how-ai-phone-receptionist-works-roofing', color: '#f59e0b', title: 'How an AI Phone Receptionist Works for Roofing' },
    ];

    productLinks.forEach(function(item) {
      var walker3 = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false);
      var tnodes = [];
      while (walker3.nextNode()) tnodes.push(walker3.currentNode);
      tnodes.forEach(function(node) {
        if (node.parentElement && node.parentElement.closest('a')) return;
        var text = node.textContent;
        if (text.indexOf(item.phrase) !== -1) {
          var parts = text.split(item.phrase);
          if (parts.length > 1) {
            var fragment = document.createDocumentFragment();
            parts.forEach(function(part, i) {
              if (i > 0) {
                var link = document.createElement('a');
                link.href = item.url;
                link.textContent = item.phrase;
                link.style.color = item.color;
                link.style.textDecoration = 'underline';
                link.style.fontWeight = '600';
                link.title = item.title;
                fragment.appendChild(link);
              }
              fragment.appendChild(document.createTextNode(part));
            });
            node.parentNode.replaceChild(fragment, node);
          }
        }
      });
    });
  }

  // ── CATEGORY → FEATURE HUB MAPPING ──
  var featureByCategory = {
    'storm-response': { url: '/features/ai-secretary',  color: '#f59e0b', icon: 'fas fa-headset',  name: 'AI Roofer Secretary',          headline: 'Capture every storm lead — even at 2am',            sub: '24/7 AI phone receptionist that never misses a call', cta: 'Set Up AI Secretary' },
    'ai-voice':       { url: '/features/ai-secretary',  color: '#f59e0b', icon: 'fas fa-headset',  name: 'AI Roofer Secretary',          headline: 'Your 24/7 AI phone receptionist',                   sub: 'Books appointments, qualifies leads, sends call summaries', cta: 'Try AI Secretary' },
    'business':       { url: '/features/crm',           color: '#22d3ee', icon: 'fas fa-users',    name: 'Roofing CRM',                  headline: 'Stop losing leads in spreadsheets',                 sub: 'Full pipeline management — free with every account', cta: 'Open Free CRM' },
    'sales':          { url: '/features/crm',           color: '#22d3ee', icon: 'fas fa-users',    name: 'Roofing CRM',                  headline: 'Manage your pipeline from lead to final invoice',    sub: 'Built specifically for roofing contractors', cta: 'Open Free CRM' },
    'marketing':      { url: '/features/crm',           color: '#22d3ee', icon: 'fas fa-users',    name: 'Roofing CRM',                  headline: 'Automate your follow-ups and close more jobs',       sub: 'Reminders at day 3, 7, and 14 after every estimate', cta: 'Open Free CRM' },
    'insurance':      { url: '/features/measurements',  color: '#00FF88', icon: 'fas fa-satellite', name: 'AI Measurement Reports',      headline: 'Reports accepted by most insurance adjusters',      sub: '99% accuracy · Includes edge breakdowns + material BOM', cta: 'Get Free Report' },
    'commercial':     { url: '/features/measurements',  color: '#00FF88', icon: 'fas fa-satellite', name: 'AI Measurement Reports',      headline: 'Accurate commercial roof measurements in 60s',      sub: 'LiDAR-calibrated 3D models from Google satellite data', cta: 'Get Free Report' },
  };
  function getFeatureForCategory(cat) {
    return featureByCategory[cat] || {
      url: '/features/measurements', color: '#00FF88', icon: 'fas fa-satellite',
      name: 'AI Measurement Reports',
      headline: 'Get the measurement — quote from your truck',
      sub: '99% accuracy in 1–2 hours · No credit card needed',
      cta: 'Start 4 Free Reports'
    };
  }

  function getInContentCTA(category) {
    var f = getFeatureForCategory(category);
    return '<div class="rm-incontent-cta not-prose my-8 rounded-2xl p-6 text-center" style="background:' + f.color + '0f;border:1px solid ' + f.color + '33">' +
      '<p class="font-black text-white text-lg mb-1">' + f.headline + '</p>' +
      '<p class="text-gray-400 text-sm mb-4">' + f.sub + '</p>' +
      '<a href="' + f.url + '" style="background:' + f.color + ';color:#0A0A0A;font-weight:800;padding:12px 32px;border-radius:12px;display:inline-block;text-decoration:none">' + f.cta + ' →</a>' +
    '</div>';
  }

  // ── IN-CONTENT CTA + TABLE OF CONTENTS ──
  function enhancePostContent(html, readTime, category) {
    var cta = getInContentCTA(category || 'roofing');
    // 1. Inject in-content CTA after the 2nd </h2>, or after 3rd </p> if fewer than 2 h2s
    var h2count = (html.match(/<\/h2>/gi) || []).length;
    if (h2count >= 2) {
      var n = 0;
      html = html.replace(/<\/h2>/gi, function(m) { n++; return n === 2 ? '</h2>' + cta : m; });
    } else {
      var p = 0;
      html = html.replace(/<\/p>/gi, function(m) { p++; return p === 3 ? '</p>' + cta : m; });
    }

    // 2. Auto-generate TOC for long posts (>= 8 min read)
    if (readTime >= 8) {
      var headings = [];
      var idxRe = /<h2[^>]*>(.*?)<\/h2>/gi;
      var hm;
      while ((hm = idxRe.exec(html)) !== null) {
        var text = hm[1].replace(/<[^>]+>/g, '').trim();
        var id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
        headings.push({ text: text, id: id });
      }
      if (headings.length >= 3) {
        // Add IDs to h2s
        var idx2 = 0;
        html = html.replace(/<h2([^>]*)>(.*?)<\/h2>/gi, function(m, attrs, inner) {
          var h = headings[idx2++];
          return '<h2' + attrs + ' id="' + (h ? h.id : '') + '">' + inner + '</h2>';
        });
        var tocItems = headings.map(function(h, i) {
          return '<li><a href="#' + h.id + '" style="color:#9ca3af;text-decoration:none;font-size:13px" onmouseover="this.style.color=\'#00FF88\'" onmouseout="this.style.color=\'#9ca3af\'">' + (i+1) + '. ' + escapeHtml(h.text) + '</a></li>';
        }).join('');
        var toc = '<div class="rm-toc not-prose my-6 rounded-xl p-5" style="background:#111111;border:1px solid rgba(255,255,255,0.08)">' +
          '<details open>' +
          '<summary style="cursor:pointer;font-size:14px;font-weight:700;color:#fff;list-style:none;display:flex;align-items:center;gap:8px"><span style="color:#00FF88"><i class="fas fa-list" style="font-size:11px"></i></span> Table of Contents</summary>' +
          '<ol style="margin-top:12px;padding-left:20px;space-y:4px">' + tocItems + '</ol>' +
          '</details>' +
        '</div>';
        // Insert TOC before first h2
        html = html.replace(/<h2/, toc + '<h2');
      }
    }
    return html;
  }

  function renderArticle(post) {
    var contentEl = document.getElementById('blog-post-content');
    if (!contentEl) return;
    injectPostSchema(post.content || '');

    var coverHtml = '';
    if (post.cover_image_url) {
      coverHtml = '<img src="' + escapeHtml(post.cover_image_url) + '" alt="' + escapeHtml(post.title) + '" class="w-full h-64 md:h-96 object-cover rounded-2xl mb-8 shadow-lg">';
    }

    var tagsHtml = '';
    if (post.tags) {
      var tagList = post.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      if (tagList.length > 0) {
        tagsHtml = '<div class="flex flex-wrap gap-2 mb-8">' +
          tagList.map(function (tag) {
            return '<span class="px-3 py-1 bg-white/10 text-gray-400 text-xs font-medium rounded-full">#' + escapeHtml(tag) + '</span>';
          }).join('') +
          '</div>';
      }
    }

    contentEl.innerHTML =
      coverHtml +
      '<div class="mb-6">' +
        '<div class="flex items-center gap-3 mb-4">' +
          getCategoryBadge(post.category) +
          '<span class="text-gray-500 text-sm"><i class="far fa-clock mr-1"></i>' + (post.read_time_minutes || 5) + ' min read</span>' +
          '<span class="text-gray-500 text-sm"><i class="far fa-eye mr-1"></i>' + (post.view_count || 0) + ' views</span>' +
        '</div>' +
        '<h1 class="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4">' + escapeHtml(post.title) + '</h1>' +
        (post.excerpt ? '<p class="text-lg text-gray-400 leading-relaxed">' + escapeHtml(post.excerpt) + '</p>' : '') +
      '</div>' +
      '<div class="flex items-center gap-4 pb-8 mb-8 border-b border-white/10">' +
        '<div class="w-12 h-12 bg-[#00FF88]/10 rounded-full flex items-center justify-center"><i class="fas fa-user text-[#00FF88]"></i></div>' +
        '<div>' +
          '<div class="font-semibold text-gray-300">' + escapeHtml(post.author_name || 'Roof Manager Team') + '</div>' +
          '<div class="text-sm text-gray-500">' + formatDate(post.published_at) + (post.updated_at !== post.created_at ? ' · Updated ' + formatDate(post.updated_at) : '') + '</div>' +
        '</div>' +
        '<div class="ml-auto flex items-center gap-3">' +
          '<button onclick="shareBlog()" class="text-gray-400 hover:text-[#00FF88] transition-colors" title="Share"><i class="fas fa-share-alt text-lg"></i></button>' +
        '</div>' +
      '</div>' +
      tagsHtml +
      '<div class="prose prose-lg prose-invert max-w-none blog-content">' +
        enhancePostContent(post.content || '', post.read_time_minutes || 0, post.category) +
      '</div>' +
      // Related Feature section — hub-and-spoke link after content
      (function() {
        var f = getFeatureForCategory(post.category);
        var cityGuideLink = '';
        if (post.category === 'city-guides') {
          var knownCities = {'calgary':'calgary','edmonton':'edmonton','toronto':'toronto','vancouver':'vancouver','new-york':'new-york','los-angeles':'los-angeles','houston':'houston','dallas':'dallas','denver':'denver','miami':'miami','seattle':'seattle','chicago':'chicago','ottawa':'ottawa','winnipeg':'winnipeg','saskatoon':'saskatoon'};
          var slug2 = (window.location.pathname.split('/').pop() || '');
          for (var c in knownCities) {
            if (slug2.indexOf(c) !== -1) {
              cityGuideLink = '<a href="/features/measurements/' + c + '" style="color:' + f.color + ';font-weight:700;text-decoration:underline">View the measurement platform for ' + (c.charAt(0).toUpperCase()+c.slice(1).replace(/-/g,' ')) + ' →</a>';
              break;
            }
          }
        }
        return '<div class="not-prose mt-10 mb-4 rounded-2xl p-6" style="background:' + f.color + '08;border:1px solid ' + f.color + '25">' +
          '<div class="flex items-start gap-4">' +
            '<div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style="background:' + f.color + '18">' +
              '<i class="' + f.icon + '" style="color:' + f.color + ';font-size:15px"></i>' +
            '</div>' +
            '<div class="flex-1">' +
              '<div class="text-xs font-bold mb-1" style="color:' + f.color + '">RELATED PLATFORM FEATURE</div>' +
              '<p class="font-black text-white text-base mb-0.5">' + f.name + '</p>' +
              '<p class="text-gray-400 text-sm mb-3">' + f.sub + '</p>' +
              (cityGuideLink ? '<p class="text-sm mb-3">' + cityGuideLink + '</p>' : '') +
              '<a href="' + f.url + '" style="background:' + f.color + ';color:#0A0A0A;font-weight:800;padding:10px 24px;border-radius:10px;display:inline-block;text-decoration:none;font-size:13px">' + f.cta + ' →</a>' +
            '</div>' +
          '</div>' +
        '</div>';
      })() +
      // Contact form — 3 fields, no phone, calendar booking on success
      '<div class="mt-8 rounded-2xl p-8 text-white" style="background:linear-gradient(135deg,#0d1117,#0a0f1a)">' +
        '<div class="text-center mb-6">' +
          '<h2 class="text-2xl font-black mb-2">Get Started with Roof Manager</h2>' +
          '<p class="text-gray-400 text-sm">Tell us about your business and we\'ll have you set up in minutes.</p>' +
        '</div>' +
        '<form onsubmit="submitBlogContact(event)" class="max-w-lg mx-auto space-y-4">' +
          '<input type="text" id="bc-name" placeholder="Your Name *" required class="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#00FF88] focus:border-transparent outline-none">' +
          '<div class="grid grid-cols-2 gap-4">' +
            '<input type="text" id="bc-company" placeholder="Company Name" class="px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#00FF88] focus:border-transparent outline-none">' +
            '<input type="email" id="bc-email" placeholder="Email Address *" required class="px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#00FF88] focus:border-transparent outline-none">' +
          '</div>' +
          '<input type="tel" id="bc-phone" placeholder="Phone (optional, for follow-up)" autocomplete="tel" class="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#00FF88] focus:border-transparent outline-none">' +
          '<textarea id="bc-message" rows="3" placeholder="Tell us about your roofing business..." class="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#00FF88] focus:border-transparent outline-none resize-none"></textarea>' +
          '<div id="bc-msg" class="hidden text-sm font-medium px-4 py-3 rounded-lg"></div>' +
          '<button type="submit" id="bc-submit" class="w-full py-4 font-extrabold rounded-xl text-lg transition-all shadow-xl" style="background:#00FF88;color:#0A0A0A"><i class="fas fa-rocket mr-2"></i>Get My Free Reports</button>' +
          '<p class="text-center text-xs text-gray-600 mt-1"><i class="fas fa-lock mr-1" style="color:#00FF88"></i>No credit card required &middot; 4 free reports included</p>' +
          '<div class="text-center my-3"><span class="text-gray-600 text-xs">— or skip the form —</span></div>' +
          '<a href="https://calendar.app.google/KNLFST4CNxViPPN3A" target="_blank" class="block w-full py-4 font-bold rounded-xl text-sm transition-all text-center border border-white/10 hover:border-white/20" style="background:rgba(255,255,255,0.05);color:#fff"><i class="fas fa-calendar-check mr-2" style="color:#00FF88"></i>Book a Free 15-Min Demo Instead</a>' +
        '</form>' +
      '</div>';

    // Auto-link country names to /coverage page
    var blogContentDiv = contentEl.querySelector('.blog-content');
    if (blogContentDiv) {
      autoLinkCountries(blogContentDiv);
    }
  }

  window.submitBlogContact = function(e) {
    e.preventDefault();
    var nameEl = document.getElementById('bc-name');
    var emailEl = document.getElementById('bc-email');
    if (!nameEl || !emailEl) return;
    var name = (nameEl.value || '').trim();
    var email = (emailEl.value || '').trim();
    if (!name || !email) return;
    var data = {
      name: name,
      email: email,
      phone: (document.getElementById('bc-phone') || {}).value || '',
      company_name: (document.getElementById('bc-company') || {}).value || '',
      message: (document.getElementById('bc-message') || {}).value || '',
      source_page: 'blog:' + window.location.pathname
    };
    var btn = document.getElementById('bc-submit');
    var msg = document.getElementById('bc-msg');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...'; }
    if (msg) msg.className = 'hidden';
    fetch('/api/agents/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function(r) {
        if (!r.ok) throw new Error('lead-submit failed');
        return r.json();
      })
      .then(function(res) {
        if (typeof window.trackAdsConversion === 'function') window.trackAdsConversion('lead', { value: 1.0, currency: 'USD' });
        if (msg) {
          msg.className = 'text-sm font-medium px-4 py-3 rounded-lg';
          msg.style.background = 'rgba(0,255,136,0.1)';
          msg.style.color = '#6ee7b7';
          msg.style.border = '1px solid rgba(0,255,136,0.2)';
          msg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>You\'re in! <a href="https://calendar.app.google/KNLFST4CNxViPPN3A" target="_blank" style="font-weight:700;text-decoration:underline">Book your free onboarding call</a> while we set up your account.';
        }
        var form = e.target;
        if (form) { Array.from(form.querySelectorAll('input,textarea')).forEach(function(el) { el.value = ''; }); }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rocket mr-2"></i>Get My Free Reports'; }
      })
      .catch(function() {
        if (msg) { msg.className = 'text-sm font-medium px-4 py-3 rounded-lg'; msg.style.background = 'rgba(239,68,68,0.1)'; msg.style.color = '#fca5a5'; msg.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>Network error. Please try again.'; }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rocket mr-2"></i>Get My Free Reports'; }
      });
  }

  window.shareBlog = function () {
    if (navigator.share) {
      navigator.share({ title: document.title, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href).then(function () {
        window.rmToast('Link copied to clipboard!', 'info');
      });
    }
  };

  function showNotFound() {
    var contentEl = document.getElementById('blog-post-content');
    if (contentEl) {
      contentEl.innerHTML =
        '<div class="text-center py-20">' +
          '<i class="fas fa-exclamation-triangle text-6xl text-gray-200 mb-6"></i>' +
          '<h2 class="text-2xl font-bold text-gray-600 mb-2">Article Not Found</h2>' +
          '<p class="text-gray-400 mb-6">The article you\'re looking for doesn\'t exist or has been removed.</p>' +
          '<a href="/blog" class="bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-8 rounded-lg inline-block transition-all"><i class="fas fa-arrow-left mr-2"></i>Back to Blog</a>' +
        '</div>';
    }
  }

  // ── PROSE STYLES (injected for blog content) ──
  function injectProseStyles() {
    var style = document.createElement('style');
    style.textContent = '' +
      '.blog-content { color: #d1d5db; line-height: 1.8; }' +
      '.blog-content h1 { font-size: 2em; font-weight: 800; margin: 1.5em 0 0.5em; color: #f3f4f6; }' +
      '.blog-content h2 { font-size: 1.5em; font-weight: 700; margin: 1.5em 0 0.5em; color: #f3f4f6; border-bottom: 2px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }' +
      '.blog-content h3 { font-size: 1.25em; font-weight: 700; margin: 1.3em 0 0.4em; color: #e5e7eb; }' +
      '.blog-content p { margin: 1em 0; }' +
      '.blog-content ul, .blog-content ol { margin: 1em 0; padding-left: 1.5em; }' +
      '.blog-content li { margin: 0.3em 0; }' +
      '.blog-content a { color: #00FF88; text-decoration: underline; }' +
      '.blog-content a:hover { color: #33ffaa; }' +
      '.blog-content blockquote { border-left: 4px solid #00FF88; background: rgba(0,255,136,0.05); padding: 1em 1.5em; margin: 1.5em 0; border-radius: 0 8px 8px 0; color: #a7f3d0; font-style: italic; }' +
      '.blog-content img { max-width: 100%; border-radius: 12px; margin: 1.5em 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }' +
      '.blog-content code { background: rgba(255,255,255,0.1); padding: 0.2em 0.5em; border-radius: 4px; font-size: 0.9em; color: #f472b6; }' +
      '.blog-content pre { background: #0a0a0a; color: #e5e7eb; padding: 1.5em; border-radius: 12px; overflow-x: auto; margin: 1.5em 0; border: 1px solid rgba(255,255,255,0.1); }' +
      '.blog-content pre code { background: none; color: inherit; padding: 0; }' +
      '.blog-content table { width: 100%; border-collapse: collapse; margin: 1.5em 0; }' +
      '.blog-content th, .blog-content td { border: 1px solid rgba(255,255,255,0.1); padding: 0.75em 1em; text-align: left; }' +
      '.blog-content th { background: rgba(255,255,255,0.05); font-weight: 700; color: #f3f4f6; }' +
      '.blog-content hr { border: none; border-top: 2px solid rgba(255,255,255,0.1); margin: 2em 0; }' +
      '.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }' +
      '.line-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }';
    document.head.appendChild(style);
  }

  // ── INIT ──
  injectProseStyles();
  if (isPostPage) {
    initPostPage();
  } else {
    initListingPage();
  }
})();
