// ===================== AUTH =====================
let authTab = 'login';
let _recoveryToken = null;
let _pkceCode = null;

// --- synchronous part: grabs tokens/codes from URL before ui.js reads it ---
(function grabRecoveryToken(){
  console.log('[recovery] hash:', window.location.hash || '(empty)');
  console.log('[recovery] search:', window.location.search || '(empty)');
  console.log('[recovery] full URL:', window.location.href);

  // Legacy format: #access_token=...&type=recovery
  const hash = new URLSearchParams(window.location.hash.substring(1));
  const hashToken = hash.get('access_token');
  const hashType  = hash.get('type');
  console.log('[recovery] type:', hashType, '| token:', hashToken ? 'present' : 'missing');
  if(hashType === 'recovery' && hashToken){
    _recoveryToken = hashToken;
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // PKCE format: ?code=XXXX
  const code = new URLSearchParams(window.location.search).get('code');
  console.log('[recovery] query code:', code ? 'present' : 'missing');
  if(code){
    _pkceCode = code;
    history.replaceState(null, '', window.location.pathname);
  }
})();

// --- async DOM part: called in DOMContentLoaded ---
async function initPasswordRecovery(){
  // Legacy hash-based recovery — show reset-screen directly
  if(_recoveryToken){
    const el = document.getElementById('reset-screen');
    console.log('[recovery] reset-screen element:', el);
    if(!el){ console.error('[recovery] #reset-screen not found in DOM!'); return; }
    document.getElementById('auth-screen').style.display = 'none';
    el.style.display = 'flex';
    return;
  }

  // PKCE code exchange
  console.log('[recovery] _pkceCode:', _pkceCode);
  console.log('[recovery] _recoveryToken:', _recoveryToken);
  if(!_pkceCode) return;
  console.log('[recovery] exchanging PKCE code...');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ auth_code: _pkceCode, code_verifier: '' })
    });
    const data = await res.json();
    console.log('[recovery] PKCE full response:', JSON.stringify(data));

    if(!res.ok || !data.access_token){
      console.error('[recovery] PKCE exchange failed:', data.error_description || data.msg || data);
      return;
    }

    const token = data.access_token;
    const user  = data.user || data.session?.user;
    const isRecovery = !!(user?.recovery_sent_at);
    console.log('[recovery] isRecovery:', isRecovery, '| recovery_sent_at:', user?.recovery_sent_at);

    if(isRecovery){
      _recoveryToken = token;
      _pkceCode = null;
      const el = document.getElementById('reset-screen');
      if(!el){ console.error('[recovery] #reset-screen not found!'); return; }
      document.getElementById('auth-screen').style.display = 'none';
      el.style.display = 'flex';
    } else {
      // Signup / magic link — log in normally
      if(!user?.id) return;
      currentToken = token;
      userId = user.id;
      userEmail = user.email;
      isGuest = false;
      await loadUserData();
      enterApp();
      loadFromSupabase();
    }
  } catch(e){
    console.error('[recovery] PKCE exchange error:', e);
  }
}

async function setNewPassword(){
  const pw1 = document.getElementById('new-password').value;
  const pw2 = document.getElementById('confirm-password').value;
  const errEl = document.getElementById('reset-screen-error');
  errEl.style.display = 'none';

  if(pw1.length < 6){ errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; return; }
  if(pw1 !== pw2){ errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + _recoveryToken
      },
      body: JSON.stringify({ password: pw1 })
    });
    if(res.ok){
      document.getElementById('reset-screen-form').style.display = 'none';
      document.getElementById('reset-screen-success').style.display = 'block';
      _recoveryToken = null;
    } else {
      const data = await res.json();
      errEl.textContent = data.error_description || data.msg || 'Failed to update password';
      errEl.style.display = 'block';
    }
  } catch(e){
    errEl.textContent = 'Connection error. Please try again.';
    errEl.style.display = 'block';
  }
}

function showAuthScreen(){
  document.getElementById('reset-screen').style.display = 'none';
  document.getElementById('reset-screen-form').style.display = 'block';
  document.getElementById('reset-screen-success').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

function switchAuthTab(t){
  authTab = t;
  document.querySelectorAll('.auth-tab').forEach((el,i)=>el.classList.toggle('active',['login','signup'][i]===t));
  document.getElementById('auth-submit-btn').textContent = t==='login' ? 'SIGN IN' : 'CREATE ACCOUNT';
  document.getElementById('auth-name-wrap').style.display = t==='signup' ? 'block' : 'none';
  document.getElementById('auth-error').style.display = 'none';
}

async function handleAuth(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';

  if(!email || !password){ showAuthError('Please enter email and password'); return; }

  // If no real Supabase configured, demo mode
  if(SUPABASE_URL === 'YOUR_SUPABASE_URL'){
    demoLogin(email);
    return;
  }

  try {
    let endpoint, bodyData;
    if(authTab === 'login'){
      endpoint = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
      bodyData = {email, password, options:{emailRedirectTo:'https://hw-collector.vercel.app'}};
    } else {
      endpoint = `${SUPABASE_URL}/auth/v1/signup`;
      bodyData = {email, password};
    }

    const res = await fetch(endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      },
      body: JSON.stringify(bodyData)
    });
    const data = await res.json();

    // Handle errors
    if(data.error || data.error_description || data.msg){
      showAuthError(data.error_description || data.msg || data.error || 'Authentication failed');
      return;
    }

    // New Supabase format
    const token = data.session?.access_token || data.access_token;
    const user = data.user || data.session?.user;
    if(!token || !user?.id){ showAuthError('Login failed. Please try again.'); return; }

    userId = user.id;
    userEmail = user.email || email;
    currentToken = token;
    isPremium = loadPremiumState(userId);
    await loadUserData();
    enterApp();
    // Load from cloud (non-blocking)
    loadFromSupabase();
  } catch(e){
    showAuthError('Connection error. Check your internet and try again.');
    console.error(e);
  }
}

function showAuthError(msg){
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = 'block';
}

function showForgotPassword(){
  document.getElementById('auth-login-view').style.display = 'none';
  document.getElementById('auth-reset-view').style.display = 'block';
  document.getElementById('auth-reset-success').style.display = 'none';
  document.getElementById('auth-reset-error').style.display = 'none';
  const prefill = document.getElementById('auth-email').value.trim();
  if(prefill) document.getElementById('reset-email').value = prefill;
}

function showLoginView(){
  document.getElementById('auth-login-view').style.display = 'block';
  document.getElementById('auth-reset-view').style.display = 'none';
  document.getElementById('auth-reset-success').style.display = 'none';
}

async function sendResetLink(){
  const email = document.getElementById('reset-email').value.trim();
  const errEl = document.getElementById('auth-reset-error');
  errEl.style.display = 'none';
  if(!email){ errEl.textContent = 'Please enter your email address'; errEl.style.display = 'block'; return; }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ email, redirectTo: 'https://hw-collector.vercel.app' })
    });
    if(res.ok){
      document.getElementById('auth-reset-view').style.display = 'none';
      document.getElementById('auth-reset-success').style.display = 'block';
    } else {
      const data = await res.json();
      errEl.textContent = data.error_description || data.msg || 'Failed to send reset link';
      errEl.style.display = 'block';
    }
  } catch(e){
    errEl.textContent = 'Connection error. Please try again.';
    errEl.style.display = 'block';
  }
}

function continueAsGuest(){
  isGuest = true;
  userId = 'guest';
  userEmail = 'Guest';
  isPremium = loadPremiumState('guest');
  loadLocalData();
  enterApp();
}

function demoLogin(email){
  userId = 'demo-' + email;
  userEmail = email;
  loadLocalData();
  enterApp();
}

function enterApp(){
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  if(!canAccessYear(currentYear)){
    currentYear = FREE_YEARS[0];
  }
  setListHeight();
  buildYearBar();
  populateSeries();
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  initPasswordRecovery();
  document.getElementById('reset-email').addEventListener('keydown', e => {
    if(e.key === 'Enter') sendResetLink();
  });
  document.getElementById('new-password').addEventListener('keydown', e => {
    if(e.key === 'Enter') document.getElementById('confirm-password').focus();
  });
  document.getElementById('confirm-password').addEventListener('keydown', e => {
    if(e.key === 'Enter') setNewPassword();
  });
});
