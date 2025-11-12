import cv2
import dlib
import numpy as np
import pickle
import os
import time
import base64
import requests
from keras_facenet import FaceNet
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
os.makedirs(DATASET_DIR, exist_ok=True)
HAAR_PATH = "resources/haar_face.xml"
PREDICTOR_PATH = "shape_predictor/shape_predictor_68_face_landmarks.dat"
SAMPLES_REQUIRED = 7

#Change lang once tapos ka na sa 
PHP_API_URL = "http://localhost/techt_recog_api"  
VITE_FRONTEND_URL = "http://localhost:5173"          


# Load model
haar_cascade = cv2.CascadeClassifier(cv2.samples.findFile(HAAR_PATH))
predictor = dlib.shape_predictor(PREDICTOR_PATH)
embedder = FaceNet()
print("Model loaded successfully.")


#Utilities Functions
def detect_face(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = haar_cascade.detectMultiScale(gray, 1.3, 6, minSize=(120, 120))
    return max(faces, key=lambda b: b[2]*b[3]) if len(faces) > 0 else None


def get_embedding(frame, box):
    x, y, w, h = box
    face_crop = frame[y:y+h, x:x+w]
    if face_crop.size == 0:
        return None
    face_crop = cv2.resize(face_crop, (160, 160))
    return embedder.embeddings([face_crop])[0]


def decode_image(base64_data):
    #Decode base64 image form PHP database
    img_data = base64.b64decode(base64_data)
    np_arr = np.frombuffer(img_data, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame


# PHP db API
def send_to_php(name, embedding):
    #Send serialized embedding to PHP 
    try:
        data = {
            "name": name,
            "embedding": pickle.dumps(embedding).hex()
        }
        response = requests.post(f"{PHP_API_URL}/save_user.php", data=data)
        return response.json()
    except Exception as e:
        print(f"[PHP ERROR] Could not connect to PHP API: {e}")
        return {"status": "error", "message": str(e)}


def fetch_from_php():
    #Fetch user embeddings
    try:
        response = requests.get(f"{PHP_API_URL}/fetch_users.php")
        if response.status_code == 200:
            users_data = response.json()
            users = []
            for name, emb_hex in users_data.items():
                emb = pickle.loads(bytes.fromhex(emb_hex))
                users.append((name, emb))
            return users
        else:
            print("[PHP ERROR] Failed to fetch users.")
            return []
    except Exception as e:
        print(f"[PHP ERROR] {e}")
        return []


# Facial Recognition Logic
def recognize_face(embedding, threshold=0.8):
    users = fetch_from_php()
    min_dist, identity = float("inf"), "Unknown"
    for name, db_emb in users:
        dist = np.linalg.norm(embedding - db_emb)
        if dist < min_dist:
            min_dist, identity = dist, name
    return (identity, float(min_dist)) if min_dist < threshold else ("Unknown", float(min_dist))


# Flask API Endpoints (routing)
@app.route("/api/register", methods=["POST"])
def register_route():
    """Register a new user with 1–7 face samples sent from Vite/PHP (based man ni sa ila logic)""" 
    
    
    name = request.form.get("name")
    image_data = request.form.get("image")

    if not name or not image_data:
        return jsonify({"status": "error", "message": "Missing name or image"})

    frame = decode_image(image_data)
    box = detect_face(frame)
    if box is None:
        return jsonify({"status": "error", "message": "No face detected"})

    emb = get_embedding(frame, box)
    if emb is None:
        return jsonify({"status": "error", "message": "Failed to generate embedding"})

    response = send_to_php(name, emb)
    return jsonify({"status": "success", "message": f"User {name} registered", "php_response": response})


@app.route("/api/login", methods=["POST"])
def login_route():
    #Verify a user by matching a single face snapshot
    name = request.form.get("name")
    image_data = request.form.get("image")

    if not name or not image_data:
        return jsonify({"status": "error", "message": "Missing name or image"})

    frame = decode_image(image_data)
    box = detect_face(frame)
    if box is None:
        return jsonify({"status": "error", "message": "No face detected"})

    emb = get_embedding(frame, box)
    if emb is None:
        return jsonify({"status": "error", "message": "Failed to process image"})

    identity, distance = recognize_face(emb)
    verified = identity == name

    return jsonify({
        "status": "success" if verified else "error",
        "verified": verified,
        "matched_name": identity,
        "distance": distance
    })


@app.route("/api/reenroll", methods=["POST"])
def reenroll_route():
    #overwrite previous embedding
    name = request.form.get("name")
    image_data = request.form.get("image")

    if not name or not image_data:
        return jsonify({"status": "error", "message": "Missing name or image"})

    frame = decode_image(image_data)
    box = detect_face(frame)
    if box is None:
        return jsonify({"status": "error", "message": "No face detected"})

    emb = get_embedding(frame, box)
    if emb is None:
        return jsonify({"status": "error", "message": "Failed to process face"})

    response = send_to_php(name, emb)
    return jsonify({"status": "success", "message": f"User {name} re-enrolled", "php_response": response})


@app.route("/api/test", methods=["GET"])
def test_connection():
    return jsonify({"status": "ok", "message": "Python Facial Recognition API running"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
