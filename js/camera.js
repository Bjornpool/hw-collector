// ===================== PHOTOS =====================
function photoKey(car){ return `hwc_photo_${userId}_${currentYear}_${car.id}`; }

function loadPhoto(car){
  const data = localStorage.getItem(photoKey(car));
  const img = document.getElementById('detail-photo');
  const noPhoto = document.getElementById('detail-no-photo');
  const delBtn = document.getElementById('detail-photo-del');
  const changeBtn = document.getElementById('detail-photo-change');
  if(data){
    img.src = data; img.style.display = 'block';
    noPhoto.style.display = 'none';
    delBtn.style.display = 'flex'; changeBtn.style.display = 'block';
    const gt = document.getElementById('cam-gallery-img');
    if(gt){ gt.src=data; gt.style.display='block'; document.getElementById('cam-gallery-icon').style.display='none'; }
  } else {
    img.style.display = 'none'; noPhoto.style.display = 'flex';
    delBtn.style.display = 'none'; changeBtn.style.display = 'none';
  }
}

function deletePhoto(){
  if(!currentCar||!confirm('Delete photo?')) return;
  localStorage.removeItem(photoKey(currentCar));
  loadPhoto(currentCar); render();
}

// ===================== CAMERA =====================
function openCamera(){
  if(!currentCar) return;
  if(!isPremium && isGuest){
    // guests can still take photos locally — no restriction
  }
  const modal = document.getElementById('camera-modal');
  modal.classList.add('open');
  document.getElementById('camera-car-name').textContent = currentCar.name;
  // Load existing thumb
  const existing = localStorage.getItem(photoKey(currentCar));
  const gi = document.getElementById('cam-gallery-img');
  const gicon = document.getElementById('cam-gallery-icon');
  if(existing){ gi.src=existing; gi.style.display='block'; gicon.style.display='none'; }
  else { gi.style.display='none'; gicon.style.display='block'; }
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

function savePhoto(dataUrl){
  if(!currentCar) return;
  try {
    localStorage.setItem(photoKey(currentCar), dataUrl);
    loadPhoto(currentCar); render(); closeCamera();
  } catch(e){ alert('Not enough storage. Delete some photos first.'); }
}

function closeCamera(){
  stopCamera();
  document.getElementById('camera-modal').classList.remove('open');
}
