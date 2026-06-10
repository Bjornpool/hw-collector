// ===================== PHOTO STORAGE =====================

async function uploadPhoto(dataUrl, year, carId){
  if(isGuest || !userId || !currentToken){
    // Guest fallback — localStorage only
    try { localStorage.setItem(`hwc_photo_${userId}_${year}_${carId}`, dataUrl); return true; }
    catch(e){ return false; }
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${userId}/${year}/${carId}.jpg`;
    const formData = new FormData();
    formData.append('file', blob, 'photo.jpg');

    let res = await fetch(`${SUPABASE_URL}/storage/v1/object/car-photos/${path}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY },
      body: formData
    });

    // 409 = already exists — upsert
    if(res.status === 409){
      res = await fetch(`${SUPABASE_URL}/storage/v1/object/car-photos/${path}`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY, 'x-upsert': 'true' },
        body: formData
      });
    }

    if(res.ok){
      // Mark photo as existing — don't cache URL, blob URLs are session-only
      localStorage.setItem(`hwc_photo_exists_${userId}_${year}_${carId}`, '1');
      return true;
    }
    console.warn('[uploadPhoto] failed:', res.status, await res.text());
    return false;
  } catch(e){ console.warn('[uploadPhoto] error:', e); return false; }
}

async function getPhotoUrl(year, carId){
  // Guest fallback — data URL stored directly in localStorage
  if(isGuest || !userId || !currentToken){
    return localStorage.getItem(`hwc_photo_${userId}_${year}_${carId}`) || null;
  }

  const path = `${userId}/${year}/${carId}.jpg`;
  const url = `${SUPABASE_URL}/storage/v1/object/authenticated/car-photos/${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY }
    });
    if(!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch(e){ console.warn('[getPhotoUrl] error:', e); return null; }
}

async function deletePhotoFromStorage(year, carId){
  localStorage.removeItem(`hwc_photo_${userId}_${year}_${carId}`);
  localStorage.removeItem(`hwc_photo_exists_${userId}_${year}_${carId}`);
  if(isGuest || !userId || !currentToken) return;
  const path = `${userId}/${year}/${carId}.jpg`;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/car-photos/${path}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY }
    });
  } catch(e){ console.warn('[deletePhotoFromStorage] error:', e); }
}

// ===================== PHOTOS — UI =====================

async function loadPhoto(car){
  const url = await getPhotoUrl(currentYear, car.id);
  const img = document.getElementById('detail-photo');
  const noPhoto = document.getElementById('detail-no-photo');
  const delBtn = document.getElementById('detail-photo-del');
  const changeBtn = document.getElementById('detail-photo-change');
  if(url){
    img.src = url; img.style.display = 'block';
    noPhoto.style.display = 'none';
    delBtn.style.display = 'flex'; changeBtn.style.display = 'block';
    const gt = document.getElementById('cam-gallery-img');
    if(gt){ gt.src = url; gt.style.display = 'block'; document.getElementById('cam-gallery-icon').style.display = 'none'; }
  } else {
    img.style.display = 'none'; noPhoto.style.display = 'flex';
    delBtn.style.display = 'none'; changeBtn.style.display = 'none';
  }
}

async function deletePhoto(){
  if(!currentCar || !confirm('Delete photo?')) return;
  await deletePhotoFromStorage(currentYear, currentCar.id);
  loadPhoto(currentCar); render();
}

// ===================== CAMERA =====================

async function openCamera(){
  if(!currentCar) return;
  const modal = document.getElementById('camera-modal');
  modal.classList.add('open');
  document.getElementById('camera-car-name').textContent = currentCar.name;
  const gi = document.getElementById('cam-gallery-img');
  const gicon = document.getElementById('cam-gallery-icon');
  const existing = await getPhotoUrl(currentYear, currentCar.id);
  if(existing){ gi.src = existing; gi.style.display = 'block'; gicon.style.display = 'none'; }
  else { gi.style.display = 'none'; gicon.style.display = 'block'; }
  startCamera();
}

function startCamera(){
  stopCamera();
  navigator.mediaDevices.getUserMedia({
    video:{ facingMode:{ideal:facingMode}, width:{ideal:1920}, height:{ideal:1080} }
  }).then(stream=>{
    cameraStream = stream;
    const v = document.getElementById('camera-video');
    v.srcObject = stream; v.play();
  }).catch(err=>{
    alert('Camera access denied: ' + err.message);
    closeCamera();
  });
}

function stopCamera(){
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  const v = document.getElementById('camera-video');
  if(v) v.srcObject = null;
}

function flipCamera(){
  facingMode = facingMode==='environment' ? 'user' : 'environment';
  startCamera();
}

function shootPhoto(){
  const v = document.getElementById('camera-video');
  if(!v.videoWidth) return;
  const flash = document.getElementById('camera-flash');
  flash.style.transition='none'; flash.style.opacity='1';
  setTimeout(()=>{ flash.style.transition='opacity .35s'; flash.style.opacity='0'; }, 80);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200/v.videoWidth);
  canvas.width = Math.round(v.videoWidth*scale);
  canvas.height = Math.round(v.videoHeight*scale);
  const ctx = canvas.getContext('2d');
  if(facingMode==='user'){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(v,0,0,canvas.width,canvas.height);
  savePhoto(canvas.toDataURL('image/jpeg',.85));
}

function openGallery(){ document.getElementById('gallery-input').click(); }

function handleGalleryPhoto(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    const img = new Image();
    img.onload = ()=>{
      const c = document.createElement('canvas');
      const s = Math.min(1,1200/img.width);
      c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      savePhoto(c.toDataURL('image/jpeg',.85));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value='';
}

async function savePhoto(dataUrl){
  if(!currentCar) return;
  const ok = await uploadPhoto(dataUrl, currentYear, currentCar.id);
  if(ok){ loadPhoto(currentCar); render(); closeCamera(); }
  else { alert('Failed to save photo. Please try again.'); }
}

function closeCamera(){
  stopCamera();
  document.getElementById('camera-modal').classList.remove('open');
}
