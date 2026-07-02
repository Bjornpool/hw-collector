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

async function recognizeCardText(canvas){
  const worker = await getOcrWorker();

  // Pass 1: unrestricted charset — best for the car name / series text.
  await worker.setParameters({ tessedit_char_whitelist: '' });
  const { data: { text: freeText } } = await worker.recognize(canvas);

  // Pass 2: digits/slash/uppercase only — tuned for Col#/Toy# tokens.
  await worker.setParameters({ tessedit_char_whitelist: OCR_CODE_WHITELIST });
  const { data: { text: codeText } } = await worker.recognize(canvas);
  await worker.setParameters({ tessedit_char_whitelist: '' }); // leave worker clean for next scan

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
