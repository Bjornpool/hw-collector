// ===================== SUPABASE CONFIG =====================
const SUPABASE_URL = 'https://eqcukmkoybranbystazf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jBh3c4xw6GEnE4hpzYz8QA_GCyINyYv';
// Service key — wypełnij w js/config.local.js (nie commituj tamtego pliku!)
const SUPABASE_SERVICE_KEY = '';

// ===================== STATE =====================
const YEARS = [2023, 2024, 2025, 2026];
const FREE_YEARS = [2024]; // free users only get 2024
let currentYear = 2024;
let tab = 'all';
let query = '';
let seriesFilter = '';
let currentCar = null;
let isPremium = false; // set to true after purchase

function savePremiumState(uid, val){
  if(uid) localStorage.setItem('hwc_premium_'+uid, val?'1':'0');
}
function loadPremiumState(uid){
  return localStorage.getItem('hwc_premium_'+uid) === '1';
}
let isGuest = false;
let userId = null;
let userEmail = '';
let currentToken = null;

// Local state (synced to Supabase when online)
let owned = {}; // { year: Set(ids) }
let wished = {}; // { year: Set(ids) }
YEARS.forEach(y => { owned[y] = new Set(); wished[y] = new Set(); });

// Camera
let cameraStream = null;
let facingMode = 'environment';
let cameraMode = 'photo'; // 'photo' (per-car detail shot) or 'scan' (card OCR)

// ===================== SERIES CLASS MAP =====================
const SC = {
  'HW Dream Garage':'s-dream','Batman':'s-batman','HW Screen Time':'s-screen',
  'HW Designed By':'s-designed','HW Metro':'s-metro','HW EV':'s-ev',
  'HW Art Cars':'s-artcars','HW J-Imports':'s-jimports','X-Raycers':'s-raycers',
  'Factory Fresh':'s-fresh','HW First Response':'s-response','HW Hot Trucks':'s-trucks',
  'HW Ride-Ons':'s-rideons','Rod Squad':'s-rod','HW Modified':'s-modified',
  'HW Reverse Rake':'s-reverse','HW Moto':'s-moto','HW Race Day':'s-race',
  'HW Dirt':'s-dirt','Compact Kings':'s-compact','HW Celebration Racers':'s-celebration',
  "HW: '70s vs. '90s":'s-7090s','HW Exotics':'s-exotics','Muscle Mania':'s-muscle',
  'Safari Mode':'s-safari','Track Aces':'s-track','Mustang 60th':'s-mustang',
  'Experimotors':'s-experimot',"Hot Wheels Let's Race":'s-letsrace',
  'Fast Foodie':'s-foodie','Wild Widebody':'s-wildwide','Red Edition':'s-red',
  'Peak Pursuit':'s-peak','HW Wagons':'s-wagons','HW Track Champs':'s-champs',
  'Retro Racers':'s-retro',"HW: The '90s":'s-90s','HW Rolling Metal':'s-rolling',
  'HW Vans':'s-vans','Quarter Mile Heroes':'s-qmh','HW Euro':'s-euro',
  'Formula 1':'s-f1','Tooned':'s-tooned','Drag Racers':'s-drag',
  'Then and Now':'s-then','Nightspeed':'s-nightspeed',"Layin' Low":'s-layin',
  'Drop Tops':'s-droptops','HW Mods':'s-mods','Ferrari':'s-ferrari',
  'Mattel':'s-mattel','HW Heavyweights':'s-heavy','HW Starting Grid':'s-starting',
  'Exoticars':'s-exotics','HW Fan Driven':'s-response','Sweet Rides':'s-foodie',
  'Screen Time':'s-screen',"Truckin' Along":'s-trucks','Wagons':'s-wagons',
  'HW All Drivers Welcome':'s-celebration','HW Xtreme Sports':'s-default',
  'HW Mega Bite':'s-default','HW Fast Transit':'s-metro','HW Turbo':'s-nightspeed',
  'HW Green Speed':'s-ev','HW Roadsters':'s-droptops',
  'Trophy Case':'s-safari','Cool Classics':'s-retro','Team Wheels':'s-rolling',
  'HW Torque':'s-muscle',
};
function sc(s){ return SC[s] || 's-default'; }
