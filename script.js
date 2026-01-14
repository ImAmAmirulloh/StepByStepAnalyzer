let cvReady = false;
const ROWS = 5;
const COLS = 4;
const TOTAL_CELLS = 20;
let gridRegions = []; // Stores coordinates of the 20 cells

// 1. Initialize Grid UI
const gridContainer = document.getElementById('grid');
for (let i = 0; i < TOTAL_CELLS; i++) {
    let div = document.createElement('div');
    div.className = 'cell';
    div.id = `cell-${i}`;
    gridContainer.appendChild(div);
}

// 2. OpenCV Loader
function onOpenCvReady() {
    cvReady = true;
    document.getElementById('status').innerText = "Ready. Upload a video.";
    document.getElementById('processBtn').disabled = false;
}

// 3. Handle File Upload
document.getElementById('videoInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        document.getElementById('videoPlayer').src = url;
        document.getElementById('status').innerText = "Video loaded. Click Analyze.";
    }
});

document.getElementById('processBtn').addEventListener('click', startProcessing);

// 4. Core Processing Logic
async function startProcessing() {
    const video = document.getElementById('videoPlayer');
    const canvas = document.getElementById('processCanvas');
    const ctx = canvas.getContext('2d');
    const status = document.getElementById('status');

    if (!cvReady) return;

    // Wait for metadata to get dimensions
    if (video.readyState < 1) {
        await new Promise(r => video.addEventListener('loadedmetadata', r, {once:true}));
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;

    // CALCULATE GRID ZONES based on video size
    // Assuming the game board takes up most of the screen (adjust margins if needed)
    // Margins: Top 15%, Bottom 15%, Left 5%, Right 5%
    calculateGridZones(w, h, 0.15, 0.85, 0.05, 0.95);

    let cap = new cv.VideoCapture(video);
    let frame = new cv.Mat(h, w, cv.CV_8UC4);
    let gray = new cv.Mat();
    let prevGray = new cv.Mat();
    let diff = new cv.Mat();

    let stepCount = 1;
    let lastDetectedCell = -1;
    let cooldownFrames = 0; // Prevent double counting same flip

    status.innerText = "Processing... do not close tab.";

    const FPS = 30;
    const processInterval = 1 / 10; // Check every 0.1 seconds of video time
    let currentTime = 0;
    const duration = video.duration;

    // Processing Loop
    const processLoop = async () => {
        if (currentTime >= duration) {
            status.innerText = "Analysis Complete!";
            frame.delete(); gray.delete(); prevGray.delete(); diff.delete();
            return;
        }

        // Seek video
        video.currentTime = currentTime;
        await new Promise(r => {
             const h = () => { video.removeEventListener('seeked', h); r(); };
             video.addEventListener('seeked', h);
        });

        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, w, h);
        
        // Read into OpenCV
        let src = cv.imread(canvas);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        if (!prevGray.empty()) {
            // Calculate absolute difference between frames
            cv.absdiff(gray, prevGray, diff);
            // Threshold to binary (black/white)
            cv.threshold(diff, diff, 35, 255, cv.THRESH_BINARY);

            // Find Contours (areas of change)
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(diff, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestRect = null;

            // Find the largest change (the card flipping)
            for (let i = 0; i < contours.size(); ++i) {
                let rect = cv.boundingRect(contours.get(i));
                let area = rect.width * rect.height;
                // Filter out small noise or full screen wipes
                if (area > 500 && area < (w * h * 0.8)) {
                    if (area > maxArea) {
                        maxArea = area;
                        bestRect = rect;
                    }
                }
            }

            contours.delete(); hierarchy.delete();

            // Map change to Grid
            if (bestRect && cooldownFrames <= 0) {
                let centerX = bestRect.x + bestRect.width / 2;
                let centerY = bestRect.y + bestRect.height / 2;
                
                let cellIndex = getCellIndex(centerX, centerY);

                // If valid cell and different from the immediate last one
                if (cellIndex !== -1 && cellIndex !== lastDetectedCell) {
                    updateUI(cellIndex, stepCount);
                    lastDetectedCell = cellIndex;
                    stepCount++;
                    cooldownFrames = 3; // Skip next 3 checks to let animation finish
                }
            }
        }

        if (cooldownFrames > 0) cooldownFrames--;

        // Update previous frame
        gray.copyTo(prevGray);
        src.delete();

        // Increment time
        currentTime += processInterval;
        requestAnimationFrame(processLoop);
    };

    processLoop();
}

// Helpers
function calculateGridZones(w, h, topPct, botPct, leftPct, rightPct) {
    gridRegions = [];
    
    // Playable area dimensions
    const startY = h * topPct;
    const endY = h * botPct;
    const startX = w * leftPct;
    const endX = w * rightPct;

    const cellW = (endX - startX) / COLS;
    const cellH = (endY - startY) / ROWS;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            gridRegions.push({
                x: startX + c * cellW,
                y: startY + r * cellH,
                w: cellW,
                h: cellH
            });
        }
    }
}

function getCellIndex(x, y) {
    for (let i = 0; i < gridRegions.length; i++) {
        let r = gridRegions[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            return i;
        }
    }
    return -1;
}

function updateUI(index, step) {
    const cell = document.getElementById(`cell-${index}`);
    if (cell) {
        cell.classList.add('detected');
        cell.innerHTML = `<span class="step-number">${step}</span>`;
        // Save to local storage if needed
        let history = JSON.parse(localStorage.getItem('gameSteps') || "[]");
        history.push({ step, index });
        localStorage.setItem('gameSteps', JSON.stringify(history));
    }
}
