// ===================== DATA LOAD =====================
function loadLocalData(){
  YEARS.forEach(y => {
    try {
      owned[y] = new Set(JSON.parse(localStorage.getItem(`hwc_owned_${userId}_${y}`) || '[]'));
      wished[y] = new Set(JSON.parse(localStorage.getItem(`hwc_wish_${userId}_${y}`) || '[]'));
    } catch(e){}
  });
}

async function loadUserData(){
  loadLocalData(); // load local cache first for instant display
}

function saveLocal(){
  YEARS.forEach(y => {
    localStorage.setItem(`hwc_owned_${userId}_${y}`, JSON.stringify([...owned[y]]));
    localStorage.setItem(`hwc_wish_${userId}_${y}`, JSON.stringify([...wished[y]]));
  });
}

async function supabaseFetch(path, method='GET', body=null){
  const opts = {
    method,
    headers:{
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + currentToken,
      'Content-Type': 'application/json',
      'Prefer': method==='POST' ? 'return=minimal,resolution=merge-duplicates' : method==='PATCH' ? 'return=minimal' : ''
    }
  };
  if(body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
    if(!res.ok){
      const err = await res.text();
      console.warn('Supabase error:', path, err);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch(e){
    console.warn('Supabase fetch error:', e);
    return null;
  }
}

async function syncToSupabase(year, carId, type, value){
  if(isGuest || !userId || !currentToken) return;
  console.log('[syncToSupabase] userId:', userId, '| type:', type, '| year:', year, '| car_id:', carId, '| value:', value);
  const table = type === 'owned' ? 'collection' : 'wishlist';
  if(value){
    await supabaseFetch(table, 'POST', {user_id: userId, year, car_id: carId});
  } else {
    await supabaseFetch(`${table}?user_id=eq.${userId}&year=eq.${year}&car_id=eq.${carId}`, 'DELETE');
  }
}

async function logEvent(type, data={}){
  if(isGuest || !userId || !currentToken) return;
  try {
    await fetch(SUPABASE_URL + '/rest/v1/app_logs', {
      method:'POST',
      headers:{
        'apikey':SUPABASE_KEY,
        'Authorization':'Bearer '+currentToken,
        'Content-Type':'application/json',
        'Prefer':'return=minimal'
      },
      body:JSON.stringify({user_id:userId, event_type:type, event_data:data})
    });
  } catch(e){}
}

async function loadFromSupabase(){
  if(isGuest || !userId || !currentToken) return;
  console.log('[loadFromSupabase] starting...');
  try {
    const [col, wish] = await Promise.all([
      supabaseFetch(`collection?user_id=eq.${userId}&select=year,car_id`),
      supabaseFetch(`wishlist?user_id=eq.${userId}&select=year,car_id`)
    ]);
    console.log('[loadFromSupabase] loaded:', col?.length, 'owned,', wish?.length, 'wished');
    // Reset and load
    YEARS.forEach(y => { owned[y] = new Set(); wished[y] = new Set(); });
    (col||[]).forEach(r => { if(owned[r.year]) owned[r.year].add(r.car_id); });
    (wish||[]).forEach(r => { if(wished[r.year]) wished[r.year].add(r.car_id); });
    saveLocal();
    render(); buildYearBar();
  } catch(e){ console.error('Sync error', e); }
}
