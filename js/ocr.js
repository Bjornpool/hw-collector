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

// Grayscale -> contrast-stretch (min/max normalize) -> hard threshold to
// black/white, in place. Card print photographed off-angle under phone
// flash is low-contrast and noisy; Tesseract reads clean B/W dramatically
// better than the raw color crop.
function preprocessCanvasForOcr(canvas){
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const pixelCount = d.length / 4;

  const gray = new Uint8ClampedArray(pixelCount);
  let min = 255, max = 0;
  for(let i = 0, p = 0; p < pixelCount; i += 4, p++){
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    gray[p] = g;
    if(g < min) min = g;
    if(g > max) max = g;
  }

  const range = Math.max(1, max - min);
  const THRESHOLD = 128;
  for(let i = 0, p = 0; p < pixelCount; i += 4, p++){
    const stretched = (gray[p] - min) / range * 255;
    const bw = stretched > THRESHOLD ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = bw;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

// DEBUG: shows the exact preprocessed crop being fed to Tesseract.
// Remove this call (and the #ocr-debug-preview element/CSS) once scan
// accuracy has been validated on real cards.
function showOcrDebugPreview(canvas){
  const img = document.getElementById('ocr-debug-preview');
  if(img) img.src = canvas.toDataURL('image/png');
}

async function recognizeCardText(canvas){
  const worker = await getOcrWorker();

  preprocessCanvasForOcr(canvas);
  showOcrDebugPreview(canvas); // DEBUG

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

  return freeText + '\n' + codeText;
}

function cleanOcrLine(line){
  return line.replace(/[^\p{L}\p{N}\s\/#'-]/gu, '').replace(/\s+/g, ' ').trim();
}

// Doesn't do its own fuzzy matching — reuses the exact same matchesQuery()
// logic as global search (render.js) so "found a match" here means the
// global search box will show the same result. If no line matches
// anything in ALL_CARS, falls back to the longest cleaned line so the
// user still has something sensible to edit in the search box.
function parseCardText(rawText){
  const lines = (rawText || '')
    .split('\n')
    .map(cleanOcrLine)
    .filter(l => l.length >= 2);

  for(const line of lines){
    const q = line.toLowerCase().trim();
    const qn = parseInt(q, 10);
    const hit = ALL_CARS.some(c => canAccessYear(c.year) && matchesQuery(c, q, qn));
    if(hit) return line;
  }

  if(!lines.length) return '';
  return lines.reduce((best, l) => l.length > best.length ? l : best, lines[0]);
}
