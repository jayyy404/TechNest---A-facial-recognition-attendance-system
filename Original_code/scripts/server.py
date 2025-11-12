import base64
import cv2
import dlib
import numpy as np
import pickle
import sys
import os
import time
import json
import requests
from keras_facenet import FaceNet
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*/": {'origins': ['http://localhost:5173', 'http://localhost']}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__)) 
DATASET_DIR = os.path.join(BASE_DIR, "dataset") 
os.makedirs(DATASET_DIR, exist_ok=True)


HAAR_PATH = os.path.join(os.path.dirname(BASE_DIR), "resources", "haar_face.xml")
PREDICTOR_PATH = os.path.join(os.path.dirname(BASE_DIR), "shape_predictor", "shape_predictor_68_face_landmarks.dat")
SAMPLES_REQUIRED = 7

# PHP backend URL 
PHP_API_URL = "http://localhost/api"

os.makedirs(DATASET_DIR, exist_ok=True)

# Directory where frontend will save uploaded images (dist/uploads)
FRONTEND_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(BASE_DIR)), "embeddings", "uploads")
os.makedirs(FRONTEND_UPLOAD_DIR, exist_ok=True)

# Mapping the user data: { name: {"id": id, "role": role, "dept": dept, "embedding": np.array, "image_path": path} }
USERS_DATA = {}


# MODEL LOADING(for checking kay gaguba kis a mag load sakon)
if not os.path.exists(HAAR_PATH):
    raise FileNotFoundError(f"Haar cascade not found at {HAAR_PATH}")

haar_cascade = cv2.CascadeClassifier(HAAR_PATH)
if haar_cascade.empty():
    raise RuntimeError(f"Failed to load Haar cascade from {HAAR_PATH}")

predictor = dlib.shape_predictor(PREDICTOR_PATH)  # type: ignore[attr-defined]
    
def scan_for_recognition(max_attempts=120, min_confirmations=2, threshold=0.85):
    """Continuously scan for a recognizable face and return the best match."""
    window_name = "Attendance Recognition"
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return {"status": "error", "message": "Unable to open camera"}

    configure_camera(cap)
    matches = {}
    frames_processed = 0

    try:
        while frames_processed < max_attempts:
            ret, frame = cap.read()
            if not ret:
                break

            frames_processed += 1
            display_frame = frame.copy()
            box = detect_face(frame)

            if box is not None:
                x, y, w, h = box
                cv2.rectangle(display_frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

                embedding = get_embedding(frame, box)
                if embedding is not None:
                    identity, dist = recognize_face(embedding, threshold=threshold)

                    if identity != "Unknown":
                        match = matches.setdefault(identity, {"count": 0, "best_dist": float("inf")})
                        match["count"] += 1
                        if dist < match["best_dist"]:
                            match["best_dist"] = dist

                        cv2.putText(display_frame, f"Checking: {identity}", (x, y - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                        if match["count"] >= min_confirmations:
                            confidence = max(0.0, 1.0 - match["best_dist"])
                            bring_window_to_front(window_name)
                            cv2.imshow(window_name, display_frame)
                            cv2.waitKey(500)
                            return {
                                "status": "success",
                                "identity": identity,
                                "distance": float(match["best_dist"]),
                                "confidence": float(confidence),
                                "frames": frames_processed
                            }
                    else:
                        cv2.putText(display_frame, "Analyzing face...", (x, y - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            else:
                cv2.putText(display_frame, "No face detected", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

            bring_window_to_front(window_name)
            cv2.imshow(window_name, display_frame)
            if cv2.waitKey(1) & 0xFF == 27:  
                return {"status": "error", "message": "Recognition cancelled by user"}

        if matches:
        
            identity, info = min(matches.items(), key=lambda item: item[1]["best_dist"])
            return {
                "status": "partial",
                "identity": identity,
                "distance": float(info["best_dist"]),
                "confidence": float(max(0.0, 1.0 - info["best_dist"])),
                "frames": frames_processed,
                "message": "Face detected but confirmation threshold not met"
            }

        return {
            "status": "unrecognized",
            "message": "Unable to recognize any registered user",
            "frames": frames_processed
        }
    finally:
        cap.release()
        cv2.destroyWindow(window_name)

embedder = FaceNet()
print("[SYSTEM] Models loaded successfully.")

# Utilities
def bring_window_to_front(winname):
    cv2.namedWindow(winname, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(winname, cv2.WND_PROP_TOPMOST, 1)


def configure_camera(cap, calibration_time=2.0):
    """Stabilize the camera for a few seconds before actual capture."""
    try:
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
    except Exception:
        pass

    start = time.time()
    while time.time() - start < calibration_time:
        ret, _ = cap.read()
        if not ret:
            break
        cv2.waitKey(1)
    return


def detect_face(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = haar_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(60, 60))
    return max(faces, key=lambda b: b[2] * b[3]) if len(faces) > 0 else None


def get_embedding(frame, box):
    x, y, w, h = box
    face_crop = frame[y:y+h, x:x+w]
    if face_crop.size == 0:
        return None
    face_crop = cv2.resize(face_crop, (160, 160))
    return embedder.embeddings([face_crop])[0]

# Database backend
def send_to_php(name, embedding, user_id=None, role="Student", dept=None, username=None, password=None):
    """Send user embedding and info to PHP backend for storage."""
    try:
        data = {
            "name": name,
            "embedding": pickle.dumps(embedding).hex(),  # serialize embedding
            "id": user_id,
            "role": role,
            "dept": dept,
            "username": username or name.lower().replace(" ", ""),
            "password": password or "password123"  
        }
        # Drop any keys with None values to avoid sending "None" strings
        data = {k: v for k, v in data.items() if v is not None}
        # Send to API endpoint
        response = requests.post(f"{PHP_API_URL}/save_user.php", data=data)
        print(f"[PHP] Sent data to {PHP_API_URL}/save_user.php")
        return response.json()
    except Exception as e:
        print(f"[PHP ERROR] Could not connect to PHP API: {e}")
        return {"status": "error", "message": str(e)}

def sanitize_filename(name: str) -> str:
    # Simple sanitizer for folder names
    return "".join(c for c in name if c.isalnum() or c in "-_ ").strip().replace(" ", "_")


def download_image(url: str, dest_path: str, timeout: int = 8) -> bool:
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 200:
            with open(dest_path, "wb") as f:
                f.write(resp.content)
            return True
    except Exception as e:
        print(f"[DOWNLOAD ERROR] Could not download {url}: {e}")
    return False


def best_image_for_user(image_urls: list) -> tuple:
    """Download images, run face detection and pick the image with largest face area.
    Returns (best_image_path, face_box) or (None, None).
    """
    best = (None, 0, None)
    print(image_urls)
    for idx, url in enumerate(image_urls or []):
        if not url:
            continue

        url = f"http://localhost/{url.lstrip('/')}"
        
        fname = os.path.basename(url.split("?")[0]) or f"img_{idx}.jpg"
        
        # ensure extension
        if not os.path.splitext(fname)[1]:
            fname += ".jpg"
        
        tmp_path = os.path.join(DATASET_DIR, fname)
        
        if not download_image(url, tmp_path):
            print("Download image failed")
            continue
        
        img = cv2.imread(tmp_path)
        
        if img is None:
            continue
        
        box = detect_face(img)
        
        if box is None:
            continue
        
        _, _, w, h = box
        area = w * h
        
        if area > best[1]:
            best = (tmp_path, area, box)

    return (best[0], best[2]) if best[0] else (None, None)


def bootstrap_users_from_php():
    """Fetch users from PHP, download candidate images, compute embeddings and populate USERS_DATA."""
    print("[BOOTSTRAP] Fetching users from PHP to build recognition dataset...")
    try:
        response = requests.get(f"{PHP_API_URL}/get-state", timeout=10)
        if not response.ok:
            print(f"[BOOTSTRAP] PHP fetch failed: {response.status_code}")
            return

        payload = response.json()
        users = payload.get("users", []) if isinstance(payload, dict) else []

        for user in users:
            name = user.get("name")
            
            if not name:
                continue
            
            # decode json string
            image_urls = json.loads(user.get("photo")) if isinstance(user.get("photo"), str) else []
            
            sanitized = sanitize_filename(name)
            user_dir = os.path.join(FRONTEND_UPLOAD_DIR, sanitized)
            os.makedirs(user_dir, exist_ok=True)

            best_path, box = best_image_for_user(image_urls)
            
            if not best_path:
                print(f"[BOOTSTRAP] No valid image for user {name}")
                continue

            # move best image into user's folder
            dest = os.path.join(user_dir, os.path.basename(best_path))
            try:
                os.replace(best_path, dest)
            except Exception:
                try:
                    os.rename(best_path, dest)
                except Exception:
                    # fallback to copy
                    with open(best_path, "rb") as r, open(dest, "wb") as w:
                        w.write(r.read())

            # compute embedding
            img = cv2.imread(dest)
            if img is None:
                print(f"[BOOTSTRAP] Failed to read downloaded image for {name}")
                continue
            if box is None:
                box = detect_face(img)
            if box is None:
                print(f"[BOOTSTRAP] No face detected after move for {name}")
                continue
            emb = get_embedding(img, box)
            if emb is None:
                print(f"[BOOTSTRAP] Failed to compute embedding for {name}")
                continue

            USERS_DATA[name] = {
                "id": user.get("id") or user.get("user_id"),
                "role": user.get("role"),
                "dept": user.get("dept"),
                "embedding": emb,
                "image_path": dest,
            }
            print(f"[BOOTSTRAP] Loaded user {name} (id={USERS_DATA[name]['id']})")

    except Exception as e:
        print(f"[BOOTSTRAP ERROR] {e}")


# Run bootstrap on import/startup
bootstrap_users_from_php()

# FACIAL RECOGNITION CORE
def decode_image_from_data_url(data_url: str):
    if not data_url:
        return None
    try:
        if data_url.startswith('data:'):
            _, encoded = data_url.split(',', 1)
        else:
            encoded = data_url
        img_bytes = base64.b64decode(encoded)
    except (ValueError, TypeError):
        return None

    np_buffer = np.frombuffer(img_bytes, dtype=np.uint8)
    if np_buffer.size == 0:
        return None
    return cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)


def embeddings_from_frames(frames):
    embeddings = []
    for frame_data in frames or []:
        frame = decode_image_from_data_url(frame_data)
        if frame is None:
            continue
        box = detect_face(frame)
        if box is None:
            continue
        emb = get_embedding(frame, box)
        if emb is not None:
            embeddings.append(emb)
        if len(embeddings) >= SAMPLES_REQUIRED:
            break
    return embeddings


def save_frames_to_user_folder(name: str, frames: list) -> list:
    #Save decoded frames (data URLs or base64) into public/uploads/<sanitized_name>/.
    #Returns list of saved file paths.
    
    saved = []
    if not frames:
        return saved

    sanitized = sanitize_filename(name)
    user_dir = os.path.join(FRONTEND_UPLOAD_DIR, sanitized)
    os.makedirs(user_dir, exist_ok=True)

    for idx, frame_data in enumerate(frames):
        try:
            img = decode_image_from_data_url(frame_data)
            if img is None:
                continue
            # write a timestamped filename
            ts = int(time.time())
            fname = f"{ts}_{idx}.jpg"
            path = os.path.join(user_dir, fname)
            # cv2.imwrite returns True/False
            try:
                cv2.imwrite(path, img)
                saved.append(path)
            except Exception:
                # fallback to raw bytes if available
                try:
                    # frame_data might be a plain base64 string
                    if frame_data.startswith('data:'):
                        _, encoded = frame_data.split(',', 1)
                    else:
                        encoded = frame_data
                    with open(path, 'wb') as f:
                        f.write(base64.b64decode(encoded))
                    saved.append(path)
                except Exception:
                    continue
            if len(saved) >= SAMPLES_REQUIRED:
                break
        except Exception:
            continue

    return saved


def _capture_samples(samples_required=SAMPLES_REQUIRED, window_name="Face Capture"):
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return {"status": "error", "message": "Unable to open camera"}

    configure_camera(cap)
    samples = []
    count = 0
    while count < samples_required:
        ret, frame = cap.read()
        if not ret:
            break
        box = detect_face(frame)
        if box is not None:
            emb = get_embedding(frame, box)
            if emb is not None:
                samples.append(emb)
                count += 1
                x, y, w, h = box
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.putText(frame, f"Captured {count}/{samples_required}", (x, y - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                bring_window_to_front(window_name)
                cv2.imshow(window_name, frame)
                cv2.waitKey(1)
                time.sleep(0.8)
        else:
            cv2.imshow(window_name, frame)
            bring_window_to_front(window_name)
            cv2.waitKey(1)
    cap.release()
    cv2.destroyAllWindows()
    return {"status": "ok", "samples": samples}


def register_user(name, user_id=None, role="Student", dept=None, username=None, password=None, frames=None):
    print(f"[REGISTER] Starting registration for {name}")

    frame_list = frames or []
    if not frame_list:
        # Don't allow registration to continue if no frames are provided
        return {"status": "error", "message": "No face images provided. Registration requires facial images."}

    # Persist frames to user's folder in public/uploads/<sanitized_name>/
    # saved_paths = save_frames_to_user_folder(name, frame_list)
    # if saved_paths:
    #     print(f"[REGISTER] Saved {len(saved_paths)} frames to user's upload folder")

    samples = embeddings_from_frames(frame_list)
    print(f"[REGISTER] Received {len(samples)}/{SAMPLES_REQUIRED} usable samples from browser")

    # Allow registration to proceed if we have at least one usable sample
    if len(samples) == 0:
        return {"status": "error", "message": "No usable samples supplied for registration."}

    avg_emb = np.mean(np.array(samples), axis=0)

    print("[REGISTER] Sending data to PHP API")
    response = send_to_php(
        name,
        avg_emb,
        user_id=user_id,
        role=role,
        dept=dept,
        username=username,
        password=password
    )
    print(f"[REGISTER] PHP API response: {response}")

    if not isinstance(response, dict) or response.get("status") != "success":
        message = "PHP service reported an error while saving the embedding"
        if isinstance(response, dict):
            message = response.get("message", message)
        return {
            "status": "error",
            "message": message,
            "php_response": response
        }

    return {
        "status": "success",
        "message": f"User {name} registered successfully",
        "php_response": response,
        "frames" : len(samples)
    }


def recognize_face(embedding, threshold=0.8):
    min_dist, identity = float("inf"), "Unknown"
    for name, db_emb in USERS_DATA:
        dist = np.linalg.norm(embedding - db_emb)
        if dist < min_dist:
            min_dist, identity = dist, name
    
    is_recognized = min_dist < threshold
    result = (identity, min_dist) if is_recognized else ("Unknown", min_dist)
    
    return result


def recognize_from_frame_data(frame_data, threshold=0.8):
    frame = decode_image_from_data_url(frame_data)
    if frame is None:
        return {"status": "error", "message": "Invalid or empty frame data provided."}

    box = detect_face(frame)
    if box is None:
        return {
            "status": "unrecognized",
            "message": "No face detected in the provided frame."
        }

    embedding = get_embedding(frame, box)
    if embedding is None:
        return {"status": "error", "message": "Failed to extract facial features from frame."}

    identity, dist = recognize_face(embedding, threshold=threshold)
    confidence = max(0.0, 1.0 - float(dist))

    if identity != "Unknown":
        return {
            "status": "success",
            "recognized": True,
            "name": identity,
            "confidence": confidence,
            "distance": float(dist),
            "frames": 1
        }

    return {
        "status": "unrecognized",
        "recognized": False,
        "message": "Face not recognized",
        "confidence": confidence,
        "distance": float(dist),
        "frames": 1
    }


def login_user(name):
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return {"status": "error", "message": "Unable to open camera"}

    configure_camera(cap)
    count = 0
    while count < SAMPLES_REQUIRED:
        ret, frame = cap.read()
        if not ret:
            break
        box = detect_face(frame)
        if box is not None:
            emb = get_embedding(frame, box)
            if emb is not None:
                identity, dist = recognize_face(emb)
                if identity == name:
                    count += 1
                    x, y, w, h = box
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                    cv2.putText(frame, f"Match {count}/{SAMPLES_REQUIRED}", (x, y - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                    bring_window_to_front("Login")
                    cv2.imshow("Login", frame)
                    cv2.waitKey(1)
                    time.sleep(1)
        else:
            cv2.imshow("Login", frame)
            bring_window_to_front("Login")
            cv2.waitKey(1)
    cap.release()
    cv2.destroyAllWindows()
    return {"status": "success" if count >= SAMPLES_REQUIRED else "error", "matches": count}


def reenroll_user(name, user_id=None, role="Student", dept=None, username=None, password=None, frames=None):
    """Overwrite old data by re-registering the same user."""
    print(f"[REENROLL] Re-enrolling user: {name}")
    return register_user(
        name,
        user_id=user_id,
        role=role,
        dept=dept,
        username=username,
        password=password,
        frames=frames
    )


# FLASK ROUTES 
@app.route("/register", methods=["POST"])
def register_route():
    try:
        payload = request.form if request.form else (request.get_json(silent=True) or {})

        name = payload.get("name")
        user_id = payload.get("id") or payload.get("user_id")
        role = payload.get("role", "Student")
        dept = payload.get("dept")
        username = payload.get("username")
        password = payload.get("password")
        
        # Log the request data for debugging (kwaa na ni kay ga work na hahahah)
        print(f"[REGISTER] Received registration request:")
        print(f"  - name: {name}")
        print(f"  - user_id: {user_id}")
        print(f"  - role: {role}")
        print(f"  - dept: {dept}")
        print(f"  - username: {username}")
        
        if not name:
            print("[REGISTER] Error: Name is required")
            return jsonify({"status": "error", "message": "Name is required"}), 400
            
        print(f"[REGISTER] Starting facial recognition for {name}")
        # If frontend provided an image_url (or image), download into user folder and convert to data-url
        frames = payload.get("frames") or []
        single_image_url = payload.get("image_url") or payload.get("image")
        if single_image_url:
            sanitized = sanitize_filename(name)
            user_dir = os.path.join(FRONTEND_UPLOAD_DIR, sanitized)
            os.makedirs(user_dir, exist_ok=True)
            fname = os.path.basename(single_image_url.split("?")[0]) or "upload.jpg"
            dest_path = os.path.join(user_dir, fname)
            if download_image(single_image_url, dest_path):
                # convert saved file to data-url for register_user
                with open(dest_path, "rb") as f:
                    b = f.read()
                data_url = "data:image/jpeg;base64," + base64.b64encode(b).decode("ascii")
                frames = [data_url]

        # Capture face and register user
        result = register_user(
            name,
            user_id=user_id,
            role=role,
            dept=dept,
            username=username,
            password=password,
            frames=frames
        )
        
        print(f"[REGISTER] Registration result: {result}")
        
        # Check if registration was successful and embedding was generated
        if result["status"] == "success" and "php_response" in result:
            print(f"[REGISTER] Successfully registered {name}")
            # include saved paths if available
            if isinstance(result.get("php_response"), dict):
                # Create a new response dictionary from scratch
                response_dict = {}
                # Copy all keys from result
                for key in result:
                    response_dict[key] = result[key]
                # addnew key with a list value
                response_dict["saved_paths"] = []
                sanitized = sanitize_filename(name)
                user_dir = os.path.join(FRONTEND_UPLOAD_DIR, sanitized)
                if os.path.isdir(user_dir):
                    for f in os.listdir(user_dir):
                        response_dict["saved_paths"].append(os.path.join(user_dir, f))
                return jsonify(response_dict)
            return jsonify(result)
            
        return jsonify(result)
    except Exception as e:
        print(f"[ERROR] Registration error: {e}")
        return jsonify({"status": "error", "message": f"Registration error: {str(e)}"}), 500


@app.route("/login", methods=["POST"])
def login_route():
    try:
        payload = request.form if request.form else (request.get_json(silent=True) or {})
        # prefer image_url based login
        image_url = payload.get("image_url") or payload.get("image")
        name = payload.get("name")

        if image_url:
            # download incoming image
            incoming_dir = os.path.join(FRONTEND_UPLOAD_DIR, "incoming")
            os.makedirs(incoming_dir, exist_ok=True)
            fname = os.path.basename(image_url.split("?")[0]) or "login.jpg"
            incoming_path = os.path.join(incoming_dir, fname)
            if not download_image(image_url, incoming_path):
                return jsonify({"status": "error", "message": "Failed to download image"}), 400
            img = cv2.imread(incoming_path)
            if img is None:
                return jsonify({"status": "error", "message": "Downloaded image unreadable"}), 400
            box = detect_face(img)
            if box is None:
                try:
                    os.remove(incoming_path)
                except Exception:
                    pass
                return jsonify({"status": "unrecognized", "message": "No face detected"}), 400
            emb = get_embedding(img, box)
            if emb is None:
                try:
                    os.remove(incoming_path)
                except Exception:
                    pass
                return jsonify({"status": "error", "message": "Failed to extract features"}), 500

            best_match = (None, float("inf"))
            for uname, info in USERS_DATA.items():
                db_emb = info.get("embedding")
                if db_emb is None:
                    continue
                dist = float(np.linalg.norm(emb - db_emb))
                if dist < best_match[1]:
                    best_match = (uname, dist)

            THRESHOLD = 0.6
            if best_match[0] and best_match[1] < THRESHOLD:
                uname = best_match[0]
                info = USERS_DATA[uname]
                # move image to user folder
                user_folder = os.path.join(FRONTEND_UPLOAD_DIR, sanitize_filename(uname))
                os.makedirs(user_folder, exist_ok=True)
                try:
                    dest = os.path.join(user_folder, os.path.basename(incoming_path))
                    os.replace(incoming_path, dest)
                except Exception:
                    try:
                        os.rename(incoming_path, dest)
                    except Exception:
                        with open(incoming_path, "rb") as r, open(dest, "wb") as w:
                            w.write(r.read())

                return jsonify({"status": "success", "name": uname, "id": info.get("id"), "role": info.get("role"), "dept": info.get("dept")})

            # no match
            try:
                os.remove(incoming_path)
            except Exception:
                pass
            return jsonify({"status": "forbidden", "user": None}), 403

        # fallback to legacy name-based login via camera
        if not name:
            return jsonify({"status": "error", "message": "Name is required"}), 400

        print(f"[LOGIN] Received login request for {name}")
        result = login_user(name)
        return jsonify(result)
    except Exception as e:
        print(f"[ERROR] Login error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/reenroll", methods=["POST"])
def reenroll_route():
    try:
        payload = request.form if request.form else (request.get_json(silent=True) or {})

        name = payload.get("name")
        user_id = payload.get("id") or payload.get("user_id")
        role = payload.get("role", "Student")
        dept = payload.get("dept")
        username = payload.get("username")
        password = payload.get("password")
        
        if not name:
            return jsonify({"status": "error", "message": "Name is required"}), 400
            
        print(f"[REENROLL] Received reenrollment request for {name}")
        result = reenroll_user(
            name,
            user_id=user_id,
            role=role,
            dept=dept,
            username=username,
            password=password
        )
        return jsonify(result)
    except Exception as e:
        print(f"[ERROR] Reenrollment error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/recognize", methods=["POST"])
def recognize_route():
    try:
        image_uri = request.data
        
        # if not image_url:
        #     # fallback to camera-based scanning
        #     scan_result = scan_for_recognition()
        #     status = scan_result.get("status")
        #     if status == "success":
        #         return jsonify({
        #             "status": "success",
        #             "identity": scan_result.get("identity"),
        #             "confidence": float(scan_result.get("confidence", 0.0)),
        #             "distance": float(scan_result.get("distance", 0.0)),
        #             "frames": scan_result.get("frames")
        #         })
        #     elif status == "partial":
        #         return jsonify(scan_result), 206
        #     elif status == "unrecognized":
        #         return jsonify(scan_result), 404
        #     else:
        #         return jsonify(scan_result), 500

        # # download incoming image to incoming folder
        # incoming_dir = os.path.join(FRONTEND_UPLOAD_DIR, "incoming")
        # os.makedirs(incoming_dir, exist_ok=True)
        # fname = os.path.basename(image_url.split("?")[0]) or "incoming.jpg"
        # incoming_path = os.path.join(incoming_dir, fname)
        # if not download_image(image_url, incoming_path):
        #     return jsonify({"status": "error", "message": "Failed to download image"}), 400

        file = (request.files['image'])
        
        if file is None:
            return jsonify({"status": "error", "message": "No image parameter passed to route"}), 400
        
        filestr = file.read()
        npimg = np.frombuffer(filestr, dtype=np.uint8)
        img = cv2.imdecode(npimg, flags=cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"status": "error", "message": "Image unreadable"}), 400

        box = detect_face(img)
        if box is None:
            # try:
            #     os.remove(incoming_path)
            # except Exception:
            #     pass
            return jsonify({"status": "unrecognized", "message": "No face detected"}), 400

        emb = get_embedding(img, box)
        if emb is None:
            # try:
            #     os.remove(incoming_path)
            # except Exception:
            #     pass
            return jsonify({"status": "error", "message": "Failed to extract features"}), 500

        # compare against USERS_DATA
        best_match = (None, float("inf"))
        
        for name, info in USERS_DATA.items():
            db_emb = info.get("embedding")
            if db_emb is None:
                continue
            dist = float(np.linalg.norm(emb - db_emb))
            if dist < best_match[1]:
                best_match = (name, dist)

        # print(best_match)

        # threshold for acceptance
        THRESHOLD = 0.8
        
        if best_match[0] and best_match[1] < THRESHOLD:
            name = best_match[0]
            info = USERS_DATA[name]
            
            # move incoming image into user's folder
            # user_folder = os.path.join(FRONTEND_UPLOAD_DIR, sanitize_filename(name))
            # os.makedirs(user_folder, exist_ok=True)
            
            # try:
            #     dest = os.path.join(user_folder, os.path.basename(incoming_path))
            #     os.replace(incoming_path, dest)
            # except Exception:
            #     try:
            #         os.rename(incoming_path, dest)
            #     except Exception:
            #         with open(incoming_path, "rb") as r, open(dest, "wb") as w:
            #             w.write(r.read())

            response = {
                "status": "success",
                "name": name,
                "id": info.get("id"),
                "role": info.get("role"),
                "dept": info.get("dept"),
                "confidence": float(max(0.0, 1.0 - best_match[1])),
                "distance": float(best_match[1])
            }
            return jsonify(response)

        return jsonify({"status": "forbidden", "user": None})
        
    except Exception as e:
        print(f"[ERROR] Recognition error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/test", methods=["GET"])
def test_connection():
    return jsonify({
        "status": "ok", 
        "message": "Python Facial Recognition API is running",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "models_loaded": {
            "haar_cascade": haar_cascade is not None,
            "predictor": predictor is not None,
            "embedder": embedder is not None
        }
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
