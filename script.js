let cvReady = false;
const ROWS = 5;
const COLS = 4;
let zones = []; 
let currentStep = 1;

// Initialize Grid
const gridEl = document.getElementById('grid');
for(let i=0; i<20; i++) {
    let d = document.createElement('div');
    d.className = 'cell';
    d.id = `c-${i}`;
    gridEl.appendChild(d);
}

function onOpenCvReady() {
    cvReady = true;
    document.getElementById('status').innerText = "Ready. Upload video.";
    document.getElementById('processBtn').disabled = false;
}

// UI Handlers
const videoInput = document.getElementById('videoInput');
const videoPlayer = document.getElementById('videoPlayer');
const debugCheckbox = document.getElementById('showDebug');
const videoContainer = document.getElementById('videoContainer');

videoInput.addEventListener('change', (e) => {
    if(e.target.files[0]) {
        videoPlayer.src = URL.createObjectURL(e.target.files[0]);
        document.getElementById('status').innerText = "Video Loaded.";
    }
});

debugCheckbox.addEventListener('change', (e) => {
    videoContainer.classList.toggle('show', e.target.checked);
});

document.getElementById('processBtn').addEventListener('click', startAnalysis);

async function startAnalysis() {
    if(!cvReady) return;
    
    // Reset Grid
    document.querySelectorAll('.cell').forEach(c => {
        c.className = 'cell';
        c.innerText = '';
    });
    currentStep = 1;
    zones = [];

    const procCanvas = document.getElementById('procCanvas');
    const ctx = procCanvas.getContext('2d', {willReadFrequently: true});
    const debugCanvas = document.getElementById('debugCanvas');
    const debugCtx = debugCanvas.getContext('2d');

    // Wait for metadata
    if(videoPlayer.readyState < 1) {
        await new Promise(r => videoPlayer.addEventListener('loadedmetadata', r, {once:true}));
    }

    const w = videoPlayer.videoWidth;
    const h = videoPlayer.videoHeight;
    procCanvas.width = w; procCanvas.height = h;
    debugCanvas.width = w; debugCanvas.height = h;

    // --- DEFINE ZONES (The "Focus Areas") ---
    // Adjust these margins if the grid doesn't align
    const marginX = w * 0.05; // 5% left/right margin
    const marginY = h * 0.15; // 15% top margin (skips header)
    const gridW = w - (marginX * 2);
    const gridH = h * 0.70;   // Uses 70% of screen height
    
    const cellW = gridW / COLS;
    const cellH = gridH / ROWS;

    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            zones.push({
                id: (r*COLS) + c,
                x: Math.floor(marginX + (c * cellW)),
                y: Math.floor(marginY + (r * cellH)),
                w: Math.floor(cellW),
                h: Math.floor(cellH),
                locked: false // Ensure we only detect once
            });
        }
    }

    // Processing vars
    let cap = new cv.VideoCapture(videoPlayer);
    let frame = new cv.Mat(h, w, cv.CV_8UC4);
    let gray = new cv.Mat();
    let prevGray = new cv.Mat();
    let diff = new cv.Mat();
    
    let cooldown = 0;
    const TOTAL_FRAMES = 100; // Sample rate (not actual frames)

    // Helper to draw debug boxes
    function drawDebug() {
        if(!debugCheckbox.checked) return;
        debugCtx.clearRect(0,0,w,h);
        debugCtx.strokeStyle = "red";
        debugCtx.lineWidth = 2;
        zones.forEach(z => {
            debugCtx.strokeStyle = z.locked ? "#00ff00" : "red"; // Green if found
            debugCtx.strokeRect(z.x, z.y, z.w, z.h);
        });
    }

    // Analysis Loop
    const fps = 30;
    const interval = 1/15; // Process 15 times per second video time
    let currentTime = 0;
    const duration = videoPlayer.duration;
    
    document.getElementById('status').innerText = "Analyzing...";

    async function loop() {
        if(currentTime >= duration) {
            document.getElementById('status').innerText = "Done!";
            frame.delete(); gray.delete(); prevGray.delete(); diff.delete();
            return;
        }

        videoPlayer.currentTime = currentTime;
        await new Promise(r => {
             const h = () => { videoPlayer.removeEventListener('seeked', h); r(); };
             videoPlayer.addEventListener('seeked', h);
        });

        ctx.drawImage(videoPlayer, 0, 0, w, h);
        let src = cv.imread(procCanvas);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Process frame
        if(!prevGray.empty() && cooldown <= 0) {
            cv.absdiff(gray, prevGray, diff);
            cv.threshold(diff, diff, 40, 255, cv.THRESH_BINARY);

            let changedZones = [];

            // Check each zone individually
            zones.forEach(z => {
                if(z.locked) return;

                // Create ROI for this specific cell
                let rect = new cv.Rect(z.x, z.y, z.w, z.h);
                let roi = diff.roi(rect);
                
                // Count changed pixels
                let count = cv.countNonZero(roi);
                let area = z.w * z.h;
                
                // Threshold: If >15% of the cell changed, it's a candidate
                if(count > (area * 0.15)) {
                    changedZones.push(z);
                }
                roi.delete();
            });

            // LOGIC: If exactly 1 or 2 zones change, it's a flip.
            // If >3 zones change, it's a global animation (like "LOOK" text), so IGNORE.
            if(changedZones.length > 0 && changedZones.length < 3) {
                let z = changedZones[0]; // Take the first one
                z.locked = true;
                
                // Update UI
                let cell = document.getElementById(`c-${z.id}`);
                cell.classList.add('detected');
                cell.innerText = currentStep;
                
                currentStep++;
                cooldown = 5; // Skip next 5 checks (approx 0.3s)
            }
        }

        if(cooldown > 0) cooldown--;

        drawDebug(); // Update red boxes
        gray.copyTo(prevGray);
        src.delete();

        currentTime += interval;
        requestAnimationFrame(loop);
    }

    loop();
}
