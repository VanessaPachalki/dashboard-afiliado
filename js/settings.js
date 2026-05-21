// ================================================
// SPACEHUB - Agency Settings (admin only)
// ================================================

const THEMES = [
  { color: '#E8551B', name: 'Vulcano', desc: 'Laranja' },
  { color: '#3B82F6', name: 'Oceano', desc: 'Azul' },
  { color: '#10B981', name: 'Floresta', desc: 'Verde' },
  { color: '#8B5CF6', name: 'Cosmos', desc: 'Roxo' },
  { color: '#EC4899', name: 'Neon', desc: 'Rosa' }
];

let currentAgency = null;

async function initSettings() {
  const agency = window.AGENCY;
  if (!agency?.id) {
    document.querySelector('.container').innerHTML =
      '<div class="callout" style="border-left-color:var(--red);">Acesse pelo subdominio da agencia.</div>';
    return;
  }

  // Load fresh agency data
  const { data } = await sb
    .from('agencies')
    .select('*')
    .eq('id', agency.id)
    .single();

  currentAgency = data;

  // Set name
  document.getElementById('agencyName').value = currentAgency.name;

  // Render themes
  renderThemes();

  // Load logo preview + size
  updateLogoPreview();
  document.getElementById('logoSize').value = currentAgency.logo_height || 32;
  document.getElementById('logoSizeLabel').textContent = (currentAgency.logo_height || 32) + 'px';

  // Update preview
  updatePreview();

  // Set active mode button
  updateModeButtons();
}

// ===== THEMES =====

function renderThemes() {
  const grid = document.getElementById('themeGrid');
  grid.innerHTML = THEMES.map(t => {
    const active = currentAgency.primary_color === t.color ? 'active' : '';
    return `<div class="theme-opt ${active}" data-color="${escAttr(t.color)}" onclick="selectTheme('${escAttr(t.color)}')">
      <div class="theme-dot" style="background:${escAttr(t.color)};"></div>
      <div class="theme-name">${esc(t.name)}</div>
      <div class="theme-hex">${esc(t.desc)}</div>
    </div>`;
  }).join('');
}

async function selectTheme(color) {
  const msg = document.getElementById('themeMsg');

  // Optimistic: update UI immediately
  currentAgency.primary_color = color;
  renderThemes();
  updatePreview();
  window.AGENCY.primary_color = color;
  applyBranding(window.AGENCY);

  msg.className = 'msg msg-ok';
  msg.textContent = 'Tema atualizado!';

  // Clear tenant cache so next page load picks up the new color
  const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
  sessionStorage.removeItem(cacheKey);

  const { error } = await sb
    .from('agencies')
    .update({ primary_color: color, updated_at: new Date().toISOString() })
    .eq('id', currentAgency.id);

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro ao salvar: ' + error.message;
  }
}

// ===== NAME =====

async function saveName() {
  const name = document.getElementById('agencyName').value.trim();
  const msg = document.getElementById('nameMsg');

  if (!name) { msg.className = 'msg msg-err'; msg.textContent = 'Digite um nome.'; return; }

  currentAgency.name = name;
  updatePreview();
  msg.className = 'msg msg-ok';
  msg.textContent = 'Nome atualizado!';

  const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
  sessionStorage.removeItem(cacheKey);

  const { error } = await sb
    .from('agencies')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', currentAgency.id);

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro ao salvar: ' + error.message;
  }
}

// ===== LOGO =====

async function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const msg = document.getElementById('logoMsg');

  // Validate
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Formato invalido. Use PNG, JPG ou WebP.';
    return;
  }
  if (file.size > 200 * 1024) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Arquivo muito grande. Max 200KB.';
    return;
  }

  msg.className = 'msg';
  msg.textContent = 'Enviando...';

  // Convert to base64 data URL (stored directly in DB — no storage needed)
  const reader = new FileReader();
  reader.onload = async function(e) {
    const logoUrl = e.target.result; // data:image/png;base64,...

    const { error: saveErr } = await sb
      .from('agencies')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', currentAgency.id);

    if (saveErr) {
      msg.className = 'msg msg-err';
      msg.textContent = 'Erro ao salvar: ' + saveErr.message;
      return;
    }

    currentAgency.logo_url = logoUrl;
    updateLogoPreview();
    updatePreview();
    window.AGENCY.logo_url = logoUrl;
    applyBranding(window.AGENCY);

    const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
    sessionStorage.removeItem(cacheKey);

    msg.className = 'msg msg-ok';
    msg.textContent = 'Logo atualizada!';
    input.value = '';
  };
  reader.readAsDataURL(file);
}

async function removeLogo() {
  if (!currentAgency.logo_url) return;
  if (!confirm('Remover a logo?')) return;

  const msg = document.getElementById('logoMsg');

  const { error } = await sb
    .from('agencies')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', currentAgency.id);

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }

  currentAgency.logo_url = null;
  updateLogoPreview();
  updatePreview();
  window.AGENCY.logo_url = null;
  applyBranding(window.AGENCY);

  const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
  sessionStorage.removeItem(cacheKey);

  msg.className = 'msg msg-ok';
  msg.textContent = 'Logo removida.';
}

function updateLogoPreview() {
  const preview = document.getElementById('logoPreview');
  const placeholder = document.getElementById('logoPlaceholder');

  if (currentAgency?.logo_url) {
    const img = preview.querySelector('img') || document.createElement('img');
    img.src = currentAgency.logo_url;
    img.alt = currentAgency.name;
    img.onerror = function() {
      this.remove();
      placeholder.style.display = '';
    };
    if (!preview.querySelector('img')) preview.appendChild(img);
    placeholder.style.display = 'none';
  } else {
    const img = preview.querySelector('img');
    if (img) img.remove();
    placeholder.style.display = '';
  }
}

// ===== PREVIEW =====

function updatePreview() {
  const topbar = document.getElementById('previewTopbar');
  const color = currentAgency?.primary_color || '#E8551B';

  topbar.innerHTML = '';
  if (currentAgency?.logo_url) {
    const img = document.createElement('img');
    img.src = currentAgency.logo_url;
    const previewH = currentAgency.logo_height || 32;
    img.style.cssText = 'height:'+previewH+'px;border-radius:4px;';
    img.onerror = function() { this.style.display = 'none'; };
    topbar.appendChild(img);
  }
  const span = document.createElement('span');
  span.className = 'brand-text';
  span.style.color = color;
  span.textContent = currentAgency?.logo_url ? '' : (currentAgency?.name || 'SPACEHUB');
  if (span.textContent) topbar.appendChild(span);

  // Update KPI accent color
  document.querySelectorAll('.preview-card .kpi-v').forEach((el, i) => {
    if (i === 0) el.style.color = color;
  });
}

// ===== APPEARANCE MODE =====

function setMode(mode) {
  applyThemeMode(mode);
  updateModeButtons();
}

function updateModeButtons() {
  const current = getThemeMode();
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === current;
    btn.style.background = isActive ? 'var(--orange)' : 'transparent';
    btn.style.color = isActive ? '#fff' : 'var(--muted)';
    btn.style.border = isActive ? 'none' : '1px solid var(--border)';
  });
}

// ===== LOGO SIZE =====

function previewLogoSize(val) {
  document.getElementById('logoSizeLabel').textContent = val + 'px';
  // Update topbar logo live
  document.querySelectorAll('.brand img').forEach(img => { img.style.height = val + 'px'; });
  // Update preview
  const previewImg = document.querySelector('#previewTopbar img');
  if (previewImg) previewImg.style.height = val + 'px';
}

async function saveLogoSize(val) {
  const size = parseInt(val);
  currentAgency.logo_height = size;
  window.AGENCY.logo_height = size;

  const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
  sessionStorage.removeItem(cacheKey);

  await sb
    .from('agencies')
    .update({ logo_height: size, updated_at: new Date().toISOString() })
    .eq('id', currentAgency.id);
}
