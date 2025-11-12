import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS



#ang mga debugging na print statements pwede mo na i-remove pag okay na





SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.append(SCRIPTS_DIR)

try:
    from server import ( 
        PHP_API_URL,
        login_user as py_login_user,
        recognize_from_frame_data,
        register_user as py_register_user,
        reenroll_user as py_reenroll_user,
        scan_for_recognition,
    )

    FACIAL_RECOGNITION_AVAILABLE = True

except Exception as exc:
    FACIAL_RECOGNITION_AVAILABLE = False
    PHP_API_URL = "http://localhost/api"
    print(f"[ERROR] Could not import facial recognition stack: {exc}")

app = Flask(__name__)
CORS(app)

def _ensure_stack_ready() -> None:
    if not FACIAL_RECOGNITION_AVAILABLE:
        raise RuntimeError("Facial recognition modules are unavailable. Please verify server.py is accessible.")

# Parse payload as dictionary
def _parse_payload() -> Dict[str, Any]:
    if request.is_json:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            return payload

    if request.form:
        return request.form.to_dict()

    if request.data:
        try:
            payload = request.get_json(force=True, silent=True)
            if isinstance(payload, dict):
                return payload
        except Exception:
            pass

    return {}

def _extract_frames(payload: Dict[str, Any]) -> List[str]:
    frames: List[str] = []

    raw_frames = payload.get("frames")
    
    # returns a list of image sources regardless of whether 
    # payload['frames'] is a single image or a list
    if isinstance(raw_frames, list):
        frames = [frame for frame in raw_frames if isinstance(frame, str) and frame]

    if not frames:
        single_frame = payload.get("frame")
        if isinstance(single_frame, str) and single_frame:
            frames = [single_frame]

    return frames

def _lookup_user(name: Optional[str]) -> Optional[Dict[str, Any]]:
    if not name:
        return None
    try:
        response = requests.get(f"{PHP_API_URL}/get-state", timeout=5)
        if response.ok:
            payload = response.json()
            if isinstance(payload, dict):
                for user in payload.get("users", []):
                    if user.get("name") == name:
                        return user
    except Exception as exc: 
        print(f"[WARN] Failed to look up user details for {name}: {exc}")

    return None

def _timestamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")

@app.route("/", methods=["GET"])
def service_healthcheck():
    status_code = 200 if FACIAL_RECOGNITION_AVAILABLE else 500
    return (
        jsonify(
            {
                "status": "ok" if FACIAL_RECOGNITION_AVAILABLE else "error",
                "stack_ready": FACIAL_RECOGNITION_AVAILABLE,
                "timestamp": _timestamp(),
            }
        ),
        status_code,
    )

@app.route("/register", methods=["POST"])
def register_user():
    try:
        # Check dependencies are initialized
        _ensure_stack_ready()
        
        payload = _parse_payload()
        name = payload.get("name")

        # If name does not exist, return 404
        if not name:
            return jsonify({"status": "error", "message": "Missing name parameter"}), 400

        frames = _extract_frames(payload)
        if not frames:
            return jsonify({"status": "error", "message": "No frame data supplied"}), 400

        print(f"[SERVICE] Registration requested for: {name} ({len(frames)} frames)")

        result = py_register_user(
            name,
            user_id=payload.get("id") or payload.get("user_id"),
            role=payload.get("role", "Student"),
            dept=payload.get("dept"),
            username=payload.get("username"),
            password=payload.get("password"),
            frames=frames,
        )

        if result.get("status") == "success":
            php_response = result.get("php_response")
            if isinstance(php_response, dict):
                user_id = php_response.get("user_id")
                if user_id:
                    result["id"] = user_id

        return jsonify(result)

    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500

    except Exception as exc:
        print(f"[ERROR] Registration failure: {exc}")
        return jsonify({"status": "error", "message": str(exc)}), 500

@app.route("/login", methods=["POST"])
def login_user():
    try:
        _ensure_stack_ready()
        payload = _parse_payload()
        name = payload.get("name")

        if not name:
            return jsonify({"status": "error", "message": "Missing name parameter"}), 400

        print(f"[SERVICE] Login requested for: {name}")

        # attempt login
        result = py_login_user(name)
        
        return jsonify(result)
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    except Exception as exc:
        print(f"[ERROR] Login failure: {exc}")
        return jsonify({"status": "error", "message": str(exc)}), 500

@app.route("/reenroll", methods=["POST"])
def reenroll_user():
    try:
        _ensure_stack_ready()
        payload = _parse_payload()
        name = payload.get("name")

        if not name:
            return jsonify({"status": "error", "message": "Missing name parameter"}), 400

        print(f"[SERVICE] Re-enrollment requested for: {name}")

        frames = _extract_frames(payload)
        result = py_reenroll_user(
            name,
            user_id=payload.get("id") or payload.get("user_id"),
            role=payload.get("role", "Student"),
            dept=payload.get("dept"),
            username=payload.get("username"),
            password=payload.get("password"),
            frames=frames or None,
        )
        return jsonify(result)
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    except Exception as exc:
        print(f"[ERROR] Re-enrollment failure: {exc}")
        return jsonify({"status": "error", "message": str(exc)}), 500

@app.route("/recognize", methods=["POST"])
def recognize():
    try:
        _ensure_stack_ready()
        payload = _parse_payload()
        frames = _extract_frames(payload)

        if not frames:
            return jsonify({
                "status": "error",
                "message": "No frame data provided for recognition."
            }), 400

        scan_result = recognize_from_frame_data(frames[0])

        status = (scan_result.get("status") or "").lower()

        if status == "success":
            identity = scan_result.get("name") or scan_result.get("identity")
            details = _lookup_user(identity)

            response: Dict[str, Any] = {
                **scan_result,
                "name": identity,
                "timestamp": _timestamp(),
            }

            if details:
                if details.get("id"):
                    response["id"] = details["id"]
                if details.get("role"):
                    response["role"] = details["role"]
                if details.get("dept"):
                    response["dept"] = details["dept"]

            return jsonify(response)

        if status == "unrecognized":
            response = {
                **scan_result,
                "recognized": False,
                "timestamp": scan_result.get("timestamp", _timestamp()),
            }
            return jsonify(response), 200

        if status == "partial":
            response = {
                **scan_result,
                "timestamp": scan_result.get("timestamp", _timestamp()),
            }
            return jsonify(response), 206

        return jsonify(scan_result), 500
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    except Exception as exc:
        print(f"[ERROR] Recognition failure: {exc}")
        return jsonify({"status": "error", "message": str(exc)}), 500

if __name__ == "__main__":
    print("============================================================")
    print("          Facial Recognition Service Bridge (TechNest)       ")
    print("============================================================")
    print("Host: 0.0.0.0 | Port: 5001")
    print("CORS: Enabled")
    print(f"Recognition stack available: {FACIAL_RECOGNITION_AVAILABLE}")
    print(f"PHP API URL: {PHP_API_URL}")
    app.run(host="0.0.0.0", port=5001, debug=True)