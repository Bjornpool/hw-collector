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

// Swaps which viewfinder guide box is shown: the 4:3 car-framing box for
// photo mode, or the short/wide text-strip box (bottom of the card, where
// Col#/name print) for scan mode. Different regions, different purpose.
// Purely visual — null-safe on both lookups so a missing/renamed element
// (e.g. a stale cached index.html momentarily out of sync with a fresh
// camera.js) can never throw and take the actual camera stream down with it.
function setGuideMode(mode){
  const photoGuide = document.getElementById('photo-guide');
  const scanGuide = document.getElementById('scan-guide');
  if(photoGuide) photoGuide.style.display = mode === 'photo' ? '' : 'none';
  if(scanGuide) scanGuide.style.display = mode === 'scan' ? '' : 'none';
}

async function openCamera(){
  if(!currentCar) return;
  cameraMode = 'photo';
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
  setGuideMode('photo'); // after starting the stream: a guide-box hiccup must never block the camera itself
}

// Card scan (OCR) — deliberately does NOT touch currentCar, so a stale
// currentCar from a previous detail view can never get a photo saved
// against it if a scan is interrupted mid-flow.
function openScanCamera(){
  cameraMode = 'scan';
  currentCar = null;
  const modal = document.getElementById('camera-modal');
  modal.classList.add('open');
  const galleryBtn = document.getElementById('cam-gallery-btn');
  if(galleryBtn) galleryBtn.style.display = 'none';
  document.getElementById('camera-car-name').textContent = 'Scan Card';
  startCamera();
  setGuideMode('scan'); // after starting the stream, same reasoning as openCamera()
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

  if(cameraMode === 'scan'){
    // Crop to the scan guide box (the card's bottom text strip), not the
    // whole frame — a full-frame image is mostly car photo and background,
    // which just adds noise for Tesseract. Upscale the crop afterward:
    // it's a small region of the native 1080p+ frame, and OCR does much
    // better on larger glyphs.
    const scanBox = document.querySelector('.camera-scan-box');
    const videoRect = v.getBoundingClientRect();
    const boxRect = scanBox.getBoundingClientRect();

    const scaleX = v.videoWidth / videoRect.width;
    const scaleY = v.videoHeight / videoRect.height;
    const cropX = (boxRect.left - videoRect.left) * scaleX;
    const cropY = (boxRect.top - videoRect.top) * scaleY;
    const cropW = boxRect.width * scaleX;
    const cropH = boxRect.height * scaleY;

    const UPSCALE = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cropW * UPSCALE);
    canvas.height = Math.round(cropH * UPSCALE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if(facingMode === 'user'){
      const mirroredX = v.videoWidth - cropX - cropW;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, mirroredX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    }

    runCardScan(canvas, { x: cropX, y: cropY, w: cropW, h: cropH });
    return;
  }

  const guideBox = document.querySelector('.camera-guide-box');
  const videoRect = v.getBoundingClientRect();
  const boxRect = guideBox.getBoundingClientRect();

  const scaleX = v.videoWidth / videoRect.width;
  const scaleY = v.videoHeight / videoRect.height;
  let cropX = (boxRect.left - videoRect.left) * scaleX;
  let cropY = (boxRect.top - videoRect.top) * scaleY;
  const cropW = boxRect.width * scaleX;
  const cropH = boxRect.height * scaleY;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext('2d');

  if(facingMode === 'user'){
    // Mirror: flip horizontally, adjust cropX to mirrored position
    const mirroredX = v.videoWidth - cropX - cropW;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, mirroredX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  } else {
    ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
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

// Single exit point for the camera modal — always stops the media stream
// and resets cameraMode back to 'photo', so an interrupted scan can never
// leave a later "add photo" shot mistakenly routed into OCR (or vice versa).
function closeCamera(){
  stopCamera();
  document.getElementById('camera-modal').classList.remove('open');
  const loading = document.getElementById('ocr-loading');
  if(loading) loading.style.display = 'none';
  cameraMode = 'photo';
}

// ===================== CARD SCAN (OCR) =====================
async function runCardScan(canvas, cropInfo){
  const loading = document.getElementById('ocr-loading');
  if(loading) loading.style.display = 'flex';
  try {
    const { freeText, codeText, canvas: processedCanvas } = await recognizeCardText(canvas); // js/ocr.js
    showOcrDebugPanel(processedCanvas, cropInfo, freeText, codeText); // js/ocr.js — DEBUG, stays open until dismissed
    const q = parseCardText(freeText + '\n' + codeText); // js/ocr.js
    if(q){
      const searchEl = document.getElementById('search');
      searchEl.value = q;
      query = q;
      render();
      searchEl.focus();
    } else {
      alert('Could not read any text from the card. Try again with better lighting/focus.');
    }
  } catch(e){
    console.warn('[runCardScan] OCR failed', e);
    alert('Could not read the card. Try again.');
  } finally {
    // Stops the camera stream and resets cameraMode. Safe to do
    // immediately: the debug panel lives outside #camera-modal, so this
    // no longer hides it (that was the original bug).
    closeCamera();
  }
}
