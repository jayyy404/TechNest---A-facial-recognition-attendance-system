import { checkIfAdminLoggedIn, confirmIfAdmin } from './admin';
import updateClock from './libs/clock';
import { $ } from './libs/element';

// Simple users management and client-side face capture using face-api.js
let users = [];
let capturedPhotos = [];
let currentPreviewIndex = 0; // for carousel preview

const FACEAPI_MODEL_URI = '/models'; // change to local models folder or keep default fallback
let faceApiModelsLoaded = false;
// tuning constants for landmark visuals
const LANDMARK_POINT_SCALE = 0.015; // fraction of face width used for point radius
const LANDMARK_POINT_MAX = 4; // max radius in pixels
const JAW_EXTEND_RATIO = 1.15; // extend jaw points outward by 15% to fit sides better

function configureVideoLighting(videoElement) {
  if (!videoElement) return;
  videoElement.style.filter = 'brightness(1.1) contrast(1.15) saturate(1.1)';
  console.debug('[Camera] Lighting configuration applied: brightness(1.1) contrast(1.15) saturate(1.1)');
}

function loadUsers() {
  return fetch('/api/get-state')
    .then((res) => res.json())
    .then((data) => {
      users = [...(data.users || [])];
      updateTable();
    });
}

function updateTable() {
  $('#userTable').replaceChildren(
    ...filterUsers().map((user) => {
      const tr = $.create('tr');
      tr.innerHTML = `
        <td>${user.name}</td>
        <td>${user.id}</td>
        <td>${user.role}</td>
      `;

      const editUserBtn = $.create('button');
      const deleteUserBtn = $.create('button');

      editUserBtn.onclick = () => editUser(user.id);
      deleteUserBtn.onclick = () => deleteUser(user.id);

      editUserBtn.innerHTML = 'Edit';
      deleteUserBtn.innerHTML = 'Delete';

      editUserBtn.className = 'btn';
      deleteUserBtn.className = 'btn secondary';

      const td = $.create('td');
      td.append(editUserBtn, deleteUserBtn);
      tr.append(td);
      return tr;
    })
  );
}

function filterUsers() {
  const searchValue = $('#searchInput').value.toLowerCase();
  return users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchValue) ||
      (u.id || '').toLowerCase().includes(searchValue) ||
      (u.role || '').toLowerCase().includes(searchValue)
  );
}

async function saveUserData(e) {
  e.preventDefault();
  const userData = new FormData($('#user-form'));

  // Append captured photos as files
  await Promise.all(
    capturedPhotos.map(async (uri, index) => {
      const blob = await (await fetch(uri)).blob();
      const file = new File([blob], `${userData.get('name') || 'user'}-image-${index}.png`, { type: blob.type });
      userData.append('file[]', file, file.name);
    })
  );

  fetch('/api/update-user', {
    method: 'POST',
    body: userData,
  }).then(async (res) => {
    try {
      const text = await res.text();
      const data = JSON.parse(text);
      if (data && data.success) {
        closeUserModal();
        loadUsers();
        alert('User saved successfully!');
      } else {
        console.error('Failed to save user:', data);
        alert('Error: ' + (data && data.message ? data.message : 'Failed to save user'));
      }
    } catch (e) {
      console.error('Failed to parse response:', e, text);
      if (res.ok) {
        closeUserModal();
        loadUsers();
      } else {
        alert('Error saving user: ' + e.message);
      }
    }
  }).catch((err) => {
    console.error('Network error saving user:', err);
    alert('Network error: ' + err.message);
  });
}

function addNewUser() {
  clearPhotos();
  currentPreviewIndex = 0;
  clearForm();
  $('#modalTitle').innerText = `Add New User`;
  $('#userModal').style.removeProperty('display');
  startCamera();
  ensureCaptureButton();
}

function ensureCaptureButton() {
  const cap = document.getElementById('capture-photo');
  if (cap) cap.onclick = startAutoCapture;
}

function editUser(id) {
  clearPhotos();
  currentPreviewIndex = 0;
  clearForm();
  startCamera();
  ensureCaptureButton();

  const user = users.find((u) => u.id === id);
  if (!user) return;

  $('#modalTitle').innerText = `Edit User`;
  $('#userModal').style.removeProperty('display');

  $('#uid').value = user.id || '';
  $('#uname').value = user.name || '';
  $('#urole').value = user.role || '';
  $('#udept').value = user.dept || '';
  $('#uusername').value = user.username || '';

  try {
    capturedPhotos = JSON.parse(user.photo || '[]');
  } catch (e) {
    capturedPhotos = [];
  }
  updatePreview();
}

function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const formData = new FormData();
  formData.set('id', id);
  fetch('/api/delete-user', { method: 'POST', body: formData }).then((res) => {
    if (res.ok) loadUsers();
  });
}

function closeUserModal() {
  stopAutoCapture();
  stopCamera();
  $('#userModal').style.display = 'none';
}

function clearForm() {
  $('#user-form').reset();
}

function updatePreview() {
  const preview = $('#preview');
  if (capturedPhotos.length === 0) {
    preview.innerHTML = 'No photo';
    currentPreviewIndex = 0;
  } else {
    // Show current image and progress
    const img = $.create('img');
    img.src = capturedPhotos[currentPreviewIndex];
    img.style.maxWidth = '100%';
    img.style.maxHeight = '400px';
    img.style.objectFit = 'contain';
    img.style.marginBottom = '12px';

    const progress = $.create('div');
    progress.style.marginBottom = '12px';
    progress.style.textAlign = 'center';
    progress.style.fontSize = '16px';
    progress.style.fontWeight = 'bold';
    progress.innerText = `${currentPreviewIndex + 1}/${capturedPhotos.length}`;

    const navContainer = $.create('div');
    navContainer.style.display = 'flex';
    navContainer.style.gap = '8px';
    navContainer.style.justifyContent = 'center';
    navContainer.style.marginTop = '8px';

    const prevBtn = $.create('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn';
    prevBtn.innerText = '◀ Prev';
    prevBtn.disabled = currentPreviewIndex === 0;
    prevBtn.style.flex = '1';
    prevBtn.onclick = () => {
      if (currentPreviewIndex > 0) {
        currentPreviewIndex--;
        updatePreview();
      }
    };

    const nextBtn = $.create('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn';
    nextBtn.innerText = 'Next ▶';
    nextBtn.disabled = currentPreviewIndex === capturedPhotos.length - 1;
    nextBtn.style.flex = '1';
    nextBtn.onclick = () => {
      if (currentPreviewIndex < capturedPhotos.length - 1) {
        currentPreviewIndex++;
        updatePreview();
      }
    };

    navContainer.append(prevBtn, nextBtn);
    preview.replaceChildren(img, progress, navContainer);
  }
}

let cameraStream;
let autoCaptureInterval = null;
let autoCaptureRunning = false;
let liveLandmarkInterval = null;

async function startCamera() {
  if (cameraStream) return;
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  $('#camera').srcObject = cameraStream;
  configureVideoLighting($('#camera'));

  try {
    const video = $('#camera');
    const parent = video.parentElement;
    if (parent) parent.style.position = parent.style.position || 'relative';

    let overlay = document.getElementById('cameraOverlay');
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.id = 'cameraOverlay';
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

    startClientLandmarkStream();
  } catch (e) {
    console.warn('Failed to create camera overlay', e);
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  const overlay = document.getElementById('cameraOverlay');
  if (overlay && overlay.getContext) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width || 0, overlay.height || 0);
  }
  stopClientLandmarkStream();
}

function capture() {
  const video = $('#camera');
  const canvas = $.create('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const photo = canvas.toDataURL('image/png');
  capturedPhotos.push(photo);
  updatePreview();
}

function stopAutoCapture() {
  if (autoCaptureInterval) clearInterval(autoCaptureInterval);
  autoCaptureInterval = null;
  autoCaptureRunning = false;
}

async function startAutoCapture() {
  if (autoCaptureRunning) return;
  autoCaptureRunning = true;
  clearPhotos();

  if (!faceApiModelsLoaded) await loadFaceApiModels();

  const tryCapture = async () => {
    if (!cameraStream) return;
    const video = $('#camera');
    if (!video || video.videoWidth === 0) return;

    const canvas = $.create('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 });
      const detection = await faceapi.detectSingleFace(canvas, options).withFaceLandmarks();
      if (detection && detection.landmarks) {
        const dataUrl = canvas.toDataURL('image/png');
        capturedPhotos.push(dataUrl);
        updatePreview();

        try {
          const overlay = document.getElementById('cameraOverlay');
          const video = $('#camera');
          if (overlay && video) {
            const octx = overlay.getContext('2d');
            octx.clearRect(0, 0, overlay.width, overlay.height);

            // resize detection to overlay/display size to avoid distortion
            const displaySize = { width: overlay.width, height: overlay.height };
            const resized = faceapi.resizeResults(detection, displaySize);
            const box = resized.detection.box || { x: 0, y: 0, width: 100, height: 100 };
            const pts = resized.landmarks.positions;

            const faceWidth = box.width || Math.max(displaySize.width * 0.2, 100);
            const radius = Math.min(LANDMARK_POINT_MAX, Math.max(1, Math.round(faceWidth * LANDMARK_POINT_SCALE)));

            // draw bounding box around detected face (red)
            try {
              const pad = Math.max(2, Math.round(faceWidth * 0.06));
              octx.strokeStyle = 'rgba(200,40,40,0.95)';
              octx.lineWidth = Math.max(2, Math.round(faceWidth * 0.02));
              octx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
            } catch (err) {
              // ignore
            }

            // draw small connected paths for clarity and points
            const drawPath = (ptsArr, close) => {
              if (!ptsArr || ptsArr.length === 0) return;
              octx.beginPath();
              octx.moveTo(ptsArr[0].x, ptsArr[0].y);
              for (let i = 1; i < ptsArr.length; i++) octx.lineTo(ptsArr[i].x, ptsArr[i].y);
              if (close) octx.closePath();
              octx.strokeStyle = 'rgba(0,200,0,0.6)';
              octx.lineWidth = Math.max(1, Math.round(radius / 2));
              octx.stroke();
            };

            octx.fillStyle = 'rgba(0,255,0,0.95)';
            // group landmarks similar to dlib grouping
            const jaw = pts.slice(0, 17);
            const rightBrow = pts.slice(17, 22);
            const leftBrow = pts.slice(22, 27);
            const rightEye = pts.slice(36, 42);
            const leftEye = pts.slice(42, 48);
            const mouthOuter = pts.slice(48, 60);
            const mouthInner = pts.slice(60, 68);

            // Extend jaw side points (0 and 16) outward for better side fitting
            const jawCenterX = (jaw[0].x + jaw[16].x) / 2;
            const extendedJaw = jaw.map((pt, i) => {
              if (i === 0 || i === 16) {
                // Extend left and right jaw points outward
                const direction = i === 0 ? -1 : 1;
                const offsetX = (pt.x - jawCenterX) * (JAW_EXTEND_RATIO - 1);
                return { ...pt, x: pt.x + direction * Math.abs(offsetX) };
              }
              return pt;
            });

            drawPath(extendedJaw, false);
            drawPath(rightBrow, false);
            drawPath(leftBrow, false);
            drawPath(rightEye, true);
            drawPath(leftEye, true);
            drawPath(mouthOuter, true);
            drawPath(mouthInner, true);

            pts.forEach((pt) => {
              octx.beginPath();
              octx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
              octx.fill();
              octx.strokeStyle = 'rgba(0,120,0,0.95)';
              octx.stroke();
            });
          }
        } catch (err) {
          // ignore
        }

        if (capturedPhotos.length >= 7) {
          stopAutoCapture();
        }
      }
    } catch (err) {
      console.error('Auto-capture error', err);
    }
  };

  autoCaptureInterval = setInterval(() => {
    if (capturedPhotos.length >= 7) {
      stopAutoCapture();
      return;
    }
    tryCapture();
  }, 900);
}

// client-side landmark stream
function startClientLandmarkStream() {
  if (liveLandmarkInterval) return;
  liveLandmarkInterval = setInterval(async () => {
    if (!cameraStream) return;
    const video = $('#camera');
    if (!video || video.videoWidth === 0) return;
    if (!faceApiModelsLoaded) await loadFaceApiModels();

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 });
      const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
      const overlay = document.getElementById('cameraOverlay');
      if (overlay && overlay.getContext) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (detection && detection.landmarks) {
          // resize detection to overlay size (avoids stretched/compressed coords)
          const displaySize = { width: overlay.width, height: overlay.height };
          const resized = faceapi.resizeResults(detection, displaySize);
          const box = resized.detection.box || { width: 100 };
          const pts = resized.landmarks.positions;

          const faceWidth = box.width || Math.max(displaySize.width * 0.2, 100);
          const radius = Math.min(LANDMARK_POINT_MAX, Math.max(1, Math.round(faceWidth * LANDMARK_POINT_SCALE)));

          const drawPath = (ptsArr, close) => {
            if (!ptsArr || ptsArr.length === 0) return;
            ctx.beginPath();
            ctx.moveTo(ptsArr[0].x, ptsArr[0].y);
            for (let i = 1; i < ptsArr.length; i++) ctx.lineTo(ptsArr[i].x, ptsArr[i].y);
            if (close) ctx.closePath();
            ctx.strokeStyle = 'rgba(0,200,0,0.6)';
            ctx.lineWidth = Math.max(1, Math.round(radius / 2));
            ctx.stroke();
          };

          const jaw = pts.slice(0, 17);
          const rightBrow = pts.slice(17, 22);
          const leftBrow = pts.slice(22, 27);
          const rightEye = pts.slice(36, 42);
          const leftEye = pts.slice(42, 48);
          const mouthOuter = pts.slice(48, 60);
          const mouthInner = pts.slice(60, 68);

          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          // draw bounding box (red) behind landmark paths for clarity
          try {
            const pad = Math.max(2, Math.round(faceWidth * 0.06));
            ctx.strokeStyle = 'rgba(200,40,40,0.95)';
            ctx.lineWidth = Math.max(2, Math.round(faceWidth * 0.02));
            ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
          } catch (err) {
            // ignore
          }
          drawPath(jaw, false);
          drawPath(rightBrow, false);
          drawPath(leftBrow, false);
          drawPath(rightEye, true);
          drawPath(leftEye, true);
          drawPath(mouthOuter, true);
          drawPath(mouthInner, true);

          ctx.fillStyle = 'rgba(0,255,0,0.85)';
          ctx.strokeStyle = 'rgba(0,120,0,0.95)';
          pts.forEach((pt) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
    } catch (err) {
      // ignore draw errors
    }
  }, 250);
}

function stopClientLandmarkStream() {
  if (liveLandmarkInterval) clearInterval(liveLandmarkInterval);
  liveLandmarkInterval = null;
}

// load face-api models from local or CDN
async function loadFaceApiModels() {
  if (faceApiModelsLoaded) return;
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URI);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URI);
    faceApiModelsLoaded = true;
  } catch (err) {
    console.warn('Failed to load local face-api models, falling back to demo CDN', err);
    const remote = 'https://justadudewhohacks.github.io/face-api.js/models';
    await faceapi.nets.tinyFaceDetector.loadFromUri(remote);
    await faceapi.nets.faceLandmark68Net.loadFromUri(remote);
    faceApiModelsLoaded = true;
  }
}

// helpers
function clearPhotos() {
  capturedPhotos = [];
  currentPreviewIndex = 0;
  updatePreview();
}

// bindings and init
checkIfAdminLoggedIn($('#adminModal'), () => {
  loadUsers();
  updateClock();

  $('#open-user-modal').onclick = addNewUser;
  $('#searchInput').oninput = updateTable;

  $('#capture-photo').onclick = startAutoCapture;
  $('#clear-photos').onclick = clearPhotos;

  $('#user-form').onsubmit = saveUserData;
  $('#close-modal').onclick = closeUserModal;
});
