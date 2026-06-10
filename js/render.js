// ===================== YEAR DATA =====================
function getYearData(y){ return HWDATA[y] || null; }

function canAccessYear(y){
  if(isPremium) return true;
  return FREE_YEARS.includes(y);
}

// ===================== YEAR BAR =====================
function buildYearBar(){
  const bar = document.getElementById('year-bar');
  bar.innerHTML = YEARS.map(y => {
    const data = getYearData(y);
    const locked = !canAccessYear(y);
    const total = data ? data.length : 0;
    const ownedCount = data ? data.filter(c => owned[y].has(c.id)).length : 0;
    const pct = total ? Math.round(ownedCount/total*100) : 0;
    return `<div class="year-pill ${y===currentYear?'active':''} ${locked?'locked':''}"
      onclick="${locked?`openPremium()`:`setYear(${y})`}">
      <span class="year-pill-num">${y}</span>
      <span class="year-pill-pct">${locked?'🔒':total?pct+'%':'—'}</span>
    </div>`;
  }).join('');
}

function setYear(y){
  if(!canAccessYear(y)){ openPremium(); return; }
  currentYear = y;
  query=''; document.getElementById('search').value='';
  seriesFilter=''; tab='all';
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',i===0));
  buildYearBar();
  populateSeries();
  render();
}

// ===================== TAGS =====================
function getTags(car){
  const s = (car.tags||'').toLowerCase();
  const tags = [];
  if(s.includes('super treasure hunt')) tags.push({cls:'tag-sth',label:'STH'});
  else if(s.includes('treasure hunt')) tags.push({cls:'tag-th',label:'TH'});
  if(s.includes('new for')||s.includes('new in mainline')) tags.push({cls:'tag-new',label:'New'});
  if(s.includes('exclusive')||s.includes('zamac')) tags.push({cls:'tag-excl',label:'Excl'});
  return tags;
}

// ===================== FILTER =====================
function getFiltered(){
  const data = getYearData(currentYear);
  if(!data) return [];
  let list = data;
  const yset = owned[currentYear];
  const wset = wished[currentYear];
  if(tab==='owned') list = list.filter(c=>yset.has(c.id));
  if(tab==='missing') list = list.filter(c=>!yset.has(c.id));
  if(tab==='new') list = list.filter(c=>(c.tags||'').toLowerCase().includes('new'));
  if(tab==='wish') list = list.filter(c=>wset.has(c.id));
  if(seriesFilter) list = list.filter(c=>c.series===seriesFilter);
  if(query){
    const q = query.toLowerCase().trim();
    const qn = parseInt(q,10);
    list = list.filter(c=>{
      if(!isNaN(qn) && c.col===qn) return true;
      if(c.toy && c.toy.toLowerCase()===q) return true;
      if(c.name.toLowerCase().includes(q)) return true;
      if(c.series.toLowerCase().includes(q)) return true;
      if(String(c.col).padStart(3,'0').includes(q)) return true;
      return false;
    });
  }
  return list;
}

// ===================== RENDER =====================
function render(){
  const data = getYearData(currentYear);
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');

  if(!data){
    listEl.innerHTML='<div style="padding:20px;color:var(--text2);text-align:center;font-size:13px">Loading...</div>';
    emptyEl.style.display='none';
    return;
  }
  if(!canAccessYear(currentYear)){
    listEl.innerHTML='';
    emptyEl.style.display='none';
    return;
  }

  const filtered = getFiltered();
  updateTabCounts(data);
  updateProgress(data);

  if(!filtered.length){
    listEl.innerHTML=''; emptyEl.style.display='flex';
  } else {
    emptyEl.style.display='none';
    const yset = owned[currentYear];
    const wset = wished[currentYear];
    listEl.innerHTML = filtered.map(car => {
      const isOwned = yset.has(car.id);
      const isWished = wset.has(car.id);
      const tags = getTags(car);
      const tagHtml = tags.map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join('');
      const photoData = localStorage.getItem(`hwc_photo_${userId}_${currentYear}_${car.id}`);
      const hasPhoto = !!localStorage.getItem(`hwc_photo_exists_${userId}_${currentYear}_${car.id}`) || !!photoData;
      const note = car.note ? `<span class="car-name-note"> · ${car.note}</span>` : '';
      return `<div class="car-item${isOwned?' owned':''}${isWished&&!isOwned?' wished':''}" onclick="openDetail(${car.id})">
        <div class="car-col">${String(car.col).padStart(3,'0')}</div>
        <div class="car-thumb">
          ${hasPhoto
            ? (photoData ? `<img src="${photoData}" alt="">` : `<span class="car-thumb-icon">📷</span>`)
            : `<span class="car-thumb-icon">${isOwned?'✓':'🚗'}</span>`
          }
        </div>
        <div class="car-info">
          <div class="car-name">${car.name}${note}</div>
          <div class="car-sub">
            <span class="series-badge ${sc(car.series)}">${car.series}</span>
            <span class="series-num">${car.seriesNum||''}</span>
            ${tagHtml}
            ${isWished?'<span class="tag tag-wish">WANT</span>':''}
          </div>
        </div>
        <div class="car-actions">
          <button class="wish-btn${isWished?' active':''}" onclick="event.stopPropagation();quickWish(${car.id},this)" title="Wishlist">🎯</button>
          <button class="owned-btn${isOwned?' yes':''}" onclick="event.stopPropagation();quickOwned(${car.id},this)"></button>
        </div>
      </div>`;
    }).join('');
  }
}

function updateProgress(data){
  const total = data.length;
  const ownedCount = data.filter(c=>owned[currentYear].has(c.id)).length;
  const pct = total ? Math.round(ownedCount/total*100) : 0;
  document.getElementById('progress-fill').style.width = pct+'%';
  document.getElementById('stat-owned').textContent = ownedCount;
  document.getElementById('stat-pct').textContent = pct+'%';
  document.getElementById('stat-total').textContent = total;
  buildYearBar();
}

function updateTabCounts(data){
  const yset = owned[currentYear];
  const wset = wished[currentYear];
  document.getElementById('tc-all').textContent = data.length;
  document.getElementById('tc-owned').textContent = data.filter(c=>yset.has(c.id)).length;
  document.getElementById('tc-missing').textContent = data.filter(c=>!yset.has(c.id)).length;
  document.getElementById('tc-new').textContent = data.filter(c=>(c.tags||'').toLowerCase().includes('new')).length;
  document.getElementById('tc-wish').textContent = data.filter(c=>wset.has(c.id)).length;
}

// ===================== CONTROLS =====================
function setTab(t){
  tab = t;
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',['all','owned','missing','new','wish'][i]===t));
  render();
}

function populateSeries(){
  const data = getYearData(currentYear);
  const sel = document.getElementById('filter-series');
  sel.innerHTML = '<option value="">All series</option>';
  if(!data) return;
  [...new Set(data.map(c=>c.series))].sort().forEach(s=>{
    const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o);
  });
}
