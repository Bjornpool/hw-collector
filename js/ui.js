// ===================== DETAIL =====================
function openDetail(id){
  const data = getYearData(currentYear);
  currentCar = data ? data.find(c=>c.id===id) : null;
  if(!currentCar) return;
  const car = currentCar;
  const isOwned = owned[currentYear].has(car.id);
  const isWished = wished[currentYear].has(car.id);

  document.getElementById('detail-name').textContent = car.name + (car.note ? ` · ${car.note}` : '');
  const tags = getTags(car);
  document.getElementById('detail-meta').innerHTML =
    `<span class="series-badge ${sc(car.series)}" style="font-size:11px;padding:3px 8px">${car.series}</span>` +
    tags.map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join('');

  document.getElementById('detail-rows').innerHTML = `
    ${car.toy?`<div class="detail-row"><span class="detail-row-label">Toy #</span><span class="detail-row-val">${car.toy}</span></div>`:''}
    <div class="detail-row"><span class="detail-row-label">Col. #</span><span class="detail-row-val">${String(car.col).padStart(3,'0')}</span></div>
    ${car.seriesNum?`<div class="detail-row"><span class="detail-row-label">Series #</span><span class="detail-row-val">${car.seriesNum}</span></div>`:''}
    ${car.note?`<div class="detail-row"><span class="detail-row-label">Variant</span><span class="detail-row-val">${car.note}</span></div>`:''}
    ${car.tags?`<div class="detail-row"><span class="detail-row-label">Info</span><span class="detail-row-val" style="font-size:11px;color:var(--text2)">${car.tags}</span></div>`:''}
    <div class="detail-row"><span class="detail-row-label">Year</span><span class="detail-row-val">${currentYear}</span></div>
  `;

  const btnOwned = document.getElementById('btn-owned');
  btnOwned.textContent = isOwned ? '✓ In my collection' : '+ Add to collection';
  btnOwned.className = 'btn-owned ' + (isOwned ? 'owned' : 'not-owned');

  const btnWish = document.getElementById('btn-wish');
  btnWish.className = 'btn-wish' + (isWished ? ' active' : '');
  btnWish.title = isWished ? 'Remove from wishlist' : 'Add to wishlist';

  loadPhoto(car);
  document.getElementById('detail-modal').classList.add('open');
}

function closeDetail(){
  document.getElementById('detail-modal').classList.remove('open');
  closeCamera();
  currentCar = null;
}

// ===================== ACCOUNT =====================
function openAccount(){
  document.getElementById('account-email-label').textContent = isGuest ? 'Guest mode' : userEmail;
  document.getElementById('premium-row-text').textContent = isPremium ? '⭐ Premium — Active' : 'Upgrade to Premium';
  document.getElementById('account-modal').classList.add('open');
}
function closeAccount(){ document.getElementById('account-modal').classList.remove('open'); }

function signOut(){
  if(!confirm('Sign out?')) return;
  closeAccount();

  const emailEl = document.getElementById('auth-email');
  const passEl  = document.getElementById('auth-password');
  console.log('[signOut] emailEl:', emailEl, '| passEl:', passEl);

  // Block autofill before auth-screen becomes visible
  emailEl.setAttribute('readonly', true);
  passEl.setAttribute('readonly', true);
  emailEl.value = '';
  passEl.value  = '';

  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';

  userId = null; userEmail = ''; isGuest = false; currentToken = null;
  YEARS.forEach(y => { owned[y] = new Set(); wished[y] = new Set(); });
  switchAuthTab('login');

  // Release readonly after autofill window passes
  setTimeout(() => {
    emailEl.removeAttribute('readonly');
    passEl.removeAttribute('readonly');
  }, 500);
}

// ===================== EXPORT =====================
function exportData(){
  closeAccount();
  const data = getYearData(currentYear);
  if(!data) return;
  const rows = ['Col#,Toy#,Name,Series,Series#,Owned,Wished'];
  data.forEach(c=>{
    rows.push([
      String(c.col).padStart(3,'0'), c.toy||'', `"${c.name}"`,
      `"${c.series}"`, c.seriesNum||'',
      owned[currentYear].has(c.id)?'Yes':'No',
      wished[currentYear].has(c.id)?'Yes':'No'
    ].join(','));
  });
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `HW_Collection_${currentYear}.csv`;
  a.click();
}

// ===================== HEIGHT =====================
function setListHeight(){
  requestAnimationFrame(function(){
    const h = ['header','year-bar','controls'].reduce((a,id)=>{
      const el = document.getElementById(id);
      return a + (el ? el.offsetHeight : 0);
    }, 0);
    const wrap = document.getElementById('list-wrap');
    if(wrap) wrap.style.height = (window.innerHeight - h) + 'px';
  });
}
window.addEventListener('resize', setListHeight);

// ===================== EVENT LISTENERS =====================
document.getElementById('search').addEventListener('input', e=>{query=e.target.value.trim();render();});
document.getElementById('filter-series').addEventListener('change', e=>{seriesFilter=e.target.value;render();});

// ===================== EMAIL CONFIRMATION HANDLER =====================
(function handleEmailConfirmation(){
  const hash = window.location.hash;
  if(!hash) return;
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const type = params.get('type');
  if(type === 'recovery') return; // handled by initPasswordRecovery() in auth.js
  if(accessToken && (type === 'signup' || type === 'magiclink')){
    // Get user info with this token
    fetch(SUPABASE_URL + '/auth/v1/user', {
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+accessToken}
    }).then(r=>r.json()).then(user=>{
      if(user.email){
        currentToken = accessToken;
        userId = user.id;
        userEmail = user.email;
        isGuest = false;
        loadLocalData();
        enterApp();
        loadFromSupabase();
        // Clean URL
        history.replaceState(null,'',window.location.pathname);
      }
    }).catch(()=>{});
  }
})();

// ===================== SERVICE WORKER =====================
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
