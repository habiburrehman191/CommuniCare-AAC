import os
import glob
import json
import hashlib
import numpy as np
from collections import Counter
from sklearn.model_selection import StratifiedShuffleSplit

FROZEN_CLASSES = [
    "water",
    "help",
    "hungry",
    "need",
    "want",
    "hello",
    "thankyou",
    "NO_SIGN"
]

LABEL_TO_ID = {cls: idx for idx, cls in enumerate(FROZEN_CLASSES)}
ID_TO_LABEL = {idx: cls for idx, cls in enumerate(FROZEN_CLASSES)}
NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
DATA_DIR = os.path.join(PROJECT_ROOT, "training", "data")

def hash_sample(sample):
    h = hashlib.sha256()
    for frame in sample['frames']:
        for val in frame:
            h.update(f"{val:.6f}".encode('utf-8'))
    return h.hexdigest()

def load_four_real_signers():
    """
    Loads exclusively the four genuine human signers:
    signer-01, signer-02, signer-03, signer-04.
    Strictly deduplicates to guarantee 808 unique samples.
    """
    json_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    if not json_files:
        raise FileNotFoundError(f"No JSON dataset files found in {DATA_DIR}")

    seen_hashes = {}
    samples = []
    
    for fpath in json_files:
        with open(fpath, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        
        for idx, s in enumerate(data.get("samples", [])):
            signer = s.get("signerAlias")
            if signer not in ["signer-01", "signer-02", "signer-03", "signer-04"]:
                # Exclude any other signer
                continue
                
            label = s.get("label")
            if label not in LABEL_TO_ID:
                continue
                
            frames = s.get("frames", [])
            if len(frames) != 60:
                continue
                
            shash = hash_sample(s)
            if shash in seen_hashes:
                # Deduplicate identical recordings (e.g. signer-03 present in signer-04 export)
                continue
                
            seen_hashes[shash] = True
            
            samples.append({
                "id": f"{signer}_{label}_{len(samples)}_{shash[:8]}",
                "signer": signer,
                "label": label,
                "label_id": LABEL_TO_ID[label],
                "frames": np.array(frames, dtype=np.float32),
                "hash": shash
            })

    print(f"Loaded {len(samples)} total unique genuine samples from {len(json_files)} files.")
    signer_dist = Counter(s["signer"] for s in samples)
    class_dist = Counter(s["label"] for s in samples)
    print(f"Signer distribution: {dict(signer_dist)}")
    print(f"Class distribution: {dict(class_dist)}")
    
    assert len(samples) == 808, f"Expected 808 unique samples, got {len(samples)}"
    return samples

def compute_position_velocity_features(frames_pos):
    """
    Computes 252 pos_vel features per frame:
    126 position + 126 velocity.
    Missing-hand semantics:
      Left slot: 0..62. Right slot: 63..125.
      If a hand slot is absent in frame t OR frame t-1,
      velocity for that slot is strictly ZERO.
      v[0] is strictly ZERO.
    """
    T, D = frames_pos.shape
    assert D == 126, f"Expected 126 position features, got {D}"

    vel = np.zeros((T, D), dtype=np.float32)

    # Detect hand presence in each frame
    left_present = np.any(np.abs(frames_pos[:, :63]) > 1e-5, axis=1)
    right_present = np.any(np.abs(frames_pos[:, 63:]) > 1e-5, axis=1)

    for t in range(1, T):
        if left_present[t] and left_present[t - 1]:
            vel[t, :63] = frames_pos[t, :63] - frames_pos[t - 1, :63]
        else:
            vel[t, :63] = 0.0

        if right_present[t] and right_present[t - 1]:
            vel[t, 63:] = frames_pos[t, 63:] - frames_pos[t - 1, 63:]
        else:
            vel[t, 63:] = 0.0

    return np.concatenate([frames_pos, vel], axis=-1)

def apply_safe_augmentation(window_pos, rng):
    """
    Mild train-only spatial and noise augmentation on position frames [T, 126].
    - Coordinate scaling: [0.96, 1.04]
    - Small 2D rotation: [-5, +5] degrees around origin/wrist
    - Mild Gaussian landmark noise: std=0.004
    Does NOT swap left/right semantics.
    """
    T, D = window_pos.shape
    aug = window_pos.copy()

    # Scale factor
    scale = rng.uniform(0.96, 1.04)

    # Rotation angle (radians)
    angle = np.deg2rad(rng.uniform(-5.0, 5.0))
    cos_a, sin_a = np.cos(angle), np.sin(angle)
    rot_mat = np.array([
        [cos_a, -sin_a, 0.0],
        [sin_a,  cos_a, 0.0],
        [0.0,    0.0,   1.0]
    ], dtype=np.float32)

    # Landmark noise
    noise = rng.normal(0.0, 0.004, size=(T, D)).astype(np.float32)

    for t in range(T):
        # Process left hand (0..62: 21 landmarks * 3)
        left_vals = aug[t, :63]
        if np.any(np.abs(left_vals) > 1e-5):
            left_pts = left_vals.reshape(21, 3) * scale
            left_pts = np.dot(left_pts, rot_mat.T)
            aug[t, :63] = left_pts.flatten() + noise[t, :63]

        # Process right hand (63..125: 21 landmarks * 3)
        right_vals = aug[t, 63:126]
        if np.any(np.abs(right_vals) > 1e-5):
            right_pts = right_vals.reshape(21, 3) * scale
            right_pts = np.dot(right_pts, rot_mat.T)
            aug[t, 63:126] = right_pts.flatten() + noise[t, 63:126]

    return aug

def extract_consecutive_train_windows(frames_60, target_len=24):
    """
    Extracts controlled consecutive sub-windows from 60 frames.
    For target_len=24: offsets [0, 6, 12, 18, 24, 30, 36] (7 windows)
    For target_len=30: offsets [0, 5, 10, 15, 20, 25, 30] (7 windows)
    """
    if target_len == 24:
        offsets = [0, 6, 12, 18, 24, 30, 36]
    elif target_len == 30:
        offsets = [0, 5, 10, 15, 20, 25, 30]
    else:
        step = max(1, (60 - target_len) // 6)
        offsets = list(range(0, 60 - target_len + 1, step))[:7]

    windows = []
    for st in offsets:
        if st + target_len <= 60:
            windows.append(frames_60[st:st + target_len])
    return windows

def extract_consecutive_center_window(frames_60, target_len=24):
    st = (60 - target_len) // 2
    return frames_60[st:st + target_len]

def build_fold_arrays(samples, target_len=24, is_training=False, rng=None, augment=False):
    """
    Builds X, y arrays for a given sample list.
    If is_training and augment is True, adds augmented windows.
    Validation and test MUST have is_training=False and augment=False.
    """
    X_list = []
    y_list = []

    for s in samples:
        frames_60 = s["frames"]
        lbl_id = s["label_id"]

        if is_training:
            windows = extract_consecutive_train_windows(frames_60, target_len)
            for w in windows:
                feat = compute_position_velocity_features(w)
                X_list.append(feat)
                y_list.append(lbl_id)

                if augment and rng is not None:
                    # Mild spatial augmentation
                    w_aug = apply_safe_augmentation(w, rng)
                    feat_aug = compute_position_velocity_features(w_aug)
                    X_list.append(feat_aug)
                    y_list.append(lbl_id)
        else:
            w = extract_consecutive_center_window(frames_60, target_len)
            feat = compute_position_velocity_features(w)
            X_list.append(feat)
            y_list.append(lbl_id)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.int64)
