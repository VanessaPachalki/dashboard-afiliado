// ================================================
// SPACEHUB - Supabase Config
// Substitua pelos valores do seu projeto Supabase
// ================================================

const SUPABASE_URL = 'https://lensqybwnsezlacwutgg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlbnNxeWJ3bnNlemxhY3d1dGdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDAzOTQsImV4cCI6MjA5NDM3NjM5NH0.HmXVDaViLx7vDQQltFqH3WiIrn37D6OFPZ4NvqpWDKU';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Security: escape HTML and attribute values to prevent XSS
function esc(s) {
  const el = document.createElement('span');
  el.textContent = String(s ?? '');
  return el.innerHTML;
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
