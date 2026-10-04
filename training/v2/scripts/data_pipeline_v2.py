import os
import glob
import json
import numpy as np
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
DATA_DIR = os.path.join(TRAINING_DIR, "data")
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

def load_original_dataset(data_dir=DATA_DIR):
    """
    Loads all original samples from training/data JSON files.
    Returns:
        samples: list of dicts with keys:
            'id': string unique original sample id (e.g. signer-01_sample_0)
            'signer': 'signer-01' or 'signer-02'
            'label': class name
            'label_id': int 0..7
            'frames': np.ndarray of shape (60, 126), dtype np.float32
            'metadata': dict
    """
    json_files = sorted(glob.glob(os.path.join(data_dir, "*.json")))
    if not json_files:
        raise FileNotFoundError(f"No JSON dataset files found in {data_dir}")

    samples = []
    for jf in json_files:
        with open(jf, "r", encoding="utf-8") as f:
            data = json.load(f)
        for idx, s in enumerate(data.get("samples", [])):
            label = s["label"]
            if label not in LABEL_TO_ID:
                raise ValueError(f"Unknown label '{label}' not in frozen classes!")
            if s.get("featureSchema") != "wrist_normalized_v1":
                raise ValueError(f"Feature schema '{s.get('featureSchema')}' != wrist_normalized_v1")
            frames = s["frames"]
            if len(frames) != 60:
                raise ValueError(f"Sample has {len(frames)} frames != 60")
            
            signer = s["signerAlias"]
            sample_id = f"{signer}_{label}_{idx}_{s.get('capturedAt', '')}"
            samples.append({
                "id": sample_id,
                "signer": signer,
                "label": label,
                "label_id": LABEL_TO_ID[label],
                "frames": np.array(frames, dtype=np.float32),
                "metadata": {
                    "cameraFacing": s.get("cameraFacing", "user"),
                    "capturedAt": s.get("capturedAt", "")
                }
            })

    print(f"Loaded {len(samples)} total original samples from {len(json_files)} files.")
    return samples

def create_loso_splits(samples, val_ratio=0.2, seed=42):
    """
    Splits samples at the ORIGINAL SAMPLE LEVEL to prevent any leakage.
    RUN A: Train/Val = signer-01, Test = signer-02
    RUN B: Train/Val = signer-02, Test = signer-01
    """
    s1_samples = [s for s in samples if s["signer"] == "signer-01"]
    s2_samples = [s for s in samples if s["signer"] == "signer-02"]

    # Stratified split for signer-01
    s1_labels = [s["label_id"] for s in s1_samples]
    sss_a = StratifiedShuffleSplit(n_splits=1, test_size=val_ratio, random_state=seed)
    train_idx_a, val_idx_a = next(sss_a.split(np.zeros(len(s1_samples)), s1_labels))
    run_a_train = [s1_samples[i] for i in train_idx_a]
    run_a_val = [s1_samples[i] for i in val_idx_a]
    run_a_test = list(s2_samples)  # Complete held-out signer-02

    # Stratified split for signer-02
    s2_labels = [s["label_id"] for s in s2_samples]
    sss_b = StratifiedShuffleSplit(n_splits=1, test_size=val_ratio, random_state=seed)
    train_idx_b, val_idx_b = next(sss_b.split(np.zeros(len(s2_samples)), s2_labels))
    run_b_train = [s2_samples[i] for i in train_idx_b]
    run_b_val = [s2_samples[i] for i in val_idx_b]
    run_b_test = list(s1_samples)  # Complete held-out signer-01

    # Save split manifests
    manifest_a = {
        "run": "RUN_A",
        "train_signer": "signer-01",
        "test_signer": "signer-02",
        "train_sample_ids": [s["id"] for s in run_a_train],
        "val_sample_ids": [s["id"] for s in run_a_val],
        "test_sample_ids": [s["id"] for s in run_a_test],
        "counts": {
            "train": len(run_a_train),
            "val": len(run_a_val),
            "test": len(run_a_test)
        }
    }
    manifest_b = {
        "run": "RUN_B",
        "train_signer": "signer-02",
        "test_signer": "signer-01",
        "train_sample_ids": [s["id"] for s in run_b_train],
        "val_sample_ids": [s["id"] for s in run_b_val],
        "test_sample_ids": [s["id"] for s in run_b_test],
        "counts": {
            "train": len(run_b_train),
            "val": len(run_b_val),
            "test": len(run_b_test)
        }
    }

    with open(os.path.join(REPORTS_DIR, "split_manifest_run_a.json"), "w", encoding="utf-8") as f:
        json.dump(manifest_a, f, indent=2)
    with open(os.path.join(REPORTS_DIR, "split_manifest_run_b.json"), "w", encoding="utf-8") as f:
        json.dump(manifest_b, f, indent=2)

    return (run_a_train, run_a_val, run_a_test), (run_b_train, run_b_val, run_b_test)

# ==========================================
# WINDOW DERIVATION & AUGMENTATION (POST-SPLIT)
# ==========================================

def center_crop_window(frames_60, target_len):
    """
    Extracts deterministic center crop of target_len from 60 frames.
    """
    start = (60 - target_len) // 2
    return frames_60[start:start + target_len]

def resample_window(frames_60, target_len):
    """
    Temporally resamples 60 frames to target_len using linear interpolation.
    """
    src_indices = np.linspace(0, 59, target_len)
    resampled = np.zeros((target_len, frames_60.shape[1]), dtype=np.float32)
    for feat_idx in range(frames_60.shape[1]):
        resampled[:, feat_idx] = np.interp(src_indices, np.arange(60), frames_60[:, feat_idx])
    return resampled

def extract_window(frames_60, target_len, strategy="center_crop"):
    if strategy == "center_crop":
        return center_crop_window(frames_60, target_len)
    elif strategy == "resample":
        return resample_window(frames_60, target_len)
    else:
        raise ValueError(f"Unknown window strategy: {strategy}")

def augment_train_sample_windows(frames_60, target_len, strategy="center_crop"):
    """
    Generates derived windows FOR TRAINING ONLY from a single original sample.
    Validation and test MUST NOT use this.
    """
    windows = []
    
    if strategy == "center_crop":
        center_start = (60 - target_len) // 2
        # Temporal jitter offsets: e.g. center, -4, +4, -8, +8 (clamped)
        offsets = [0, -4, 4, -8, 8, -2, 2]
        seen_starts = set()
        for offset in offsets:
            st = max(0, min(60 - target_len, center_start + offset))
            if st not in seen_starts:
                seen_starts.add(st)
                windows.append(frames_60[st:st + target_len])
        # Also include resampled window as a variation
        windows.append(resample_window(frames_60, target_len))
    elif strategy == "resample":
        # Base resample
        windows.append(resample_window(frames_60, target_len))
        # Slight sub-span resamples (e.g. frames 3..57, frames 0..54, frames 6..60)
        subspans = [(3, 57), (0, 54), (6, 60), (4, 56)]
        for s_start, s_end in subspans:
            sub_frames = frames_60[s_start:s_end]
            src_idx = np.linspace(0, len(sub_frames) - 1, target_len)
            resampled = np.zeros((target_len, frames_60.shape[1]), dtype=np.float32)
            for f_idx in range(frames_60.shape[1]):
                resampled[:, f_idx] = np.interp(src_idx, np.arange(len(sub_frames)), sub_frames[:, f_idx])
            windows.append(resampled)
            
    return windows

# ==========================================
# FEATURE REPRESENTATION EXTRACTION
# ==========================================

def compute_position_velocity_features(frames_pos):
    """
    Representation B: Position (126) + Velocity (126) = 252 features/frame.
    Missing-hand semantics:
      Left slot: 0..62. Right slot: 63..125.
      If a hand slot is absent in frame t OR frame t-1,
      velocity for that slot is strictly ZERO.
    """
    T, D = frames_pos.shape
    assert D == 126, f"Expected 126 position features, got {D}"

    vel = np.zeros((T, D), dtype=np.float32)

    # Detect hand presence in each frame
    # Left hand: indices 0..62
    left_present = np.any(np.abs(frames_pos[:, :63]) > 1e-5, axis=1)
    # Right hand: indices 63..125
    right_present = np.any(np.abs(frames_pos[:, 63:]) > 1e-5, axis=1)

    for t in range(1, T):
        # Left hand velocity
        if left_present[t] and left_present[t - 1]:
            vel[t, :63] = frames_pos[t, :63] - frames_pos[t - 1, :63]
        else:
            vel[t, :63] = 0.0

        # Right hand velocity
        if right_present[t] and right_present[t - 1]:
            vel[t, 63:] = frames_pos[t, 63:] - frames_pos[t - 1, 63:]
        else:
            vel[t, 63:] = 0.0

    return np.concatenate([frames_pos, vel], axis=-1)  # (T, 252)

def compute_compact_motion_features(frames_pos):
    """
    Representation C: Position (126) + Compact Motion Features (8) = 134 features/frame.
    Motion features:
      1. Left wrist velocity magnitude (Euclidean norm of dx, dy, dz of wrist)
      2. Right wrist velocity magnitude
      3. Left hand mean landmark speed
      4. Right hand mean landmark speed
      5. Left hand presence flag (0.0 or 1.0)
      6. Right hand presence flag (0.0 or 1.0)
      7. Inter-wrist Euclidean distance (0.0 if either hand missing)
      8. Both hands present flag (0.0 or 1.0)
    """
    T, D = frames_pos.shape
    assert D == 126

    # 1. Position + Velocity helper
    pos_vel = compute_position_velocity_features(frames_pos)
    vel = pos_vel[:, 126:]

    left_present = (np.any(np.abs(frames_pos[:, :63]) > 1e-5, axis=1)).astype(np.float32)
    right_present = (np.any(np.abs(frames_pos[:, 63:]) > 1e-5, axis=1)).astype(np.float32)
    both_present = (left_present * right_present)

    motion_feats = np.zeros((T, 8), dtype=np.float32)

    for t in range(T):
        # Left wrist velocity magnitude (wrist is landmark 0, coordinates 0, 1, 2)
        lw_vel = np.linalg.norm(vel[t, 0:3])
        # Right wrist velocity magnitude (wrist is landmark 0 of right hand, coords 63, 64, 65)
        rw_vel = np.linalg.norm(vel[t, 63:66])

        # Mean landmark speed
        # Left hand: 21 landmarks x 3 coords
        l_speeds = [np.linalg.norm(vel[t, i*3:(i+1)*3]) for i in range(21)]
        l_mean_speed = float(np.mean(l_speeds)) if left_present[t] > 0.5 else 0.0

        r_speeds = [np.linalg.norm(vel[t, 63 + i*3:63 + (i+1)*3]) for i in range(21)]
        r_mean_speed = float(np.mean(r_speeds)) if right_present[t] > 0.5 else 0.0

        # Inter-wrist distance
        if both_present[t] > 0.5:
            # wrist positions
            lw_pos = frames_pos[t, 0:3]
            rw_pos = frames_pos[t, 63:66]
            inter_wrist_dist = float(np.linalg.norm(lw_pos - rw_pos))
        else:
            inter_wrist_dist = 0.0

        motion_feats[t] = [
            lw_vel,
            rw_vel,
            l_mean_speed,
            r_mean_speed,
            left_present[t],
            right_present[t],
            inter_wrist_dist,
            both_present[t]
        ]

    return np.concatenate([frames_pos, motion_feats], axis=-1)  # (T, 134)

def transform_sample_to_representation(frames_T, rep_name):
    """
    Transforms (T, 126) window to specified representation.
    """
    if rep_name == "pos_only":
        return frames_T.astype(np.float32)
    elif rep_name == "pos_vel":
        return compute_position_velocity_features(frames_T)
    elif rep_name == "compact_motion":
        return compute_compact_motion_features(frames_T)
    else:
        raise ValueError(f"Unknown feature representation: {rep_name}")

def build_dataset_arrays(
    sample_list,
    target_len,
    strategy="center_crop",
    rep_name="pos_vel",
    is_training=False
):
    """
    Converts list of original samples into X, y arrays for model consumption.
    If is_training=True: generates derived training windows with augmentation.
    If is_training=False: generates strictly ONE deterministic window per original sample.
    """
    X_list = []
    y_list = []

    for s in sample_list:
        frames_60 = s["frames"]
        label_id = s["label_id"]

        if is_training:
            derived_windows = augment_train_sample_windows(frames_60, target_len, strategy=strategy)
            for w in derived_windows:
                feat = transform_sample_to_representation(w, rep_name)
                X_list.append(feat)
                y_list.append(label_id)
        else:
            # Deterministic SINGLE window for validation/testing
            w = extract_window(frames_60, target_len, strategy=strategy)
            feat = transform_sample_to_representation(w, rep_name)
            X_list.append(feat)
            y_list.append(label_id)

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int64)
    return X, y
