// ===================== PHOTO STORAGE =====================

// Single canonical size for a car's photo — used for both the list
// thumbnail and the full detail view (no separate thumbnail file), keyed
// identically to Storage/localStorage by (year, carId). Caps the longer
// side at ~1000px (aspect ratio preserved, never upscales) and
// re-encodes as JPEG q=.8 — plenty readable in the detail view, ~100-150KB.
const PHOTO_MAX_DIMENSION = 1000;
const PHOTO_JPEG_QUALITY = 0.8;

function compressPhotoDataUrl(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to decode photo for compression'));
    img.src = dataUrl;
  });
}

async function uploadPhoto(dataUrl, year, carId){
  // Applies to both branches below (Storage upload and the guest/fallback
  // localStorage base64) — one compression step, one stored file. Only
  // ever runs on a freshly captured/picked photo here, so existing
  // already-stored photos are never touched.
  try {
    const compressed = await compressPhotoDataUrl(dataUrl);
    // An already-small/heavily-compressed input can come back LARGER
    // after re-encoding (e.g. a tiny gallery pick that's already under
    // 1000px) — a plain dataURL length check is enough to catch that
    // and just keep the original instead.
    if(compressed.length < dataUrl.length) dataUrl = compressed;
  } catch(e){
    console.warn('[uploadPhoto] compression failed, using original:', e);
  }

  if(isGuest || !userId || !currentToken){
    // Guest fallback — localStorage only. dataUrl here is the (possibly)
    // compressed version from above — the only copy of the photo a guest
    // has, since there's no Storage fallback, so keeping it small matters
    // for avoiding QuotaExceededError as the collection grows.
    try { localStorage.setItem(`hwc_photo_${userId}_${year}_${carId}`, dataUrl); return true; }
    catch(e){ return false; }
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${userId}/${year}/${carId}.jpg`;
    const url = `${SUPABASE_URL}/storage/v1/object/car-photos/${path}`;
    const formData = new FormData();
    formData.append('file', blob, 'photo.jpg');

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY },
      body: formData
    });

    console.log('[upload] status:', res.status);
    const respText = await res.text();
    console.log('[upload] response:', respText);

    // 409 = already exists — upsert via PUT
    if(res.status === 409){
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + currentToken, 'apikey': SUPABASE_KEY },
        body: formData
      });
      console.log('[upload] PUT status:', putRes.status);
      if(putRes.ok){
        localStorage.setItem(`hwc_photo_exists_${userId}_${year}_${carId}`, '1');
        localStorage.removeItem(`hwc_photo_${userId}_${year}_${carId}`);
        return true;
      }
    }

    if(res.ok){
      localStorage.setItem(`hwc_photo_exists_${userId}_${year}_${carId}`, '1');
      localStorage.removeItem(`hwc_photo_${userId}_${year}_${carId}`);
      return true;
    }

    // Upload failed — save to localStorage as fallback so photo is not lost
    console.warn('[upload] falling back to localStorage');
    localStorage.setItem(`hwc_photo_${userId}_${year}_${carId}`, dataUrl);
    return true;
  } catch(e){
    console.warn('[uploadPhoto] error:', e);
    // Network error — save to localStorage so photo is not lost
    localStorage.setItem(`hwc_photo_${userId}_${year}_${carId}`, dataUrl);
    return true;
  }
}

async function getPhotoUrl(year, carId){
  // Check localStorage first — may be base64 fallback from failed upload
  const cached = localStorage.getItem(`hwc_photo_${userId}_${year}_${carId}`);
  if(cached) return cached;

  // Guest fallback — no Supabase Storage
  if(isGuest || !userId || !currentToken) return null;

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
  const url = await getPhotoUrl(car.year, car.id);
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
  await deletePhotoFromStorage(currentCar.year, currentCar.id);
  loadPhoto(currentCar); render();
}

// ===================== CAMERA =====================

async function openCamera(){
  if(!currentCar) return;
  const modal = document.getElementById('camera-modal');
  modal.classList.add('open');
  const galleryBtn = document.getElementById('cam-gallery-btn');
  if(galleryBtn) galleryBtn.style.display = '';
  document.getElementById('camera-car-name').textContent = currentCar.name;
  const gi = document.getElementById('cam-gallery-img');
  const gicon = document.getElementById('cam-gallery-icon');
  const existing = await getPhotoUrl(currentCar.year, currentCar.id);
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

// #camera-video is styled with object-fit:cover — the browser uniformly
// scales the native frame up until it fills the element, then crops
// whatever overflows (centered) to make it fit exactly. A naive
// videoWidth/videoRect.width ratio ignores that centered crop entirely
// and maps CSS coordinates onto the WRONG region of the native buffer
// whenever the video's native aspect ratio differs from the on-screen
// element's aspect ratio (the common case on a phone: landscape sensor
// buffer inside a portrait viewfinder). This accounts for it, so a guide
// box the user sees on screen and the pixels actually cropped from the
// native frame are always the same region.
function mapCssRectToVideoPixels(video, videoRect, cssRect){
  const coverScale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
  const visibleW = videoRect.width / coverScale;
  const visibleH = videoRect.height / coverScale;
  const offsetX = (video.videoWidth - visibleW) / 2;
  const offsetY = (video.videoHeight - visibleH) / 2;

  return {
    x: offsetX + (cssRect.left - videoRect.left) / coverScale,
    y: offsetY + (cssRect.top - videoRect.top) / coverScale,
    w: cssRect.width / coverScale,
    h: cssRect.height / coverScale,
  };
}

function shootPhoto(){
  const v = document.getElementById('camera-video');
  if(!v.videoWidth) return;
  const flash = document.getElementById('camera-flash');
  flash.style.transition='none'; flash.style.opacity='1';
  setTimeout(()=>{ flash.style.transition='opacity .35s'; flash.style.opacity='0'; }, 80);

  const guideBox = document.querySelector('.camera-guide-box');
  const videoRect = v.getBoundingClientRect();
  const boxRect = guideBox.getBoundingClientRect();
  const crop = mapCssRectToVideoPixels(v, videoRect, boxRect);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.w);
  canvas.height = Math.round(crop.h);
  const ctx = canvas.getContext('2d');

  if(facingMode === 'user'){
    // Mirror: flip horizontally, adjust cropX to mirrored position
    const mirroredX = v.videoWidth - crop.x - crop.w;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, mirroredX, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  } else {
    ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  }

  savePhoto(canvas.toDataURL('image/jpeg', .85));
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
  const ok = await uploadPhoto(dataUrl, currentCar.year, currentCar.id);
  if(ok){ loadPhoto(currentCar); render(); closeCamera(); }
  else { alert('Failed to save photo. Please try again.'); }
}

function closeCamera(){
  stopCamera();
  document.getElementById('camera-modal').classList.remove('open');
}
