// ===================== ADMIN CONFIG =====================
// SUPABASE_URL and SUPABASE_KEY are defined in js/config.js

let adminToken = null;
let adminId = null;
let allUsersCache = [];

// ===== AUTH =====
async function adminLogin(){
  const email = document.getElementById('adm-email').value.trim();
  const pass = document.getElementById('adm-pass').value;
  const errEl = document.getElementById('auth-err');
  errEl.style.display = 'none';

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY},
      body:JSON.stringify({email, password:pass})
    });
    const data = await res.json();
    // Handle both old and new Supabase response formats
    const token = data.access_token || data.session?.access_token;
    const user = data.user || (data.session && data.session.user);

    if(!token || !user){
      errEl.textContent = data.error_description || data.msg || 'Login failed';
      errEl.style.display='block'; return;
    }

    // Check if admin - use token directly
    const profileRes = await fetch(SUPABASE_URL+'/rest/v1/profiles?id=eq.'+user.id+'&select=is_admin,email', {
      headers:{
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer '+token,
        'Content-Type': 'application/json'
      }
    });
    const profile = await profileRes.json();

    if(!profile || !profile.length || !profile[0].is_admin){
      errEl.textContent = 'Access denied. Admin only. (profile: '+JSON.stringify(profile)+')';
      errEl.style.display='block'; return;
    }

    adminToken = token;
    adminId = data.user.id;
    document.getElementById('adm-user-label').textContent = email;
    document.getElementById('auth-wrap').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadDashboard();
  } catch(e){
    errEl.textContent = 'Connection error'; errEl.style.display='block';
  }
}

function adminSignOut(){
  adminToken = null; adminId = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-wrap').style.display = 'flex';
}

// ===== SUPABASE =====
async function sbFetch(path, token, method='GET', body=null){
  const usedToken = token || adminToken;
  const opts = {
    method,
    headers:{
      'apikey':SUPABASE_KEY,
      'Authorization':'Bearer '+usedToken,
      'Content-Type':'application/json',
      'Prefer': method==='POST'?'return=representation':method==='PATCH'?'return=minimal':''
    }
  };
  if(body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
    console.log(`[sbFetch] ${method} /${path} → HTTP ${res.status} | token: ${usedToken ? usedToken.slice(0,20)+'…' : 'MISSING'}`);
    if(!res.ok){
      const err = await res.text();
      console.warn('Admin API error:', path, res.status, err);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch(e){
    console.warn('Admin fetch error:', e);
    return null;
  }
}

// ===== NAVIGATION =====
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  event.currentTarget.classList.add('active');
  if(name==='dashboard') loadDashboard();
  if(name==='users') loadUsers();
  if(name==='premium') loadPremium();
  if(name==='database') filterDB();
  if(name==='popular') loadPopular();
  if(name==='logs') loadLogs();
}

// ===== DASHBOARD =====
async function loadDashboard(){
  // Load stats
  const [profiles, collection, wishlist, logs] = await Promise.all([
    sbFetch('profiles?select=is_premium,last_seen_at,created_at'),
    sbFetch('collection?select=id'),
    sbFetch('wishlist?select=id'),
    sbFetch('app_logs?select=event_type,created_at&order=created_at.desc&limit=5')
  ]);

  const total = profiles?.length || 0;
  const premium = profiles?.filter(p=>p.is_premium).length || 0;
  const week = profiles?.filter(p=>new Date(p.last_seen_at)>new Date(Date.now()-7*864e5)).length || 0;
  const newWeek = profiles?.filter(p=>new Date(p.created_at)>new Date(Date.now()-7*864e5)).length || 0;

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card stat-blue"><div class="stat-label">Total Users</div><div class="stat-value">${total}</div><div class="stat-sub">+${newWeek} this week</div></div>
    <div class="stat-card stat-yellow"><div class="stat-label">Premium</div><div class="stat-value">${premium}</div><div class="stat-sub">${total?Math.round(premium/total*100):0}% conversion</div></div>
    <div class="stat-card stat-green"><div class="stat-label">Active 7d</div><div class="stat-value">${week}</div><div class="stat-sub">of ${total} total</div></div>
    <div class="stat-card stat-red"><div class="stat-label">Cars Owned</div><div class="stat-value">${collection?.length||0}</div><div class="stat-sub">${wishlist?.length||0} wishlisted</div></div>
  `;

  // Popular chart
  await loadPopularChart();

  // Recent logs
  const logsEl = document.getElementById('recent-logs');
  if(!logs || !logs.length){ logsEl.innerHTML='<div class="loading">No logs yet</div>'; return; }
  logsEl.innerHTML = logs.map(l=>logRow(l)).join('');
}

async function loadPopularChart(){
  const data = await sbFetch('collection?select=year,car_id&limit=1000');
  if(!data || !data.length){ document.getElementById('popular-chart').innerHTML='<div class="loading">No data</div>'; return; }

  const counts = {};
  data.forEach(r=>{ const k=r.year+'_'+r.car_id; counts[k]=(counts[k]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const max = sorted[0]?.[1]||1;

  const html = sorted.map(([key,count])=>{
    const [year,carId] = key.split('_');
    const carData = getCarById(parseInt(year), parseInt(carId));
    const name = carData ? carData.name : `Car #${carId} (${year})`;
    const pct = Math.round(count/max*100);
    return `<div class="chart-bar-row">
      <div class="chart-bar-label" title="${name} (${year})">${name}</div>
      <div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%"><span class="chart-bar-val">${count}</span></div></div>
    </div>`;
  }).join('');

  document.getElementById('popular-chart').innerHTML = `<div class="chart-bar-wrap">${html}</div>`;
}

// ===== USERS =====
async function loadUsers(){
  document.getElementById('users-table').innerHTML = '<div class="loading">Loading users...</div>';

  // Diagnostic: check how many rows RLS allows us to see
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id`, {
    headers:{
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + adminToken,
      'Prefer': 'count=exact',
      'Range-Unit': 'items',
      'Range': '0-0'
    }
  });
  const contentRange = countRes.headers.get('content-range');
  console.log('[loadUsers] RLS count check — Content-Range:', contentRange, '(format: from-to/total, total=rows visible to this token)');

  let profiles = await sbFetch('profiles?select=id,email,display_name,is_premium,is_admin,created_at,last_seen_at&order=created_at.desc&limit=500');
  if(profiles === null){
    document.getElementById('users-table').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div>Failed to load users. Check console for details.</div>';
    return;
  }

  // Fallback: find user_ids that appear in activity tables but have no profile row
  // (happens when handle_new_user() trigger is missing or failed)
  const profileIds = new Set((profiles||[]).map(p => p.id));
  const [colRows, wishRows, logRows] = await Promise.all([
    sbFetch('collection?select=user_id&limit=2000'),
    sbFetch('wishlist?select=user_id&limit=2000'),
    sbFetch('app_logs?select=user_id&limit=2000')
  ]);
  const allActivityIds = [
    ...(colRows||[]).map(r => r.user_id),
    ...(wishRows||[]).map(r => r.user_id),
    ...(logRows||[]).map(r => r.user_id)
  ].filter(Boolean);
  const missingIds = [...new Set(allActivityIds.filter(id => !profileIds.has(id)))];

  if(missingIds.length > 0){
    console.log('[loadUsers] Creating stub profiles for', missingIds.length, 'users missing from profiles:', missingIds);
    let created = 0;
    for(const id of missingIds){
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + adminToken,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal,resolution=ignore-duplicates'
          },
          body: JSON.stringify({id, is_premium: false, is_admin: false})
        });
        if(r.ok) created++;
      } catch(e){ console.warn('[loadUsers] Failed to create stub profile for', id, e); }
    }
    if(created > 0){
      toast(`Created ${created} missing profile(s) — emails visible after next login`);
      profiles = await sbFetch('profiles?select=id,email,display_name,is_premium,is_admin,created_at,last_seen_at&order=created_at.desc&limit=500') || profiles;
    }
  }

  console.log('[loadUsers] raw response:', JSON.stringify(profiles, null, 2));
  allUsersCache = profiles;
  renderUsersTable(allUsersCache);
}

function renderUsersTable(users){
  if(!users.length){ document.getElementById('users-table').innerHTML='<div class="empty-state"><div class="empty-icon">👥</div>No users found</div>'; return; }
  document.getElementById('users-table').innerHTML = `
    <table>
      <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Joined</th><th>Last seen</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`
        <tr>
          <td>${u.email||'—'}</td>
          <td>${u.display_name||'—'}</td>
          <td>
            ${u.is_admin?'<span class="badge badge-admin">Admin</span> ':''}
            ${u.is_premium?'<span class="badge badge-premium">Premium</span>':'<span class="badge badge-free">Free</span>'}
          </td>
          <td>${fmtDate(u.created_at)}</td>
          <td>${fmtDate(u.last_seen_at)}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">
            ${u.is_premium
              ? `<button class="btn-sm danger" onclick="setPremium('${u.id}',false)">Revoke</button>`
              : `<button class="btn-sm success" onclick="setPremium('${u.id}',true)">Grant ⭐</button>`
            }
            ${SUPABASE_SERVICE_KEY
              ? `<button class="btn-sm" onclick="resetUserPassword('${u.id}','${(u.email||'').replace(/'/g,"\\'")}')">Reset PWD</button>`
              : `<button class="btn-sm" disabled title="Service key not configured — ustaw w js/config.local.js">Reset PWD</button>`
            }
            <button class="btn-sm danger" onclick="deleteUser('${u.id}','${u.email}')">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function filterUsers(q){
  const filtered = allUsersCache.filter(u=>(u.email||'').toLowerCase().includes(q.toLowerCase())||(u.display_name||'').toLowerCase().includes(q.toLowerCase()));
  renderUsersTable(filtered);
}

async function setPremium(userId, value){
  const res = await sbFetch(`profiles?id=eq.${userId}`, adminToken, 'PATCH', {
    is_premium: value,
    premium_granted_at: value ? new Date().toISOString() : null
  });
  toast(value ? '⭐ Premium granted!' : 'Premium revoked');
  loadUsers();
  if(document.getElementById('page-premium').classList.contains('active')) loadPremium();
}

async function grantPremiumByEmail(){
  const email = prompt('Enter user email to grant Premium:');
  if(!email) return;
  const users = await sbFetch(`profiles?email=eq.${encodeURIComponent(email)}&select=id,email`);
  if(!users || !users.length){ toast('User not found'); return; }
  await setPremium(users[0].id, true);
}

async function deleteUser(userId, email){
  if(!confirm(`Delete user ${email}?\nThis will remove all their data permanently.`)) return;
  await sbFetch(`profiles?id=eq.${userId}`, adminToken, 'DELETE');
  toast('User deleted');
  loadUsers();
}

async function resetUserPassword(userId, email){
  if(!SUPABASE_SERVICE_KEY){
    toast('⚠️ Ustaw SUPABASE_SERVICE_KEY w js/config.js');
    return;
  }
  if(!confirm(`Reset hasła dla ${email||userId}?\nNowe hasło tymczasowe: TempPassword123!`)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: 'TempPassword123!' })
    });
    if(!res.ok){
      const err = await res.text();
      console.warn('[resetUserPassword] error:', res.status, err);
      toast('Błąd resetu hasła — sprawdź konsolę');
      return;
    }
    toast('Password reset to: TempPassword123!');
  } catch(e){
    console.warn('[resetUserPassword] exception:', e);
    toast('Błąd połączenia przy resecie hasła');
  }
}

// ===== PREMIUM =====
async function loadPremium(){
  const data = await sbFetch('profiles?is_premium=eq.true&select=email,display_name,premium_granted_at,id&order=premium_granted_at.desc');
  if(!data || !data.length){
    document.getElementById('premium-table').innerHTML='<div class="empty-state"><div class="empty-icon">⭐</div>No premium users yet</div>';
    return;
  }
  document.getElementById('premium-table').innerHTML = `
    <table>
      <thead><tr><th>Email</th><th>Name</th><th>Granted</th><th>Actions</th></tr></thead>
      <tbody>${data.map(u=>`
        <tr>
          <td>${u.email||'—'}</td>
          <td>${u.display_name||'—'}</td>
          <td>${fmtDate(u.premium_granted_at)}</td>
          <td><button class="btn-sm danger" onclick="setPremium('${u.id}',false)">Revoke</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ===== CAR DATABASE =====
function getCarById(year, id){
  return (HWDATA[year]||[]).find(c=>c.id===id);
}

function filterDB(){
  const year = parseInt(document.getElementById('db-year-filter').value);
  const q = (document.getElementById('db-search')?.value||'').toLowerCase();
  const data = (HWDATA[year]||[]).filter(c=>
    !q || c.name.toLowerCase().includes(q) || c.toy.toLowerCase().includes(q) ||
    c.series.toLowerCase().includes(q) || String(c.col).includes(q)
  );
  renderDBTable(data, year);
}

function renderDBTable(data, year){
  if(!data.length){ document.getElementById('db-table').innerHTML='<div class="empty-state"><div class="empty-icon">🚗</div>No results</div>'; return; }
  document.getElementById('db-table').innerHTML = `
    <table>
      <thead><tr><th>Col#</th><th>Toy#</th><th>Name</th><th>Series</th><th>Series#</th><th>Tags</th><th>Edit</th></tr></thead>
      <tbody>${data.slice(0,100).map(c=>`
        <tr id="row-${year}-${c.id}">
          <td><strong>${String(c.col).padStart(3,'0')}</strong></td>
          <td style="font-family:monospace;font-size:11px">${c.toy||'—'}</td>
          <td>${c.name}${c.note?`<span style="color:var(--text2);font-size:11px"> · ${c.note}</span>`:''}</td>
          <td><span style="font-size:11px">${c.series}</span></td>
          <td style="color:var(--text2)">${c.seriesNum||'—'}</td>
          <td style="font-size:11px;color:var(--text2)">${c.tags||'—'}</td>
          <td><button class="btn-sm" onclick="editCar(${year},${c.id})">Edit</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${data.length>100?`<div style="padding:12px 20px;font-size:12px;color:var(--text2)">Showing 100 of ${data.length} results. Refine search to see more.</div>`:''}`;
}

function editCar(year, id){
  const car = getCarById(year, id);
  if(!car) return;
  const newName = prompt(`Edit name for Col# ${String(car.col).padStart(3,'0')}:`, car.name);
  if(newName === null) return;
  const newTags = prompt('Edit tags:', car.tags||'');
  if(newTags === null) return;
  // Update in memory
  car.name = newName.trim();
  car.tags = newTags.trim();
  // Note: in production, this would also save to a Supabase edits table
  filterDB();
  toast('✓ Car updated (local only — connect edits table to persist)');
}

// ===== POPULAR =====
async function loadPopular(year=''){
  document.getElementById('popular-table').innerHTML = '<div class="loading">Loading...</div>';
  const filter = year ? `&year=eq.${year}` : '';
  const data = await sbFetch(`collection?select=year,car_id${filter}&limit=2000`);
  if(!data || !data.length){
    document.getElementById('popular-table').innerHTML='<div class="empty-state"><div class="empty-icon">🏆</div>No data yet</div>'; return;
  }
  const counts = {};
  data.forEach(r=>{ const k=r.year+'_'+r.car_id; counts[k]=(counts[k]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,50);
  document.getElementById('popular-table').innerHTML = `
    <table>
      <thead><tr><th>Rank</th><th>Car</th><th>Year</th><th>Col#</th><th>Collectors</th></tr></thead>
      <tbody>${sorted.map(([key,count],i)=>{
        const [yr,carId] = key.split('_');
        const car = getCarById(parseInt(yr), parseInt(carId));
        return `<tr>
          <td><strong>#${i+1}</strong></td>
          <td>${car?car.name:`Car #${carId}`}</td>
          <td>${yr}</td>
          <td>${car?String(car.col).padStart(3,'0'):'—'}</td>
          <td><span class="badge badge-green">${count}</span></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

// ===== LOGS =====
async function loadLogs(type=''){
  document.getElementById('logs-list').innerHTML = '<div class="loading">Loading...</div>';
  const filter = type ? `&event_type=eq.${type}` : '';
  const data = await sbFetch(`app_logs?select=event_type,event_data,created_at,user_id&order=created_at.desc&limit=100${filter}`);
  if(!data || !data.length){
    document.getElementById('logs-list').innerHTML='<div class="empty-state"><div class="empty-icon">📋</div>No logs yet</div>'; return;
  }
  document.getElementById('logs-list').innerHTML = data.map(l=>logRow(l)).join('');
}

function logRow(l){
  const typeClass = {'signup':'log-signup','login':'log-login','premium_upgrade':'log-premium','error':'log-error','search':'log-search'}[l.event_type]||'';
  const meta = l.event_data ? Object.entries(l.event_data).map(([k,v])=>`${k}: ${v}`).join(' · ') : '';
  return `<div class="log-item">
    <span class="log-type ${typeClass}">${l.event_type||'event'}</span>
    <span class="log-meta">${meta||'—'}</span>
    <span class="log-time">${fmtDate(l.created_at)}</span>
  </div>`;
}

// ===== EXPORT =====
function exportAllUsers(){ exportUsers(); }

async function exportUsers(){
  const data = await sbFetch('profiles?select=email,display_name,is_premium,is_admin,created_at,last_seen_at&order=created_at.desc');
  if(!data) return;
  csvDownload('hw_users.csv',
    ['Email','Name','Premium','Admin','Joined','Last Seen'],
    data.map(u=>[u.email,u.display_name,u.is_premium?'Yes':'No',u.is_admin?'Yes':'No',fmtDate(u.created_at),fmtDate(u.last_seen_at)])
  );
  toast('Users exported!');
}

async function exportCollections(){
  const data = await sbFetch('collection?select=user_id,year,car_id,owned_at&order=owned_at.desc&limit=10000');
  if(!data) return;
  csvDownload('hw_collections.csv',
    ['User ID','Year','Car ID','Owned At'],
    data.map(r=>[r.user_id,r.year,r.car_id,fmtDate(r.owned_at)])
  );
  toast('Collections exported!');
}

async function exportLogs(){
  const data = await sbFetch('app_logs?select=event_type,event_data,created_at,user_id&order=created_at.desc&limit=5000');
  if(!data) return;
  csvDownload('hw_logs.csv',
    ['Event','Data','User ID','Time'],
    data.map(l=>[l.event_type,JSON.stringify(l.event_data),l.user_id,fmtDate(l.created_at)])
  );
  toast('Logs exported!');
}

function exportDatabase(){
  const rows = [['Year','Col#','Toy#','Name','Variant','Series','Series#','Tags']];
  [2023,2024,2025,2026].forEach(y=>{
    (HWDATA[y]||[]).forEach(c=>{
      rows.push([y,String(c.col).padStart(3,'0'),c.toy||'',c.name,c.note||'',c.series,c.seriesNum||'',c.tags||'']);
    });
  });
  csvDownload('hw_database.csv', rows[0], rows.slice(1));
  toast('Database exported!');
}

// ===== HELPERS =====
function csvDownload(filename, headers, rows){
  const escape = v => `"${String(v||'').replace(/"/g,'""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r=>r.map(escape).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = filename; a.click();
}

function fmtDate(d){
  if(!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2500);
}

// Enter key login
document.getElementById('adm-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') adminLogin(); });
