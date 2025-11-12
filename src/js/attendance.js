import { $ } from './libs/element';
import updateClock from './libs/clock';

fetch('/api/get-state')
  .then((res) => res.json())
  .then(({ logs }) => {
    $('#recognitionLog').replaceChildren(
      ...logs.map((log) => {
        const p = $.create('p');
        const emoji = log.recognized ? '✅' : '❌';
        // Handle null/empty names gracefully
        const name = log.name && log.name.trim() ? log.name : 'Unrecognized Face';
        const dept = log.dept || log.role || '';
        const userInfo = log.user_id ? ` ${log.user_id}` : '';
        p.innerHTML = `<strong>${log.time}</strong> - ${emoji} ${name}${userInfo} ${dept ? '(' + dept + ')' : ''}`;

        return p;
      })
    );
  });

updateClock();

let stream;
let interval;
let landmarkInterval;
let recognizingInFlight = false;
let lastRecognize = 0;
const RECOGNIZE_COOLDOWN_MS = 700; // min ms between server recognition requests
const RECOGNIZE_MAX_WIDTH = 480; // scale frames down before upload to speed up server
// track last attendance timestamp per user to avoid duplicate logs
const lastAttendance = new Map();
const ATTENDANCE_COOLDOWN_MS = 5000; // 5 seconds

/** @type {HTMLVideoElement} */
const video = $('#cameraFeed');

// tuning constants 
const LANDMARK_POINT_SCALE = 0.015; // fraction of face width used for point radius (much smaller, almost invisible but still visible)
const LANDMARK_POINT_MAX = 4; // max radius in pixels (very small)
const BOX_PADDING_SCALE = 0.15; // fraction of face width for bounding box padding (bigger red box)
const JAW_EXTEND_RATIO = 1.15; // extend jaw points outward by 15% to fit sides better
// distance/ratio tuning (face box width as fraction of display width)
// Preferred/ideal face width ratio ~ 35% of display (du raya ru sakto na distance sa cam)
const IDEAL_FACE_RATIO = 0.35; // 35% is the target ratio for accurate detection
const RATIO_TOLERANCE = 0.08; // +/- tolerance around ideal (~8%)
const TOO_FAR_RATIO = Math.max(0.05, IDEAL_FACE_RATIO - RATIO_TOLERANCE); // too far if below this
const TOO_CLOSE_RATIO = Math.min(0.95, IDEAL_FACE_RATIO + RATIO_TOLERANCE); // too close if above this

// Camera control
async function startCamera() {
  if (stream) return;

  $('#recognitionLog').innerHTML = '';

  try {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;

    // create overlay for landmarks
    try {
      const parent = video.parentElement;
      if (parent) parent.style.position = parent.style.position || 'relative';

      let overlay = document.getElementById('cameraFeedOverlay');
      if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.id = 'cameraFeedOverlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.pointerEvents = 'none';
        parent.appendChild(overlay);
      }

      function resizeOverlay() {
        const rect = video.getBoundingClientRect();
        overlay.width = rect.width;
        overlay.height = rect.height;
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        overlay.style.left = video.offsetLeft + 'px';
        overlay.style.top = video.offsetTop + 'px';
      }

      window.addEventListener('resize', resizeOverlay);
      video.addEventListener('loadedmetadata', resizeOverlay);
      setTimeout(resizeOverlay, 300);

        // start client-side landmark stream (face-api.js)
        const FACEAPI_MODEL_URI = '/models';
        let faceApiModelsLoaded = false;

        async function loadFaceApiModels() {
          if (faceApiModelsLoaded) return;
          try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URI);
            await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URI);
            faceApiModelsLoaded = true;
            console.debug('face-api models loaded from', FACEAPI_MODEL_URI);
          } catch (err) {
            const remote = 'https://justadudewhohacks.github.io/face-api.js/models';
            console.warn('Loading face-api models from remote CDN', err);
            await faceapi.nets.tinyFaceDetector.loadFromUri(remote);
            await faceapi.nets.faceLandmark68Net.loadFromUri(remote);
            faceApiModelsLoaded = true;
            console.debug('face-api models loaded from remote CDN');
          }
        }

        landmarkInterval = setInterval(async () => {
          try {
            if (!faceApiModelsLoaded) await loadFaceApiModels();
            // use a moderate input size and permissive threshold for better detection
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.20 });
            // detect single face and landmarks directly from the video element
            const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
            const ctx = overlay.getContext('2d');
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            if (detection && detection.landmarks) {
                // resize detection coordinates to overlay/display size to avoid distortion
                const displaySize = { width: overlay.width, height: overlay.height };
                const resized = faceapi.resizeResults(detection, displaySize);
                const box = resized.detection.box; // { x, y, width, height } in overlay coords
                const pts = resized.landmarks.positions;

                // compute face ratio early so we can use it for both label and recognition trigger
                const faceRatio = (box.width || 0) / Math.max(displaySize.width, 1);

                // compute proportional radius based on detected face box width (in overlay pixels)
                const faceWidth = box.width || Math.max(displaySize.width * 0.2, 100);
                // make points smaller and clamp size so they don't overlap heavily
                const radius = Math.min(LANDMARK_POINT_MAX, Math.max(1, Math.round(faceWidth * LANDMARK_POINT_SCALE)));

                // draw bounding box around face (red) with large padding
                try {
                  const pad = Math.max(4, Math.round(faceWidth * BOX_PADDING_SCALE));
                  ctx.strokeStyle = 'rgba(200,40,40,0.95)';
                  ctx.lineWidth = Math.max(3, Math.round(faceWidth * 0.03));
                  ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
                } catch (err) {
                  // ignore box draw errors
                }

                // Draw only points (no path connections for less visual clutter)
                // Much smaller points so face is still clearly visible
                ctx.fillStyle = 'rgba(0,255,100,0.9)';
                ctx.strokeStyle = 'rgba(0,150,50,0.95)';
                const pointRadius = Math.min(LANDMARK_POINT_MAX, Math.max(0.8, Math.round(faceWidth * LANDMARK_POINT_SCALE)));
                
                // Extend jaw side points for better side fitting
                const drawPts = pts.map((pt, i) => {
                  if (i === 0 || i === 16) {
                    // i=0 is left jaw corner, i=16 is right jaw corner
                    const jawCenterX = (pts[0].x + pts[16].x) / 2;
                    const direction = i === 0 ? -1 : 1;
                    const offsetX = (pt.x - jawCenterX) * (JAW_EXTEND_RATIO - 1);
                    return { ...pt, x: pt.x + direction * Math.abs(offsetX) };
                  }
                  return pt;
                });
                
                drawPts.forEach((p) => {
                  ctx.beginPath();
                  ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.lineWidth = 1;
                  ctx.stroke();
                });

                // draw distance label based on face width ratio
                try {
                  let label = '';
                  let color = 'rgba(40,200,40,0.95)';

                  if (faceRatio < TOO_FAR_RATIO) {
                    label = 'Too Far';
                    color = 'rgba(220,140,20,0.95)';
                  } else if (faceRatio > TOO_CLOSE_RATIO) {
                    label = 'Too Close';
                    color = 'rgba(200,40,40,0.95)';
                  } else {
                    // within tolerance of ideal
                    label = 'Good';
                    color = 'rgba(40,200,40,0.95)';
                  }

                  // draw label background box in top-left of face box
                  const txt = label;
                  ctx.font = '14px Arial';
                  const padding = 6;
                  const metrics = ctx.measureText(txt);
                  const txtW = metrics.width;
                  const bx = Math.max(4, box.x);
                  const by = Math.max(4, box.y - 24);
                  ctx.fillStyle = 'rgba(0,0,0,0.6)';
                  ctx.fillRect(bx - 2, by - 2, txtW + padding, 20 + 4);
                  ctx.fillStyle = color;
                  ctx.fillText(txt, bx + padding / 2, by + 14);
                } catch (e) {
                  // ignore label draw errors
                }

                // Try to trigger recognition only when face is within acceptable range
                try {
                  const now = Date.now();
                  // don't trigger too frequently
                  if (!recognizingInFlight && (now - lastRecognize) >= RECOGNIZE_COOLDOWN_MS) {
                    // only recognize when face is in Good range (not too far, not too close)
                    if (faceRatio >= TOO_FAR_RATIO && faceRatio <= TOO_CLOSE_RATIO) {
                      console.debug('Recognition trigger: faceRatio=', faceRatio.toFixed(3), 'target range=[', TOO_FAR_RATIO.toFixed(3), ',', TOO_CLOSE_RATIO.toFixed(3), ']');
                      recognizingInFlight = true;
                      lastRecognize = now;
                      // capture a scaled frame and call recognition
                      (async () => {
                        try {
                          // scale canvas to RECOGNIZE_MAX_WIDTH while preserving aspect
                          const scale = Math.min(1, RECOGNIZE_MAX_WIDTH / video.videoWidth);
                          const w = Math.max(160, Math.round(video.videoWidth * scale));
                          const h = Math.max(120, Math.round(video.videoHeight * scale));
                          const c = document.createElement('canvas');
                          c.width = w;
                          c.height = h;
                          const cx = c.getContext('2d');
                          cx.drawImage(video, 0, 0, w, h);
                          const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
                          if (!blob) return;

                          // send to recognition endpoint
                          const form = new FormData();
                          form.append('image', blob, 'frame.jpg');
                          console.debug('Sending recognition request, blob bytes:', blob.size);
                          const res = await fetch('/api/recognize', { method: 'POST', body: form });
                          const text = await res.text();
                          console.debug('Recognition response (raw):', text);
                          let data;
                          try { data = JSON.parse(text); } catch (e) { data = { status: 'error', raw: text }; }

                          // reuse the existing response handling logic by calling a small handler
                          handleRecognitionResponse(data);
                        } catch (err) {
                          console.error('Recognition error', err);
                        } finally {
                          recognizingInFlight = false;
                        }
                      })();
                    }
                  }
                } catch (e) {
                  // ignore
                }
            } else {
              // draw a helpful message when no face is detected
              try {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = '16px Arial';
                const msg = 'No face detected';
                const m = ctx.measureText(msg);
                const x = Math.max(8, overlay.width / 2 - m.width / 2);
                const y = Math.max(24, overlay.height / 2 - 8);
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(x - 6, y - 18, m.width + 12, 26);
                ctx.fillStyle = 'white';
                ctx.fillText(msg, x, y);
              } catch (e) {
                // ignore
              }
            }
          } catch (e) {
            // ignore errors
          }
        }, 200);
    } catch (e) {
      console.warn('Failed to create landmark overlay', e);
    }
  } catch (err) {
    alert('Error accessing camera: ' + err);
  }
}

function capture() {
  const canvas = $.create('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    const formdata = new FormData();
    formdata.append('image', blob);
    // For backward compatibility keep capture behavior but use lighter payload.
    fetch('/api/recognize', { method: 'POST', body: formdata })
      .then(async (res) => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (err) {
          return { status: 'error', message: 'Invalid JSON from server', raw: text, httpStatus: res.status };
        }
      })
      .then((data) => {
        handleRecognitionResponse(data);
      })
      .catch((err) => {
        console.error('Recognition fetch error', err);
      });
  });
}

// common handler for recognition responses 
function handleRecognitionResponse(data) {
  const time = new Date().toLocaleTimeString();
  const list = $('#recognitionLog');

  if (data && data.status === 'success') {
    const uid = data.id != null ? String(data.id) : (data.name || 'unknown');
    const now = Date.now();
    const last = lastAttendance.get(uid) || 0;
    if (now - last >= ATTENDANCE_COOLDOWN_MS) {
      lastAttendance.set(uid, now);
      const log = $.create('div');
      const dept = data.dept || data.role || 'Unknown';
      log.textContent = `${time} - ✅ ${data.name} (${dept})`;
      list.insertBefore(log, list.firstChild);

      // mark attendance and refresh /api/get-state so DB reflects immediately in UI
      try {
        const at = new FormData();
        const sendUserId = (data && (data.id !== null && data.id !== undefined && data.id !== '')) ? data.id : -1;
        at.append('user_id', sendUserId);
        at.append('status', 'present');
        fetch('/api/add-to-attendance', { method: 'POST', body: at })
          .then(async (res) => {
            let json;
            try { json = await res.json(); } catch (e) { console.error('Attendance API returned non-JSON response', await res.text()); return; }
            if (!json || !json.success) {
              console.error('Attendance API error', json);
              const errEl = $.create('div');
              errEl.style.color = 'crimson';
              errEl.textContent = `${time} - ❌ Failed to save attendance: ${json && json.message ? json.message : 'unknown error'}`;
              list.insertBefore(errEl, list.firstChild);
            } else {
              // fetch fresh state so DB-backed views reflect immediately
              try { fetch('/api/get-state').then((r) => r.json()).then(({ logs }) => {
                $('#recognitionLog').replaceChildren(...logs.map((log) => { const p = $.create('p'); const emoji = log.recognized ? '✅' : '❌'; const dept = log.dept || log.role || ''; p.innerHTML = `<strong>${log.time}</strong> - ${emoji} ${log.name} ${log.user_id} ${dept ? '(' + dept + ')' : ''}`; return p; })); }); }
              catch (e) { /* ignore */ }
            }
          })
          .catch((e) => console.error('Failed to log attendance', e));
      } catch (e) {
        console.error('Failed to prepare attendance request', e);
      }
    } else {
      lastAttendance.set(uid, now);
    }

  } else if (data && (data.status === 'forbidden' || data.status === 'unrecognized')) {
    const log = $.create('div');
    log.textContent = `${time} - ❌ Unrecognized Face`;
    list.insertBefore(log, list.firstChild);

    try {
      const at = new FormData();
      at.append('user_id', -1);
      at.append('status', 'unrecognized');
      fetch('/api/add-to-attendance', { method: 'POST', body: at })
        .then(async (res) => {
          let json;
          try { json = await res.json(); } catch (e) { console.error('Attendance API returned non-JSON response', await res.text()); return; }
          if (!json || !json.success) {
            console.error('Attendance API error', json);
            const errEl = $.create('div');
            errEl.style.color = 'crimson';
            errEl.textContent = `${time} - ❌ Failed to save unrecognized log: ${json && json.message ? json.message : 'unknown error'}`;
            list.insertBefore(errEl, list.firstChild);
          } else {
            try { fetch('/api/get-state').then((r) => r.json()).then(({ logs }) => {
              $('#recognitionLog').replaceChildren(...logs.map((log) => { const p = $.create('p'); const emoji = log.recognized ? '✅' : '❌'; const dept = log.dept || log.role || ''; p.innerHTML = `<strong>${log.time}</strong> - ${emoji} ${log.name} ${log.user_id} ${dept ? '(' + dept + ')' : ''}`; return p; })); }); }
            catch (e) { /* ignore */ }
          }
        })
        .catch((e) => console.error('Failed to log unrecognized', e));
    } catch (e) {
      console.error('Failed to prepare unrecognized attendance request', e);
    }

  } else {
    // if recognition engine returned an error payload, surface it in the UI for debugging
    if (data && data.status === 'error') {
      console.error('Recognition engine error', data.raw || data.message || data);
      const errEl = $.create('div');
      errEl.style.color = 'crimson';
      errEl.textContent = `${time} - ❌ Recognition error`; 
      list.insertBefore(errEl, list.firstChild);
      // if raw text available, include a short snippet
      if (data.raw) {
        const snippet = $.create('div');
        snippet.style.fontSize = '11px';
        snippet.style.color = '#ccc';
        snippet.textContent = data.raw.slice(0, 200);
        list.insertBefore(snippet, list.firstChild);
      }
    } else {
      console.debug('Recognition engine returned non-standard response', data);
    }
  }
}

function stopCamera() {
  if (!stream) return;

  let tracks = stream.getTracks();
  tracks.forEach((track) => track.stop());
  video.srcObject = null;

  stream = undefined;

  clearInterval(interval);
  interval = undefined;
  if (landmarkInterval) {
    clearInterval(landmarkInterval);
    landmarkInterval = undefined;
  }
  const overlay = document.getElementById('cameraFeedOverlay');
  if (overlay && overlay.getContext) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width || 0, overlay.height || 0);
  }
}

$('#start-camera').onclick = startCamera;
$('#stop-camera').onclick = stopCamera;
