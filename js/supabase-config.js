// ================================================
// SPACEHUB - Supabase Config
// Substitua pelos valores do seu projeto Supabase
// ================================================

const SUPABASE_URL = 'https://lensqybwnsezlacwutgg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlbnNxeWJ3bnNlemxhY3d1dGdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDAzOTQsImV4cCI6MjA5NDM3NjM5NH0.HmXVDaViLx7vDQQltFqH3WiIrn37D6OFPZ4NvqpWDKU';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
