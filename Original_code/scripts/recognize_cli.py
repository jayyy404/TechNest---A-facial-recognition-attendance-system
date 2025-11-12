import os
import sys
import json
import time
import argparse
import base64
import requests

try:
    import cv2
    import numpy as np
    from keras_facenet import FaceNet
    import dlib
except Exception as e:
    print(json.dumps({"status": "error", "message": f"Missing python deps: {e}"}))
    sys.exit(1)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(BASE_DIR))

HAAR_PATH = os.path.join(os.path.dirname(BASE_DIR), 'resources', 'haar_face.xml')
PREDICTOR_PATH = os.path.join(os.path.dirname(BASE_DIR), 'shape_predictor', 'shape_predictor_68_face_landmarks.dat')
FRONTEND_UPLOAD_DIR = os.path.join(REPO_ROOT, 'embeddings', 'uploads')
os.makedirs(FRONTEND_UPLOAD_DIR, exist_ok=True)

PHP_API_URL = 'http://localhost/api'

SAMPLES_REQUIRED = 1


def load_models():
    if not os.path.exists(HAAR_PATH):

        possible = os.path.join(REPO_ROOT, 'Original_code', 'resources', 'haar_face.xml')
        if os.path.exists(possible):
            haar = cv2.CascadeClassifier(possible)
        else:
            raise FileNotFoundError('haar_face.xml not found')
    else:
        haar = cv2.CascadeClassifier(HAAR_PATH)

    # load dlib predictor 
    predictor = None
    if os.path.exists(PREDICTOR_PATH):
        try:
            predictor = dlib.shape_predictor(PREDICTOR_PATH)
        except Exception:
            predictor = None

    embedder = FaceNet()
    # return predictor s
    return haar, embedder, predictor


def get_landmarks(predictor, frame, box):
    if predictor is None:
        return []
    x, y, w, h = box
    # convert to dlib rectangle 
    rect_ctor = getattr(dlib, 'rectangle', None)
    if rect_ctor is None:
        class _Rect:
            def __init__(self, left, top, right, bottom):
                self.left = left
                self.top = top
                self.right = right
                self.bottom = bottom
        rect = _Rect(int(x), int(y), int(x + w), int(y + h))
    else:
        rect = rect_ctor(int(x), int(y), int(x + w), int(y + h))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    try:
        shape = predictor(gray, rect)
        pts = [(int(shape.part(i).x), int(shape.part(i).y)) for i in range(68)]
        return pts
    except Exception:
        return []


def detect_face(haar, frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(60, 60))
    return max(faces, key=lambda b: b[2] * b[3]) if len(faces) > 0 else None


def get_embedding(embedder, frame, box):
    x, y, w, h = box
    face_crop = frame[y:y+h, x:x+w]
    if face_crop.size == 0:
        return None
    face_crop = cv2.resize(face_crop, (160, 160))
    return embedder.embeddings([face_crop])[0]


def bootstrap_users(haar, embedder):
    users = {}
    try:
        r = requests.get(f"{PHP_API_URL}/get-state", timeout=8)
        if not r.ok:
            return users
        payload = r.json()
        user_list = payload.get('users', []) if isinstance(payload, dict) else []
        for user in user_list:
            name = user.get('name')
            if not name:
                continue
            photos = user.get('photo')
            # try parsing JSON string of photo urls
            try:
                photo_urls = json.loads(photos) if isinstance(photos, str) else photos or []
            except Exception:
                photo_urls = []

            best_emb = None
            for url in (photo_urls or []):
                if not url:
                    continue
                # try to download
                try:
                    # build local URL if necessary
                    if url.startswith('/'):
                        url = f"http://localhost{url}"
                    tmp = requests.get(url, timeout=6)
                    if not tmp.ok:
                        continue
                    arr = np.frombuffer(tmp.content, dtype=np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    box = detect_face(haar, img)
                    if box is None:
                        continue
                    emb = get_embedding(embedder, img, box)
                    if emb is not None:
                        best_emb = emb
                        break
                except Exception:
                    continue

            if best_emb is not None:
                users[name] = {
                    'id': user.get('id') or user.get('user_id'),
                    'role': user.get('role'),
                    'dept': user.get('dept'),
                    'embedding': best_emb
                }
    except Exception:
        pass
    return users


def recognize_image(image_path, haar, embedder, users_data, threshold=1.0):
    img = cv2.imread(image_path)
    if img is None:
        return {'status': 'error', 'message': 'Image unreadable'}
    box = detect_face(haar, img)
    if box is None:
        return {'status': 'unrecognized', 'message': 'No face detected'}
    emb = get_embedding(embedder, img, box)
    if emb is None:
        return {'status': 'error', 'message': 'Failed to extract features'}

    best = (None, float('inf'))
    for name, info in users_data.items():
        db_emb = info.get('embedding')
        if db_emb is None:
            continue
        try:
            dist = float(np.linalg.norm(emb - db_emb))
        except Exception:
            continue
        if dist < best[1]:
            best = (name, dist)

    if best[0] and best[1] < threshold:
        info = users_data[best[0]]
        return {
            'status': 'success',
            'name': best[0],
            'id': info.get('id'),
            'role': info.get('role'),
            'dept': info.get('dept'),
            'confidence': float(max(0.0, 1.0 - best[1])),
            'distance': float(best[1])
        }

    return {'status': 'forbidden', 'user': None}


def recognize_image_with_landmarks(image_path, haar, embedder, predictor, users_data, threshold=1.0):
    """Run recognition and also return detected 68-point landmarks (if predictor available).

    The returned dict will include a 'landmarks' key with list of [x,y] pairs (may be empty).
    """
    img = cv2.imread(image_path)
    if img is None:
        return {'status': 'error', 'message': 'Image unreadable', 'landmarks': []}
    box = detect_face(haar, img)
    if box is None:
        return {'status': 'unrecognized', 'message': 'No face detected', 'landmarks': []}

    # compute landmarks 
    pts = get_landmarks(predictor, img, box) if predictor is not None else []

    emb = get_embedding(embedder, img, box)
    if emb is None:
        return {'status': 'error', 'message': 'Failed to extract features', 'landmarks': pts}

    best = (None, float('inf'))
    for name, info in users_data.items():
        db_emb = info.get('embedding')
        if db_emb is None:
            continue
        try:
            dist = float(np.linalg.norm(emb - db_emb))
        except Exception:
            continue
        if dist < best[1]:
            best = (name, dist)

    if best[0] and best[1] < threshold:
        info = users_data[best[0]]
        return {
            'status': 'success',
            'name': best[0],
            'id': info.get('id'),
            'role': info.get('role'),
            'dept': info.get('dept'),
            'confidence': float(max(0.0, 1.0 - best[1])),
            'distance': float(best[1]),
            'landmarks': pts
        }

    return {'status': 'forbidden', 'user': None, 'landmarks': pts}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True, help='Path to image file')
    parser.add_argument('--threshold', type=float, default=1.0)
    args = parser.parse_args()

    try:
        haar, embedder, predictor = load_models()
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': f'Failed loading models: {e}'}))
        sys.exit(1)

    # bootstrap
    users = bootstrap_users(haar, embedder)
    
    # Debugging puposes ni
    print(f"DEBUG: Loaded {len(users)} users with embeddings", file=sys.stderr)
    for name in users.keys():
        print(f"DEBUG: User: {name}", file=sys.stderr)

    # use the landmarks-aware recognizer so calling code may draw landmarks
    result = recognize_image_with_landmarks(args.image, haar, embedder, predictor, users, threshold=args.threshold)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
