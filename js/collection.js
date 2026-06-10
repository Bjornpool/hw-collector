// ===================== COLLECTION TOGGLES =====================
function quickOwned(id, btn){
  const set = owned[currentYear];
  if(set.has(id)) set.delete(id); else set.add(id);
  saveLocal(); syncToSupabase(currentYear, id, 'owned', set.has(id));
  btn.classList.toggle('yes', set.has(id));
  btn.closest('.car-item').classList.toggle('owned', set.has(id));
  const data = getYearData(currentYear);
  updateProgress(data); updateTabCounts(data);
}

function quickWish(id, btn){
  const set = wished[currentYear];
  if(set.has(id)) set.delete(id); else set.add(id);
  saveLocal(); syncToSupabase(currentYear, id, 'wish', set.has(id));
  btn.classList.toggle('active', set.has(id));
  render();
}

function toggleOwned(){
  if(!currentCar) return;
  const set = owned[currentYear];
  if(set.has(currentCar.id)) set.delete(currentCar.id); else set.add(currentCar.id);
  saveLocal(); syncToSupabase(currentYear, currentCar.id, 'owned', set.has(currentCar.id));
  render();
  const isOwned = set.has(currentCar.id);
  const btn = document.getElementById('btn-owned');
  btn.textContent = isOwned ? '✓ In my collection' : '+ Add to collection';
  btn.className = 'btn-owned ' + (isOwned ? 'owned' : 'not-owned');
}

function toggleWish(){
  if(!currentCar) return;
  const set = wished[currentYear];
  if(set.has(currentCar.id)) set.delete(currentCar.id); else set.add(currentCar.id);
  saveLocal(); syncToSupabase(currentYear, currentCar.id, 'wish', set.has(currentCar.id));
  render();
  const isWished = set.has(currentCar.id);
  const btn = document.getElementById('btn-wish');
  btn.className = 'btn-wish' + (isWished ? ' active' : '');
}
