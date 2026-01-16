let cvReady = false;
let currentMode = 'sequence'; // 'sequence' or 'pairs'
let isProcessing = false;
let detectedSteps = [];
let mediaSource = null; // Stores the loaded Image or Video element

const MODES = {
    'sequence': { rows: 5, cols: 4, gridId: 'grid-sequence', panelId: 'panel-sequence', sliders: ['seqTop', 'seqBot', 'seqSide'] },
    'pairs':    { rows: 7, cols: 4, gridId: 'grid-pairs',    panelId: 'panel-pairs',    sliders: ['pairTop', 'pairBot', 'pairSide'] }
};

// --- INIT ---
function onOpenCvReady() {
    cvReady = true;
    updateStatus("Ready. Upload a file.");
    initGrids();
}

function initGrids() {
    Object.keys(MODES).forEach(mode => {
        const cfg = MODES[mode];
        const gridEl = document.getElementById(cfg.gridId);
        gridEl.innerHTML = '';
        for (let i = 0; i < cfg.rows * cfg.cols; i++) {
            let d = document.createElement('div');
            d.className = 'cell'; d.id = `${mode}-c-${i}`;
            gridEl.appendChild(d);
        }
    });
}

// --- UI HANDLING ---
function switchMode(mode) {
    currentMode = mode;
    // Buttons
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(mode.includes('seq') ? 'video' : 'image')));
    
    // Panels & Grids
    document.querySelectorAll('.control-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.game-grid').forEach(g => g.classList.remove('active'));
    
    document.getElementById(MODES[mode].panelId).classList.add('active');
    document.getElementById(MODES[mode].gridId).classList.add('active');

    // Force redraw overlay if media is loaded
    if (mediaSource) drawGridOverlay();
    checkButtons();
}

function updateStatus(msg) { document.getElementById('status').innerText = msg; }

const videoPlayer = document.getElementById('videoPlayer');
const imgPreview = document.getElementById('imgPreview');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const procCanvas = document.getElementById('procCanvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

// FILE UPLOAD HANDLER
document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const isImage = file.type.startsWith('image');

    // Reset Display
    videoPlayer.classList.remove('visible');
    imgPreview.classList.remove('visible');
    videoPlayer.pause();

    if (isVideo) {
        mediaSource = videoPlayer;
        videoPlayer.src = url;
        videoPlayer.classList.add('visible');
        videoPlayer.onloadedmetadata = () => {
             resizeCanvas(videoPlayer.videoWidth, videoPlayer.videoHeight);
             updateStatus("Video Loaded. Switch to Video Mode if needed.");
             switchMode('sequence'); // Auto-switch to convenient mode
        };
    } else if (isImage) {
        mediaSource = imgPreview;
        imgPreview.src = url;
        imgPreview.onload = () => {
            imgPreview.classList.add('visible');
            resizeCanvas(imgPreview.naturalWidth, imgPreview.naturalHeight);
            updateStatus("Image Loaded. Switch to Image Mode if needed.");
            switchMode('pairs'); // Auto-switch to convenient mode
        };
    }
});

function resizeCanvas(w, h) {
    overlayCanvas.width = procCanvas.width = w;
    overlayCanvas.height = procCanvas.height = h;
    drawGridOverlay();
    checkButtons();
}

// Slider Listeners
['seqTop', 'seqBot', 'seqSide', 'pairTop', 'pairBot', 'pairSide'].forEach(id => {
    document.getElementById(id).addEventListener('input', drawGridOverlay);
});

function checkButtons() {
    const hasMedia = mediaSource && (mediaSource.videoWidth > 0 || mediaSource.naturalWidth > 0);
    document.getElementById('btnStartSequence').disabled = !(cvReady && hasMedia && mediaSource.tagName === 'VIDEO');
    document.getElementById('btnFindPairs').disabled = !(cvReady && hasMedia && mediaSource.tagName === 'IMG');
}

// --- SHARED CALCULATION ---
function getZones(mode) {
    if (!mediaSource) return [];
    const cfg = MODES[mode];
    
    // Get dimensions based on source type
    const w = mediaSource.tagName === 'VIDEO' ? mediaSource.videoWidth : mediaSource.naturalWidth;
    const h = mediaSource.tagName === 'VIDEO' ? mediaSource.videoHeight : mediaSource.naturalHeight;

    const sTop = parseInt(document.getElementById(cfg.sliders[0]).value) / 100;
    const sBot = parseInt(document.getElementById(cfg.sliders[1]).value) / 100;
    const sSide = parseInt(document.getElementById(cfg.sliders[2]).value) / 100;

    const startX = w * sSide; const endX = w * (1 - sSide);
    const startY = h * sTop;  const endY = h * (1 - sBot);
    const boxW = (endX - startX) / cfg.cols;
    const boxH = (endY - startY) / cfg.rows;

    let zones = [];
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            zones.push({
                id: (r * cfg.cols) + c,
                x: Math.floor(startX + c * boxW),
                y: Math.floor(startY + r * boxH),
                w: Math.floor(boxW),
                h: Math.floor(boxH),
                centerX: Math.floor(startX + c * boxW + boxW / 2),
                centerY: Math.floor(startY + r * boxH + boxH / 2)
            });
        }
    }
    return zones;
}

function drawGridOverlay() {
    if (!mediaSource) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const zones = getZones(currentMode);
    overlayCtx.strokeStyle = currentMode === 'sequence' ? "#00ff00" : "#00cec9";
    overlayCtx.lineWidth = 4; // Thicker lines for visibility
    overlayCtx.beginPath();
    zones.forEach(z => overlayCtx.rect(z.x, z.y, z.w, z.h));
    overlayCtx.stroke();
}

// ================= MODE A: VIDEO SEQUENCE =================
document.getElementById('btnStartSequence').addEventListener('click', runSequenceAnalysis);

async function runSequenceAnalysis() {
    isProcessing = true;
    detectedSteps = [];
    resetUI('sequence');
    const zones = getZones('sequence').map(z => ({...z, locked: false}));
    let stepCount = 1; let cooldown = 0;
    
    let cap = new cv.VideoCapture(videoPlayer);
    let frame = new cv.Mat(videoPlayer.videoHeight, videoPlayer.videoWidth, cv.CV_8UC4);
    let gray = new cv.Mat(), prevGray = new cv.Mat(), diff = new cv.Mat();
    const interval = 1/15; let currentTime = 0;

    async function loop() {
        if (currentTime >= videoPlayer.duration || currentMode !== 'sequence') {
            finishAnalysis(frame, gray, prevGray, diff); return;
        }
        videoPlayer.currentTime = currentTime;
        await new Promise(r => videoPlayer.onseeked = r);
        procCtx.drawImage(videoPlayer, 0, 0);
        cap.read(frame);
        cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

        if (!prevGray.empty() && cooldown <= 0) {
            cv.absdiff(gray, prevGray, diff);
            cv.threshold(diff, diff, 45, 255, cv.THRESH_BINARY);
            let changes = [];
            zones.forEach(z => {
                if (z.locked) return;
                let roi = diff.roi(new cv.Rect(z.x+z.w*0.1, z.y+z.h*0.1, z.w*0.8, z.h*0.8));
                if (cv.countNonZero(roi) > (z.w*z.h * 0.15)) changes.push(z);
                roi.delete();
            });
            if (changes.length > 0 && changes.length <= 2) {
                let z = changes[0]; z.locked = true;
                updateCellUI('sequence', z.id, stepCount);
                detectedSteps.push({step: stepCount++, x: z.centerX, y: z.centerY});
                cooldown = 4;
            }
        }
        if (cooldown > 0) cooldown--;
        gray.copyTo(prevGray);
        currentTime += interval;
        requestAnimationFrame(loop);
    }
    loop();
}

// ================= MODE B: IMAGE PAIRS =================
document.getElementById('btnFindPairs').addEventListener('click', runPairAnalysis);

async function runPairAnalysis() {
    isProcessing = true;
    detectedSteps = [];
    resetUI('pairs');
    updateStatus("Processing Image...");

    // 1. Draw Image to Process Canvas
    procCtx.drawImage(imgPreview, 0, 0, procCanvas.width, procCanvas.height);
    
    // 2. Read into OpenCV
    let src = cv.imread(procCanvas);
    let grayFr = new cv.Mat();
    cv.cvtColor(src, grayFr, cv.COLOR_RGBA2GRAY);
    
    const zones = getZones('pairs');
    let cellMats = [];
    let validZones = []; // To map back to coordinates

    // 3. Crop and Resize Cells
    zones.forEach(z => {
        // Crop inner 60% (avoid borders)
        let roiRect = new cv.Rect(z.x + z.w*0.2, z.y + z.h*0.2, z.w*0.6, z.h*0.6);
        if (roiRect.x + roiRect.width > grayFr.cols || roiRect.y + roiRect.height > grayFr.rows) return;

        let cropped = grayFr.roi(roiRect);
        let resized = new cv.Mat();
        cv.resize(cropped, resized, new cv.Size(32, 32)); // Standardize size
        cellMats.push({id: z.id, mat: resized});
        validZones.push(z);
        cropped.delete();
    });

    // 4. Compare Cells
    let matchedIds = new Set();
    let stepCounter = 1;

    for (let i = 0; i < cellMats.length; i++) {
        if (matchedIds.has(cellMats[i].id)) continue;
        
        let bestMatch = -1;
        let minDiff = Number.MAX_VALUE;

        for (let j = i + 1; j < cellMats.length; j++) {
            if (matchedIds.has(cellMats[j].id)) continue;
            
            let diffMat = new cv.Mat();
            cv.absdiff(cellMats[i].mat, cellMats[j].mat, diffMat);
            cv.threshold(diffMat, diffMat, 50, 255, cv.THRESH_BINARY);
            let diffCount = cv.countNonZero(diffMat);
            diffMat.delete();

            // Sensitivity: Allow some noise
            if (diffCount < 100 && diffCount < minDiff) { 
                minDiff = diffCount;
                bestMatch = j;
            }
        }

        if (bestMatch !== -1) {
            const c1 = cellMats[i].id;
            const c2 = cellMats[bestMatch].id;
            matchedIds.add(c1); matchedIds.add(c2);
            
            updateCellUI('pairs', c1, stepCounter);
            updateCellUI('pairs', c2, stepCounter+1);
            
            // Save Pairs in Order: 1, 2... then 3, 4
            detectedSteps.push({step: stepCounter++, x: validZones[i].centerX, y: validZones[i].centerY});
            detectedSteps.push({step: stepCounter++, x: validZones[bestMatch].centerX, y: validZones[bestMatch].centerY});
        }
    }

    // Clean up
    src.delete(); grayFr.delete();
    cellMats.forEach(cm => cm.mat.delete());
    finishAnalysis();
    updateStatus(`Found ${Math.floor(detectedSteps.length/2)} pairs.`);
}

// --- HELPERS ---
function resetUI(mode) {
    document.querySelectorAll(`#grid-${mode} .cell`).forEach(c => { c.className = 'cell'; c.innerHTML = ''; });
}

function updateCellUI(mode, id, text) {
    const cell = document.getElementById(`${mode}-c-${id}`);
    if (cell) {
        cell.classList.add('detected');
        cell.innerHTML = `<span>${text}</span>`;
    }
}

function finishAnalysis(m1, m2, m3, m4) {
    isProcessing = false;
    [m1,m2,m3,m4].forEach(m => { if(m && !m.isDeleted) m.delete(); });
    document.getElementById('btnDownloadKeyMapper').disabled = detectedSteps.length === 0;
}

// --- KEY MAPPER GENERATOR ---
document.getElementById('btnDownloadKeyMapper').addEventListener('click', () => {
    if (detectedSteps.length === 0) return;
    detectedSteps.sort((a, b) => a.step - b.step);

    let actionList = detectedSteps.map((s, index) => {
        // Pairs logic: fast tap between pair (200ms), slow wait after pair (800ms)
        const isEndOfPair = (index % 2 !== 0); 
        const delay = isEndOfPair ? "800" : "200"; 

        return {
            "type": "TAP_COORDINATE",
            "data": `${s.x},${s.y}`,
            "flags": 0, "uid": crypto.randomUUID(),
            "extras": [
                { "id": "extra_coordinate_description", "data": `Step ${s.step}` },
                { "id": "extra_delay_before_next_action", "data": delay }
            ]
        };
    });

    const keyMapperData = {
        "app_version": 63, "keymap_db_version": 13,
        "fingerprint_map_list": [{"action_list":[],"constraints":[],"constraint_mode":1,"extras":[],"flags":0,"id":0,"enabled":true}],
        "keymap_list": [{
            "id": 1, "uid": crypto.randomUUID(), "isEnabled": true, "flags": 0, "constraintMode": 1,
            "trigger": { "mode": 2, "flags": 0, "keys": [{ "keyCode": 24, "clickType": 2, "flags": 0, "deviceId": "io.github.sds100.keymapper.THIS_DEVICE", "uid": crypto.randomUUID() }] },
            "actionList": actionList
        }]
    };
    
    const blob = new Blob([JSON.stringify(keyMapperData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `KeyMapper_Pairs.json`;
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(url);
});