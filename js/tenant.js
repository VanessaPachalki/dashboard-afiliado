// ================================================
// SPACEHUB - Tenant Resolution & Branding
// Este arquivo DEVE ser carregado ANTES de qualquer outro JS.
// ================================================

// --- Marca única (BRX). Sem whitelabel/subdomínio. ---
window.__TENANT_SLUG = 'brx';
window.AGENCY = null;

// --- Resolve a marca fixa (BRX) com cache ---

const TENANT_CACHE_KEY = 'brx_tenant';
const TENANT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BRX_FALLBACK = { id: null, slug: 'brx', name: 'BRX', primary_color: '#8B5CF6', logo_url: null };

async function resolveTenant() {
  // Cache
  const cached = sessionStorage.getItem(TENANT_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed._ts && Date.now() - parsed._ts < TENANT_CACHE_TTL) {
        window.AGENCY = parsed;
        applyBranding(window.AGENCY);
        return window.AGENCY;
      }
    } catch (e) { /* cache corrompido, ignora */ }
  }

  // Busca a linha fixa da marca BRX
  const url = SUPABASE_URL + '/rest/v1/agencies?slug=eq.brx&select=id,slug,name,primary_color,logo_url,logo_height&limit=1';
  try {
    const resp = await fetch(url, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Accept': 'application/json' }
    });
    const data = await resp.json();
    const agency = (data && data[0]) ? data[0] : { ...BRX_FALLBACK };
    agency._ts = Date.now();
    window.AGENCY = agency;
    sessionStorage.setItem(TENANT_CACHE_KEY, JSON.stringify(agency));
    applyBranding(agency);
    return agency;
  } catch (err) {
    console.error('Branding resolution failed:', err);
    window.AGENCY = { ...BRX_FALLBACK };
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
  return localStorage.getItem('spacehub_theme_mode') || 'light';
}

// Apply on load (synchronous — always set attribute explicitly)
(function() {
  var mode = localStorage.getItem('spacehub_theme_mode') || 'light';
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
