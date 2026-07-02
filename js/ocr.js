// ===================== CARD OCR (Tesseract.js, fully local) =====================
// Every asset is vendored under /vendor/tesseract — no jsdelivr/unpkg/
// projectnaptha CDN reference anywhere in this file. That's what makes
// scanning work offline from the very first use (see sw.js precache).
const OCR_VENDOR_DIR = 'vendor/tesseract/';
const OCR_PATHS = {
  workerPath: OCR_VENDOR_DIR + 'worker.min.js',
  corePath: OCR_VENDOR_DIR + 'tesseract-core-simd-lstm.wasm.js',
  langPath: OCR_VENDOR_DIR + 'lang/', // Tesseract appends `${lang}.traineddata.gz`
  gzip: true,
};

// Col#/Toy# on a Hot Wheels card look like "045/250" or "HKJ88" — digits,
// a slash, and uppercase letters only. Restricting the charset for this
// pass removes most of the misreads Tesseract makes against a full
// alphanumeric+symbol charset on small card print.
const OCR_CODE_WHITELIST = '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let ocrScriptPromise = null;
let ocrWorkerPromise = null;

function loadTesseractScript(){
  if(ocrScriptPromise) return ocrScriptPromise;
  ocrScriptPromise = new Promise((resolve, reject) => {
    if(window.Tesseract){ resolve(); return; }
    const s = document.createElement('script');
    s.src = OCR_VENDOR_DIR + 'tesseract.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + s.src));
    document.head.appendChild(s);
  });
  return ocrScriptPromise;
}

// Created once, on first scan, and reused for every subsequent scan.
function getOcrWorker(){
  if(!ocrWorkerPromise){
    ocrWorkerPromise = loadTesseractScript().then(() =>
      Tesseract.createWorker('eng', 1, OCR_PATHS)
    );
  }
  return ocrWorkerPromise;
}

// Grayscale -> light denoise blur -> adaptive threshold (each pixel vs.
// its own local background estimate) -> black/white, in place.
//
// A single global threshold blows out one side of the crop and crushes
// the other whenever lighting is uneven across the card (phone flash,
// shadow, off-angle shot) — exactly the "letters read as garbage
// fragments" failure mode. Comparing each pixel to a heavily-blurred
// version of itself (the local background) instead of one fixed number
// adapts to that unevenness. The light 1px blur before that just knocks
// down sensor/JPEG noise so thin letter strokes don't fragment into
// speckles that the threshold then treats as separate blobs.
function preprocessCanvasForOcr(canvas){
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');

  // 1. Grayscale, onto its own canvas so the blur passes below have a
  // clean single-channel source to work from.
  const grayCanvas = document.createElement('canvas');
  grayCanvas.width = w; grayCanvas.height = h;
  const grayCtx = grayCanvas.getContext('2d');
  grayCtx.drawImage(canvas, 0, 0);
  const grayImg = grayCtx.getImageData(0, 0, w, h);
  {
    const d = grayImg.data;
    for(let i = 0; i < d.length; i += 4){
      const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      d[i] = d[i+1] = d[i+2] = g;
    }
    grayCtx.putImageData(grayImg, 0, 0);
  }

  // 2. Denoise: a 1px blur to suppress noise before we start comparing
  // pixel values against each other.
  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = w; fgCanvas.height = h;
  const fgCtx = fgCanvas.getContext('2d');
  fgCtx.filter = 'blur(1px)';
  fgCtx.drawImage(grayCanvas, 0, 0);
  const fg = fgCtx.getImageData(0, 0, w, h);

  // 3. Local background estimate: a much heavier blur, so it tracks slow
  // lighting gradients but not individual letters.
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = w; bgCanvas.height = h;
  const bgCtx = bgCanvas.getContext('2d');
  bgCtx.filter = 'blur(18px)';
  bgCtx.drawImage(grayCanvas, 0, 0);
  const bg = bgCtx.getImageData(0, 0, w, h);

  // 4. Threshold each pixel against its own local background: darker than
  // the local background by more than C counts as ink (black).
  const C = 12;
  const out = ctx.getImageData(0, 0, w, h);
  for(let i = 0; i < out.data.length; i += 4){
    const isInk = fg.data[i] < bg.data[i] - C;
    const v = isInk ? 0 : 255;
    out.data[i] = out.data[i+1] = out.data[i+2] = v;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// DEBUG: persistent panel (outside #camera-modal — see index.html) that
// shows exactly what Tesseract received: the processed crop at full
// size, the source-frame crop coordinates, and the raw text from both
// OCR passes. Stays open until "Zamknij" is tapped — closeCamera() does
// NOT touch it. Also logs the crop's data URL to the console so it can
// be pulled out and inspected/saved from there.
// Remove this function (and its call site, and the #ocr-debug-panel
// markup/CSS) once scan accuracy has been validated on real cards.
function showOcrDebugPanel(canvas, cropInfo, freeText, codeText){
  const dataUrl = canvas.toDataURL('image/png');
  console.log('[OCR debug] processed crop data URL:', dataUrl);

  const img = document.getElementById('ocr-debug-img');
  if(img) img.src = dataUrl;

  const cropEl = document.getElementById('ocr-debug-crop');
  if(cropEl && cropInfo){
    cropEl.textContent = `crop (source frame px): x=${Math.round(cropInfo.x)} y=${Math.round(cropInfo.y)} w=${Math.round(cropInfo.w)} h=${Math.round(cropInfo.h)}`;
  }

  const textEl = document.getElementById('ocr-debug-text');
  if(textEl){
    textEl.textContent =
      `--- Pass 1: free text (PSM 6) ---\n${freeText || '(empty)'}\n\n` +
      `--- Pass 2: code, whitelist (PSM 7) ---\n${codeText || '(empty)'}`;
  }

  const panel = document.getElementById('ocr-debug-panel');
  if(panel) panel.classList.add('open');
}

function closeOcrDebugPanel(){
  const panel = document.getElementById('ocr-debug-panel');
  if(panel) panel.classList.remove('open');
}

async function recognizeCardText(canvas){
  const worker = await getOcrWorker();

  preprocessCanvasForOcr(canvas);

  // Pass 1: unrestricted charset, uniform block of text (PSM 6) — best
  // for the car name / series text, which can wrap across a couple lines.
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
  const { data: { text: freeText } } = await worker.recognize(canvas);

  // Pass 2: digits/slash/uppercase only, single text line (PSM 7) — tuned
  // for Col#/Toy# tokens like "045/250" or "HKJ88".
  await worker.setParameters({ tessedit_char_whitelist: OCR_CODE_WHITELIST, tessedit_pageseg_mode: '7' });
  const { data: { text: codeText } } = await worker.recognize(canvas);

  // Reset to Tesseract's defaults so a later "photo" flow (if it ever
  // reuses this worker) or the next scan isn't left with a stale config.
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });

  return { freeText, codeText, canvas };
}

// ===================== OCR-NOISE-TOLERANT MATCHING =====================
// Real-world scans come back as correct text plus junk from adjacent
// print — "7 BMWSO7- TO" for "BMW507", "7 1/250" for "67/250". Exact
// substring matching (matchesQuery in render.js, used by the live search
// box) is intentionally strict/predictable for typed input; it's too
// strict for this. This is a separate, tolerant scorer used only to
// resolve OCR output to a car — render.js/matchesQuery is untouched, so
// normal typed search keeps behaving exactly as before.

// Letters Tesseract commonly confuses with digits or with each other.
// Normalizing both the OCR text and the car data through this same map
// makes "S"/"5", "O"/"0", etc. equivalent for comparison purposes.
const OCR_CONFUSABLE_MAP = { O:'0', I:'1', L:'1', S:'5', Z:'2', B:'8', G:'6' };

function normalizeForOcrMatch(s){
  return (s || '')
    .toUpperCase()
    .replace(/[\s\-.]/g, '')
    .replace(/[OILSZBG]/g, ch => OCR_CONFUSABLE_MAP[ch]);
}

function ocrTokens(text){
  return (text || '')
    .split(/[^A-Za-z0-9]+/)
    .filter(t => t.length >= 3) // drop 1-2 char fragments — too noisy to mean anything
    .map(normalizeForOcrMatch);
}

// "045/250", or noisy variants like "7 1/250" — pulls the number before
// the slash as a Col# guess.
function extractColGuess(text){
  const m = (text || '').match(/(\d{1,3})\s*\/\s*\d{2,3}/);
  return m ? m[1] : null;
}

// The longest OCR token that's a substring of the car's normalized
// name/toy wins (a toy-code hit counts for a bit more, since it's a
// shorter/more specific string than a name). An exact Col# match, or a
// Col# match missing just its leading digit (OCR dropping the "6" from
// "67"), adds a strong bonus on top.
function scoreCarAgainstOcr(car, tokens, colGuess){
  let score = 0;
  const normName = normalizeForOcrMatch(car.name);
  const normToy = car.toy ? normalizeForOcrMatch(car.toy) : '';

  for(const tok of tokens){
    if(normName.includes(tok)) score = Math.max(score, tok.length);
    if(normToy && normToy.includes(tok)) score = Math.max(score, tok.length + 2);
  }

  if(colGuess){
    const colStr = String(car.col);
    if(colStr === colGuess) score += 20;
    else if(colStr.endsWith(colGuess)) score += 8;
  }

  return score;
}

// Below this, treat it as noise rather than a real hit — a single
// 3-letter token match shouldn't be enough to pick a car out of ~1450.
const OCR_MATCH_MIN_SCORE = 4;

function findBestCardMatch(rawText){
  const tokens = ocrTokens(rawText);
  const colGuess = extractColGuess(rawText);
  if(!tokens.length && !colGuess) return null;

  let best = null, bestScore = 0;
  for(const car of ALL_CARS){
    if(!canAccessYear(car.year)) continue;
    const score = scoreCarAgainstOcr(car, tokens, colGuess);
    if(score > bestScore){ best = car; bestScore = score; }
  }
  return bestScore >= OCR_MATCH_MIN_SCORE ? best : null;
}

function cleanOcrLine(line){
  return line.replace(/[^\p{L}\p{N}\s\/#'-]/gu, '').replace(/\s+/g, ' ').trim();
}

// Tries the tolerant matcher above first. A confident hit returns that
// car's own exact name — guaranteed to match itself in the plain
// substring search (matchesQuery), so the noisy OCR text never has to
// survive verbatim into the search box. Falls back to the longest
// cleaned line so there's still something sensible to edit by hand when
// nothing scored high enough to trust.
function parseCardText(rawText){
  const best = findBestCardMatch(rawText);
  if(best) return best.name;

  const lines = (rawText || '')
    .split('\n')
    .map(cleanOcrLine)
    .filter(l => l.length >= 2);

  if(!lines.length) return '';
  return lines.reduce((longest, l) => l.length > longest.length ? l : longest, lines[0]);
}
