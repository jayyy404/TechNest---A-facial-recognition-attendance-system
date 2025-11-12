import cv2
import dlib
import numpy as np
import pickle
import sys
import os
import time
import requests
from keras_facenet import FaceNet
from deepface import DeepFace
from flask import Flask, request, jsonify

app = Flask(__name__)


haar_cascade = cv2.CascadeClassifier(cv2.samples.findFile("resources/haar_face.xml"))
predictor = dlib.shape_predictor("shape_predictor/shape_predictor_68_face_landmarks.dat")
embedder = FaceNet()

#Mediapipe - Autofocus integration for stabilized face detection, if possible for Haar Cascades.

# url = "http://192.168.1.2/TN/api_insert.php"

DATASET_DIR = r"C:\TechNest_Rec_Dataset"
if not os.path.exists(DATASET_DIR):
    os.makedirs(DATASET_DIR)

def bring_window_to_front(winname):
    """Force OpenCV window to the front/topmost."""
    cv2.namedWindow(winname, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(winname, cv2.WND_PROP_TOPMOST, 1)

def configure_camera(cap, calibration_time=2.5):
    """
    Configure webcam with autofocus (auto-lock) and auto-adjusted lighting.
    - Autofocus enabled for a few seconds, then locked to prevent focus hunting, 
    but face at present to webcam to work.
    - Exposure, brightness, contrast, saturation tuned for balanced lighting, 
    but manual configuration of values for adapting background lightning
    conditions at custom.
    """

    # Try enabling autofocus (works on many USB cams)
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)

    # Allow autofocus to stabilize
    start = time.time()
    while time.time() - start < calibration_time:
        ret, _ = cap.read()
        if not ret:
            break
        cv2.waitKey(1)

    # Lock focus after calibration but slight adjustments for proper focus at user's facial detection
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)

    # Auto-exposure ON (0.25 on some drivers, may vary) but would depend on the backlight environment
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 68.5)

    # Tune brightness, contrast, saturation (values may need tweaking per camera)
    cap.set(cv2.CAP_PROP_BRIGHTNESS, 77.0)   # customized at values 50-70
    cap.set(cv2.CAP_PROP_CONTRAST, 83.0)     # customized at values 70-90
    cap.set(cv2.CAP_PROP_SATURATION, 93.0)   # customized at values 80-100

    print("[Camera] Autofocus calibrated and locked. Auto-adjust lighting enabled by admin.")
    #Can be possibly manipulate values at custom bg lightning.


def detect_face(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = haar_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=6, minSize=(170, 170))
    return max(faces, key=lambda b: b[2] * b[3]) if len(faces) > 0 else None

def validate_distance_and_faces(frame, faces, min_width=170):
    """
    Validate detected faces based on distance and count.
    - Only 1 face allowed.
    - Distance check based on bounding box width (proxy).
    Returns: (valid, box, msg, color)
    """
    if len(faces) != 1:
        return False, None, "Multiple/No Faces Detected", (0, 0, 255)

    (x, y, w, h) = faces[0]
    if w >= min_width:  # Close enough (~15 inches or less)
        return True, (x, y, w, h), "", (0, 255, 0)
    else:  # Too far
        return False, (x, y, w, h), "Please get closer to the webcam. Assist by TechNest Admin", (0, 0, 255)

def get_embedding(frame, box):
    x, y, w, h = box
    face_crop = frame[y:y+h, x:x+w]
    if face_crop.size == 0:
        return None
    face_crop = cv2.resize(face_crop, (160, 160))
    return embedder.embeddings([face_crop])[0]

def is_real_face(frame, box, user_dir=None, name=None, sample_type="register", liveness_time=2.0):
    """
    Liveness + Anti-Spoofing check using DeepFace with a 2.5s dynamic scan window.
    Works for Register, Reenroll, Login, and Logout.
    """
    x, y, w, h = box
    face_crop = frame[y:y+h, x:x+w]
    if face_crop.size == 0:
        return False

    start_time = time.time()
    dynamic_detected = False

    try:
        while time.time() - start_time < liveness_time:
            result = DeepFace.extract_faces(
                img_path=face_crop,
                detector_backend="opencv",
                enforce_detection=False,
                anti_spoofing=True
            )

            if result and result[0].get("is_real", False):
                dynamic_detected = True
                # draw a green status message while liveness is being verified
                cv2.putText(frame, "Liveness Verified (Blink/Movement)", (30, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.imshow(sample_type.capitalize(), frame)
                cv2.waitKey(1)

            # refresh the face_crop each loop
            new_faces = haar_cascade.detectMultiScale(
                cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY),
                scaleFactor=1.3, minNeighbors=6, minSize=(120, 120)
            )
            if len(new_faces) == 1:
                x2, y2, w2, h2 = new_faces[0]
                face_crop = frame[y2:y2+h2, x2:x2+w2]

        if dynamic_detected:
            return True
        else:
            # Spoof detected
            popup = np.zeros((200, 600, 3), dtype=np.uint8)
            cv2.putText(popup, "Spoof Image detected!", (30, 100),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 3)
            cv2.imshow("Spoof Alert", popup)
            cv2.waitKey(3000)
            cv2.destroyWindow("Spoof Alert")
            print(f"[!] Spoof attempt detected during {sample_type}. Session terminated.")
            sys.exit(0)

    except Exception as e:
        print(f"[!] Spoof check failed: {e}")
        return False

def save_user(name, embedding):
    user_dir = os.path.join(DATASET_DIR, name)
    os.makedirs(user_dir, exist_ok=True)
    pkl_path = os.path.join(user_dir, f"{name}_embedding.pkl")

    with open(pkl_path, "wb") as f:
        pickle.dump(embedding, f)
    return True
def fetch_users():
    users = []
    for user in os.listdir(DATASET_DIR):
        user_dir = os.path.join(DATASET_DIR, user)
        if os.path.isdir(user_dir):
            for f in os.listdir(user_dir):
                if f.endswith("_embedding.pkl"):
                    with open(os.path.join(user_dir, f), "rb") as file:
                        emb = pickle.load(file)
                        users.append((user, emb))
    return users

def recognize_face(embedding, threshold=0.8):
    users = fetch_users()
    min_dist, identity = float("inf"), "Unknown"
    for name, db_emb in users:
        dist = np.linalg.norm(embedding - db_emb)
        if dist < min_dist:
            min_dist, identity = dist, name
    return (identity, min_dist) if min_dist < threshold else ("Unknown", min_dist)

def restart_camera(cap):
    """Release and reopen the webcam, reconfigure it, return new capture object."""
    cap.release()
    cap = cv2.VideoCapture(0)
    configure_camera(cap)
    print("[Camera] Webcam restarted successfully.")
    return cap

def eye_aspect_ratio(eye):
    # compute EAR using 6 eye landmarks
    A = np.linalg.norm(eye[1] - eye[5])
    B = np.linalg.norm(eye[2] - eye[4])
    C = np.linalg.norm(eye[0] - eye[3])
    return (A + B) / (2.0 * C)

def detect_blink(shape):
    # landmarks for left and right eyes
    left_eye = np.array([(shape.part(i).x, shape.part(i).y) for i in range(36, 42)])
    right_eye = np.array([(shape.part(i).x, shape.part(i).y) for i in range(42, 48)])

    left_ear = eye_aspect_ratio(left_eye)
    right_ear = eye_aspect_ratio(right_eye)

    return (left_ear + right_ear) / 2.0

def test_webcam():
    cap = cv2.VideoCapture(0)
    configure_camera(cap)

    print("[Webcam Test] Press ESC to exit test mode.")
    start_time = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        box = detect_face(frame)
        if box is not None:
            x, y, w, h = box
            cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
            cv2.putText(frame, "Face Detected", (x, y-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        cv2.imshow("Webcam Test", frame)
        bring_window_to_front("Webcam Test")
        key = cv2.waitKey(1) & 0xFF

        if key == 27: 
            break
        elif key in [ord("r"), ord("R")]:
            ca = restart_camera(cap)
        elif key in [ord("t"), ord("T")]:
            print("[!] Force close session.")
            cap.release()
            cv2.destroyAllWindows()
            return

    cap.release()
    cv2.destroyAllWindows()

@app.route("/register", methods=["POST"])
def register_user():
    name = request.form.get("name")
    if not name:
        return jsonify({"status": "error", "message": "Missing name"}), 400

    cap = cv2.VideoCapture(0)
    samples = []
    count = 0

    while count < 7:
        ret, frame = cap.read()
        if not ret:
            break
        box = detect_face(frame)
        if box is not None:
            emb = get_embedding(frame, box)
            if emb is not None:
                samples.append(emb)
                count += 1
                time.sleep(1)

    cap.release()
    cv2.destroyAllWindows()

    if len(samples) >= 7:
        avg_emb = np.mean(samples, axis=0)
        save_user(name, avg_emb)
        return jsonify({"status": "success", "message": f"User {name} registered"})
    else:
        return jsonify({"status": "error", "message": "Insufficient samples"})


@app.route("/reenroll", methods=["POST"])
def reenroll_user():
    username = request.form.get("name")
    if not username:
        return jsonify({"status": "error", "message": "Missing name"}), 400

    user_dir = os.path.join(DATASET_DIR, username)
    if os.path.exists(user_dir):
        for f in os.listdir(user_dir):
            os.remove(os.path.join(user_dir, f))

    return register_user()

@app.route("/login", methods=["POST"])
def login_user():
    username = request.form.get("name")
    if not username:
        return jsonify({"status": "error", "message": "Missing name"}), 400

    cap = cv2.VideoCapture(0)
    verified = False
    count = 0

    while count < 7:
        ret, frame = cap.read()
        if not ret:
            break
        box = detect_face(frame)
        if box is not None:
            emb = get_embedding(frame, box)
            if emb is not None:
                identity, dist = recognize_face(emb)
                if identity == username:
                    count += 1
                    time.sleep(1)

    cap.release()
    cv2.destroyAllWindows()

    if count >= 7:
        return jsonify({"status": "success", "message": f"User {username} verified"})
    else:
        return jsonify({"status": "error", "message": "Login failed"})

@app.route("/logout", methods=["POST"])
def logout_user():
    # Here you can just log event, or do re-verification like login
    username = request.form.get("name")
    return jsonify({"status": "success", "message": f"User {username} logged out"})

if __name__ == "__main__":
    print("--------------------------------------------------------------------------------")
    print("Directions: (One person/new user only for new facial scanning)")
    print("=>For new users (Register)<=")
    print("1.) Choose/Type (1) to register for new users and press enter")
    print("2.) Type your name to fill the blank and press enter")
    print("3.) A (you) user must face infront of the webcam and adjust his/her" \
    "facial expression to neutral for several seconds of preparation")
    print("4.) Face at the webcam within 15 inches (38.1 cm) in proximity of the webcam for stable scanning")
    print("5.) As the webcam starts scanning your facial landmarks, no sudden movements, " \
    "except your facial features: e.g. blinking to verify liveness")
    print("6.) As the webcam captures your facial landmarks to the information system completed," \
    "the next new user would do the same steps 1-5 all over again")
    print("=>For existing users to re-train facial dataset for obvious reasons(Re-enroll)<=")
    print("1.) For exisitng users, choose (3) Re-enroll and press enter")
    print("2.) Type your name to fill the blank and press enter to overwrite facial dataset")
    print("3.) Do the same as step no.3 and no.4 from register to capture your facial data smoothly as possible")
    print("4.) As the webcam captures your facial landmarks as step no.5 (register)," \
    "the existing user should update his/her"
    "facial dataset needed, if any slight changes to facial features: e.g. tatoo/facial hair")
    print("=>For existing users (Login)<=")
    print("1.) Choose/Type (2) to login for existing users and press enter")
    print("2.) Type your name to fill the blank as exisitng (user) in the blank")
    print("3.) As same as register/reenroll, please face at the webcam for a stable capture of the" \
    "within the designated distance of the proximity of the facial scanning")
    print("4.) As the webcam captures (same as register/reenroll) your facial profile from two datasets"
    "(MySQL-DB and Secondary Custom Dataset) to compare embeddings of the users' facial landmarks to" \
    "find a match from either datasets. If not (match), rejects and close the session")
    print("5.) The information systems accepts the users' facial dataset to signal at the website as" \
    "geniune user at attendance")
    print("=>For existing users to exit TechNest Room (Logout-revise)<=")
    print("1.) ")
    print("--------------------------------------------------------------------------------")
    print("=== TechNest Recognition - Information/Attendance System for facial scanning===")
    print("Think and choose your option wisely!")
    print("1. Register User (New)")
    print("2. Login User")
    print("3. Re-enroll User (Existing)")
    print("4. Logout User (Exit TechNest Room)")
    print("5. Test Webcam")
choice = input("Select option: ")

if choice == "1":
    register_user()
elif choice == "2":
    login_user()
elif choice == "3":
    reenroll_user()
elif choice == "4":
    logout_user()
elif choice == "5":
    test_webcam()
else:
    print("Invalid choice.")