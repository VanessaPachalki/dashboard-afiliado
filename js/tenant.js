// ================================================
// SPACEHUB - Tenant Resolution & Branding
// Este arquivo DEVE ser carregado ANTES de qualquer outro JS.
// ================================================

// --- Step 1: Extract slug from subdomain (synchronous) ---
(function() {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');

  let slug = null;

  // Production: agencia.spacehub-ai.com
  if (parts.length >= 3) {
    const domain = parts.slice(-2).join('.');
    if (domain === 'spacehub-ai.com') {
      slug = parts[0];
    }
  }

  // Reserved slugs → treat as no tenant (superadmin portal)
  const RESERVED = ['www', 'app', 'api', 'admin', 'test', 'staging', 'mail', 'ftp', 'static', 'assets'];
  if (slug && RESERVED.includes(slug)) slug = null;

  // Dev fallback: localhost?agency=slug
  if (!slug && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    slug = new URLSearchParams(window.location.search).get('agency');
  }

  window.__TENANT_SLUG = slug;
  window.__IS_SUPERADMIN_PORTAL = !slug;
  window.AGENCY = null;
})();

// --- Step 2: Resolve agency config (async, with cache) ---

const TENANT_CACHE_KEY = 'spacehub_tenant_';
const TENANT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function resolveTenant() {
  const slug = window.__TENANT_SLUG;

  // No slug → superadmin portal, use SPACEHUB defaults
  if (!slug) {
    window.AGENCY = {
      id: null,
      slug: null,
      name: 'SPACEHUB',
      primary_color: '#E8551B',
      logo_url: null,
      plan: 'pro',
      is_superadmin_portal: true
    };
    applyBranding(window.AGENCY);
    return window.AGENCY;
  }

  // Check sessionStorage cache
  const cacheKey = TENANT_CACHE_KEY + slug;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed._ts && Date.now() - parsed._ts < TENANT_CACHE_TTL) {
        window.AGENCY = parsed;
        applyBranding(window.AGENCY);
        return window.AGENCY;
      }
    } catch (e) { /* cache corrupted, ignore */ }
  }

  // Fetch from Supabase (direct query — fast, no edge function needed)
  // sb may not be available yet, so we use fetch directly
  const url = SUPABASE_URL + '/rest/v1/agencies?slug=eq.' + encodeURIComponent(slug) + '&is_active=eq.true&select=id,slug,name,primary_color,logo_url,logo_height,plan&limit=1';
  try {
    const resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Accept': 'application/json'
      }
    });
    const data = await resp.json();

    if (!data || !data.length) {
      // Agency not found → redirect to main site
      window.location.href = 'https://spacehub-ai.com';
      return null;
    }

    const agency = data[0];
    agency._ts = Date.now();
    agency.is_superadmin_portal = false;
    window.AGENCY = agency;

    // Cache it
    sessionStorage.setItem(cacheKey, JSON.stringify(agency));

    applyBranding(agency);
    return agency;

  } catch (err) {
    console.error('Tenant resolution failed:', err);
    // Fallback: use SPACEHUB defaults so the page doesn't break
    window.AGENCY = {
      id: null, slug: slug, name: 'SPACEHUB',
      primary_color: '#E8551B', logo_url: null, plan: 'starter',
      is_superadmin_portal: false
    };
    applyBranding(window.AGENCY);
    return window.AGENCY;
  }
}

// --- Step 3: Apply branding (CSS variables + DOM) ---

function applyBranding(agency) {
  const root = document.documentElement;

  // Override primary color (always apply — even default, in case switching back)
  if (agency.primary_color) {
    root.style.setProperty('--orange', agency.primary_color);
    root.style.setProperty('--orange-soft', agency.primary_color + '30');
  }

  // Set global brand color for Chart.js and other JS
  window.BRAND_COLOR = agency.primary_color || '#E8551B';
  window.BRAND_COLOR_ALPHA = (agency.primary_color || '#E8551B') + '30';

  // Replace brand in topbar and login
  document.querySelectorAll('.brand').forEach(el => {
    const small = el.querySelector('small');
    const smallText = small ? small.textContent : '';

    el.textContent = '';
    if (agency.logo_url) {
      // Logo replaces text entirely
      const img = document.createElement('img');
      img.src = agency.logo_url;
      img.alt = agency.name;
      const logoH = agency.logo_height || 32;
      img.style.cssText = 'height:'+logoH+'px;vertical-align:middle;border-radius:4px;';
      img.onerror = function() {
        this.style.display = 'none';
        this.parentElement.appendChild(document.createTextNode(agency.name + ' '));
      };
      el.appendChild(img);
    } else {
      el.appendChild(document.createTextNode(agency.name + ' '));
    }
    if (smallText) {
      const s = document.createElement('small');
      s.textContent = smallText;
      el.appendChild(s);
    }
  });

  // Update page title
  document.title = document.title.replace('SPACEHUB', agency.name);

  // Show body (was hidden to prevent FOUC)
  document.body.style.visibility = 'visible';
}

// --- Step 4: Theme mode (dark/light/auto) ---

function resolveMode(mode) {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function applyThemeMode(mode) {
  localStorage.setItem('spacehub_theme_mode', mode);
  document.documentElement.setAttribute('data-theme', resolveMode(mode));
}

function getThemeMode() {
  return localStorage.getItem('spacehub_theme_mode') || 'dark';
}

// Apply on load (synchronous — always set attribute explicitly)
(function() {
  var mode = localStorage.getItem('spacehub_theme_mode') || 'dark';
  var resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
})();

// Listen for system theme changes when in auto mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
  if (getThemeMode() === 'auto') applyThemeMode('auto');
});

// --- Helper: get current agency ID (used by all queries) ---

function agencyId() {
  return window.AGENCY?.id || null;
}
