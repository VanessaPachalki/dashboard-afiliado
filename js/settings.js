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

  // Load logo preview
  updateLogoPreview();

  // Update preview
  updatePreview();
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
  applyBranding({ ...window.AGENCY, primary_color: color });

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

  // Upload to Supabase Storage
  const ext = file.name.split('.').pop();
  const path = `agency-logos/${currentAgency.id}/logo.${ext}`;

  const { error: upErr } = await sb.storage
    .from('xlsx-uploads')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro no upload: ' + upErr.message;
    return;
  }

  // Get public URL
  const { data: urlData } = sb.storage.from('xlsx-uploads').getPublicUrl(path);
  const logoUrl = urlData.publicUrl + '?t=' + Date.now();

  // Save to agencies
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
  applyBranding({ ...window.AGENCY, logo_url: logoUrl, name: currentAgency.name });

  const cacheKey = 'spacehub_tenant_' + window.__TENANT_SLUG;
  sessionStorage.removeItem(cacheKey);

  msg.className = 'msg msg-ok';
  msg.textContent = 'Logo atualizada!';
  input.value = '';
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
  applyBranding({ ...window.AGENCY, logo_url: null, name: currentAgency.name });

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
    img.style.cssText = 'height:24px;border-radius:4px;';
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
