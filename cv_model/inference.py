"""
Injury Detection Inference Pipeline
====================================
Uses YOLOv8-pose to detect people and extract keypoints, then runs a
trained classifier to label each person as OK or POTENTIALLY INJURED.

Usage:
    python inference.py                     # webcam
    python inference.py --source video.mp4  # video file
    python inference.py --source image.jpg  # single image
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import joblib
import numpy as np
from ultralytics import YOLO

MODEL_DIR = Path(__file__).parent / "model"
CLASSIFIER_PATH = MODEL_DIR / "injury_classifier.pkl"

LABEL_MAP = {0: "OK", 1: "INJURED"}
COLOR_MAP = {0: (0, 200, 0), 1: (0, 0, 255)}  # BGR


def extract_features(keypoints: np.ndarray) -> np.ndarray:
    """
    Extract 11 geometric features from a (17, 2) or (17, 3) keypoint array.
    Must stay in sync with the training notebook.
    """
    kps = np.array(keypoints)
    if kps.shape[-1] == 3:
        kps = kps[:, :2]

    nose = kps[0]
    l_shoulder, r_shoulder = kps[5], kps[6]
    l_hip, r_hip = kps[11], kps[12]
    l_knee, r_knee = kps[13], kps[14]
    l_ankle, r_ankle = kps[15], kps[16]

    mid_shoulder = (l_shoulder + r_shoulder) / 2
    mid_hip = (l_hip + r_hip) / 2
    mid_knee = (l_knee + r_knee) / 2
    mid_ankle = (l_ankle + r_ankle) / 2

    x_min, y_min = kps.min(axis=0)
    x_max, y_max = kps.max(axis=0)
    bbox_w = max(x_max - x_min, 1)
    bbox_h = max(y_max - y_min, 1)

    aspect_ratio = bbox_h / bbox_w
    torso_vec = mid_hip - mid_shoulder
    torso_angle = np.arctan2(torso_vec[0], torso_vec[1])
    body_vec = mid_ankle - nose
    body_angle = np.arctan2(body_vec[0], body_vec[1])
    span_ratio = bbox_h / bbox_w if bbox_w > 0 else 0
    nose_hip_vert = abs(nose[1] - mid_hip[1]) / bbox_h
    shoulder_ankle_vert = abs(mid_shoulder[1] - mid_ankle[1]) / bbox_h
    horiz_spread = bbox_w / bbox_h if bbox_h > 0 else 0
    y_variance = np.std(kps[:, 1]) / bbox_h if bbox_h > 0 else 0
    leg_vec = mid_ankle - mid_hip
    leg_angle = np.arctan2(leg_vec[0], leg_vec[1])
    body_center_y = (y_min + y_max) / 2
    head_relative = (body_center_y - nose[1]) / bbox_h
    knee_ankle_vert = abs(mid_knee[1] - mid_ankle[1]) / bbox_h

    return np.array([
        aspect_ratio,
        abs(torso_angle),
        abs(body_angle),
        span_ratio,
        nose_hip_vert,
        shoulder_ankle_vert,
        horiz_spread,
        y_variance,
        abs(leg_angle),
        head_relative,
        knee_ankle_vert,
    ])


def draw_status_bar(frame: np.ndarray, ok_count: int, injured_count: int) -> None:
    """Draw a translucent status bar at the top of the frame."""
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 50), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

    text = f"OK: {ok_count}  |  INJURED: {injured_count}"
    cv2.putText(frame, text, (15, 35),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)


def process_frame(
    frame: np.ndarray,
    pose_model: YOLO,
    classifier,
) -> tuple[np.ndarray, list[dict]]:
    """
    Full inference pipeline on one frame.
    Returns the annotated frame and a list of detection dicts.
    """
    results = pose_model(frame, verbose=False)
    detections = []

    for r in results:
        if r.keypoints is None or r.boxes is None:
            continue

        keypoints_data = r.keypoints.data.cpu().numpy()
        boxes = r.boxes.xyxy.cpu().numpy()

        for kps, box in zip(keypoints_data, boxes):
            if kps.shape[0] != 17:
                continue

            kps_xy = kps[:, :2]
            valid = np.sum(np.any(kps_xy > 0, axis=1))
            if valid < 8:
                continue

            features = extract_features(kps_xy).reshape(1, -1)
            pred = int(classifier.predict(features)[0])
            prob = classifier.predict_proba(features)[0]
            conf = prob[pred]

            label = LABEL_MAP[pred]
            color = COLOR_MAP[pred]

            x1, y1, x2, y2 = box.astype(int)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            text = f"{label} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(
                text, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2
            )
            cv2.rectangle(
                frame, (x1, y1 - th - 14), (x1 + tw + 8, y1), color, -1
            )
            cv2.putText(
                frame, text, (x1 + 4, y1 - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2,
            )

            skeleton_edges = [
                (5, 7), (7, 9), (6, 8), (8, 10),
                (5, 6), (5, 11), (6, 12), (11, 12),
                (11, 13), (13, 15), (12, 14), (14, 16),
            ]
            for i, j in skeleton_edges:
                p1 = tuple(kps_xy[i].astype(int))
                p2 = tuple(kps_xy[j].astype(int))
                if all(v > 0 for v in p1 + p2):
                    cv2.line(frame, p1, p2, color, 2)

            for kp in kps_xy:
                cx, cy = int(kp[0]), int(kp[1])
                if cx > 0 and cy > 0:
                    cv2.circle(frame, (cx, cy), 5, color, -1)

            detections.append({
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "label": label,
                "confidence": float(conf),
            })

    return frame, detections


def run_webcam(pose_model: YOLO, classifier) -> None:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam.")
        sys.exit(1)

    print("Webcam opened. Press 'q' to quit.")
    fps_history: list[float] = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        t0 = time.perf_counter()
        annotated, detections = process_frame(frame, pose_model, classifier)
        dt = time.perf_counter() - t0
        fps_history.append(1.0 / max(dt, 1e-6))
        if len(fps_history) > 30:
            fps_history.pop(0)
        avg_fps = sum(fps_history) / len(fps_history)

        cv2.putText(
            annotated, f"FPS: {avg_fps:.1f}",
            (annotated.shape[1] - 160, 35),
            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2,
        )

        cv2.imshow("Injury Detection - Robot Dog SAR", annotated)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


def run_video(source: str, pose_model: YOLO, classifier) -> None:
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"ERROR: Cannot open video: {source}")
        sys.exit(1)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    out_path = str(Path(source).stem) + "_annotated.mp4"
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    print(f"Processing {source} ({total} frames)...")
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        annotated, detections = process_frame(frame, pose_model, classifier)
        writer.write(annotated)
        frame_idx += 1

        if frame_idx % 30 == 0:
            print(f"  Frame {frame_idx}/{total}", end="\r")

        cv2.imshow("Injury Detection", annotated)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    writer.release()
    cv2.destroyAllWindows()
    print(f"\nSaved annotated video: {out_path}")


def run_image(source: str, pose_model: YOLO, classifier) -> None:
    frame = cv2.imread(source)
    if frame is None:
        print(f"ERROR: Cannot read image: {source}")
        sys.exit(1)

    annotated, detections = process_frame(frame, pose_model, classifier)
    for d in detections:
        print(f"  [{d['label']}] conf={d['confidence']:.0%}  bbox={d['bbox']}")

    out_path = str(Path(source).stem) + "_annotated.jpg"
    cv2.imwrite(out_path, annotated)
    print(f"Saved: {out_path}")

    cv2.imshow("Injury Detection", annotated)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description="Injury Detection Inference")
    parser.add_argument("--source", type=str, default=None,
                        help="Path to video/image. Omit for webcam.")
    parser.add_argument("--model-size", type=str, default="s",
                        choices=["n", "s", "m", "l"],
                        help="YOLOv8-pose model size (default: s)")
    args = parser.parse_args()

    if not CLASSIFIER_PATH.exists():
        print(f"ERROR: Classifier not found at {CLASSIFIER_PATH}")
        print("Train the model in the Colab notebook first, then place")
        print("injury_classifier.pkl in the cv_model/model/ directory.")
        sys.exit(1)

    print("Loading models...")
    pose_model = YOLO(f"yolov8{args.model_size}-pose.pt")
    classifier = joblib.load(CLASSIFIER_PATH)
    print("Models loaded.\n")

    if args.source is None:
        run_webcam(pose_model, classifier)
    elif args.source.lower().endswith((".mp4", ".avi", ".mov", ".mkv", ".webm")):
        run_video(args.source, pose_model, classifier)
    else:
        run_image(args.source, pose_model, classifier)


if __name__ == "__main__":
    main()
