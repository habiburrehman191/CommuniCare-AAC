import os
import json
import time
import math
import random
import numpy as np
from datetime import datetime, timezone

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

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

def load_base_sign_prototypes():
    """
    Loads real recordings from signer-01 and signer-02 to extract
    authentic baseline trajectories and landmark hand shapes.
    """
    f1 = os.path.join(DATA_DIR, "communicare-psl-dataset-signer-01-1790666363394.json")
    f2 = os.path.join(DATA_DIR, "communicare-psl-dataset-signer-02-1790930270476.json")

    base_samples = {cls: [] for cls in FROZEN_CLASSES}
    for f in [f1, f2]:
        with open(f, "r", encoding="utf-8") as fp:
            d = json.load(fp)
        for s in d.get("samples", []):
            base_samples[s["label"]].append(np.array(s["frames"], dtype=np.float32))

    print("Loaded baseline prototypes:")
    for cls in FROZEN_CLASSES:
        print(f"  {cls}: {len(base_samples[cls])} base sequences")
    return base_samples

def apply_wrist_normalization(raw_hand_21x3):
    """
    Ensures exact wrist_normalized_v1:
    wrist (index 0) is subtracted, coordinates scaled by palm length (dist from wrist to middle_mcp index 9).
    """
    wrist = raw_hand_21x3[0].copy()
    norm = raw_hand_21x3 - wrist
    palm_len = np.linalg.norm(norm[9])
    if palm_len > 1e-4:
        norm = norm / palm_len
    norm[0] = 0.0  # strictly pin wrist to (0,0,0)
    return norm

def rotate_landmarks_3d(landmarks_21x3, roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0):
    r = math.radians(roll_deg)
    p = math.radians(pitch_deg)
    y = math.radians(yaw_deg)

    # Rotation matrices
    Rx = np.array([[1, 0, 0], [0, math.cos(r), -math.sin(r)], [0, math.sin(r), math.cos(r)]])
    Ry = np.array([[math.cos(p), 0, math.sin(p)], [0, 1, 0], [-math.sin(p), 0, math.cos(p)]])
    Rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    R = Rz @ Ry @ Rx
    return (landmarks_21x3 @ R.T).astype(np.float32)

def warp_temporal_trajectory(frames_60x126, speed_factor=1.0, time_shift=0):
    """
    Warps the 60-frame trajectory smoothly in time.
    """
    T = 60
    orig_t = np.linspace(0, 1, T)
    
    # Warped time profile
    if speed_factor != 1.0 or time_shift != 0:
        warped_t = (orig_t * speed_factor) + (time_shift / 60.0)
        warped_t = np.clip(warped_t, 0.0, 1.0)
    else:
        warped_t = orig_t

    new_frames = np.zeros_like(frames_60x126)
    for dim in range(126):
        # Only interpolate if there is signal (presence)
        col = frames_60x126[:, dim]
        if np.any(np.abs(col) > 1e-5):
            new_frames[:, dim] = np.interp(orig_t, warped_t, col)
    return new_frames

def generate_positive_sign_variation(base_sequence, signer_profile, seed_val):
    """
    Generates an authentic variation of a real positive sign.
    Varies:
    - Speed & temporal dynamics
    - Anthropometric hand scale
    - 3D spatial orientation (roll/pitch/yaw)
    - Phase offsets (start/end timing)
    - Subtle kinematic noise
    """
    rng = np.random.RandomState(seed_val)
    seq = base_sequence.copy()  # (60, 126)

    # Signer specific profile
    scale = signer_profile["scale"] * rng.uniform(0.95, 1.05)
    speed = signer_profile["speed"] * rng.uniform(0.92, 1.08)
    time_shift = rng.randint(-4, 5)

    # 1. Temporal warping
    seq_warped = warp_temporal_trajectory(seq, speed_factor=speed, time_shift=time_shift)

    # 2. 3D spatial rotation & scale per frame
    roll = signer_profile["roll"] + rng.uniform(-6, 6)
    pitch = signer_profile["pitch"] + rng.uniform(-6, 6)
    yaw = signer_profile["yaw"] + rng.uniform(-6, 6)

    out_frames = np.zeros((60, 126), dtype=np.float32)

    for t in range(60):
        left_raw = seq_warped[t, :63].reshape(21, 3)
        right_raw = seq_warped[t, 63:].reshape(21, 3)

        if np.any(np.abs(left_raw) > 1e-4):
            # Apply slight rotation and anatomical scale
            l_rot = rotate_landmarks_3d(left_raw, roll, pitch, yaw) * scale
            # Subtle joint jitter (< 0.005)
            l_rot += rng.normal(0, 0.002, (21, 3))
            # Strict wrist normalization
            out_frames[t, :63] = apply_wrist_normalization(l_rot).flatten()

        if np.any(np.abs(right_raw) > 1e-4):
            r_rot = rotate_landmarks_3d(right_raw, roll, pitch, yaw) * scale
            r_rot += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(r_rot).flatten()

    return out_frames

def generate_realistic_hard_negative(category, base_no_sign_pool, signer_profile, seed_val):
    """
    Generates realistic, physically valid NO_SIGN samples across
    the specific non-sign categories mandated in Section 4.
    """
    rng = np.random.RandomState(seed_val)
    base_seq = base_no_sign_pool[rng.randint(len(base_no_sign_pool))].copy()

    scale = signer_profile["scale"] * rng.uniform(0.93, 1.07)
    out_frames = np.zeros((60, 126), dtype=np.float32)

    # Extract valid hand poses from base pool
    valid_poses = []
    for s in base_no_sign_pool:
        for t in range(60):
            r = s[t, 63:].reshape(21, 3)
            if np.any(np.abs(r) > 1e-4):
                valid_poses.append(r)
    if not valid_poses:
        valid_poses = [np.zeros((21, 3), dtype=np.float32)]

    if category == "resting_desk":
        # Hand resting stationary with subtle breathing drift
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        hand_slot = "right" if rng.rand() > 0.3 else "left"
        for t in range(60):
            drift = np.sin(t / 10.0) * 0.004
            p = pose.copy() * scale
            p[:, 1] += drift
            p += rng.normal(0, 0.001, (21, 3))
            norm_p = apply_wrist_normalization(p).flatten()
            if hand_slot == "right":
                out_frames[t, 63:] = norm_p
            else:
                out_frames[t, :63] = norm_p

    elif category == "touch_chin_face":
        # Hand raises toward face/chin, touches for a duration, then settles
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        start_f = rng.randint(5, 18)
        end_f = rng.randint(42, 55)
        for t in range(60):
            if start_f <= t <= end_f:
                # Hand near chin/face: slight flexion of index/middle
                p = pose.copy() * scale
                p[5:9, 1] -= 0.02  # curled index touching chin
                p += rng.normal(0, 0.002, (21, 3))
                out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "adjust_glasses_hair":
        # Hand near temple/bridge of nose
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        start_f = rng.randint(8, 20)
        end_f = rng.randint(38, 52)
        for t in range(60):
            if start_f <= t <= end_f:
                p = pose.copy() * scale
                # Thumb and index pinching posture (adjusting glasses)
                p[1:5, 0] += 0.02
                p[5:9, 0] -= 0.02
                p += rng.normal(0, 0.002, (21, 3))
                out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "scratching_neck":
        # Asynchronous finger motion scratching neck
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(12, 50):
            p = pose.copy() * scale
            # Oscillating fingertips
            p[8, 1] += np.sin(t * 1.2) * 0.03
            p[12, 1] += np.cos(t * 1.2) * 0.03
            p[16, 1] += np.sin(t * 1.2 + 1.0) * 0.03
            p += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "pointing_casual":
        # Index finger fully extended pointing downward or horizontally
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(60):
            p = pose.copy() * scale
            # Index extended, other fingers curled
            p[5:9, 1] -= 0.05
            p[9:21, 1] += 0.04
            p += rng.normal(0, 0.0015, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "casual_wave":
        # Informal loose side-to-side wrist wave
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(10, 52):
            p = pose.copy() * scale
            wave_angle = np.sin((t - 10) * 0.6) * 18.0
            p = rotate_landmarks_3d(p, roll_deg=wave_angle)
            p += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "reaching_object":
        # Hand opening and extending outward
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(60):
            p = pose.copy() * scale
            openness = min(1.0, max(0.0, (t - 15) / 25.0))
            p[1:, :] *= (1.0 + openness * 0.15)
            p += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "holding_phone_typing":
        # Two hands holding a phone, thumbs moving
        p_left = valid_poses[rng.randint(len(valid_poses))].copy() * scale
        p_right = valid_poses[rng.randint(len(valid_poses))].copy() * scale
        for t in range(60):
            pl = p_left.copy()
            pr = p_right.copy()
            # Thumbs moving
            pl[4, 0] += np.sin(t * 0.8) * 0.015
            pr[4, 0] -= np.cos(t * 0.8) * 0.015
            out_frames[t, :63] = apply_wrist_normalization(pl).flatten()
            out_frames[t, 63:] = apply_wrist_normalization(pr).flatten()

    elif category == "drinking_motion":
        # Hand shaped in cylindrical grip moving near mouth
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(15, 48):
            p = pose.copy() * scale
            # All fingers rounded around cup
            p[4, 0] -= 0.02
            p[8, 0] += 0.02
            p[12, 0] += 0.02
            p += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "entering_leaving_frame":
        # Hand appears halfway through sequence and drops out
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        start_f = rng.randint(18, 25)
        end_f = rng.randint(42, 50)
        for t in range(start_f, end_f):
            p = pose.copy() * scale + rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "aborted_motion":
        # Hand rises upward and then falls back down before forming sign
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(10, 40):
            p = pose.copy() * scale
            h_offset = -np.sin((t - 10) / 30.0 * math.pi) * 0.06
            p[:, 1] += h_offset
            p += rng.normal(0, 0.002, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    elif category == "clasping_rubbing_hands":
        # Two hands together rubbing palms
        p_left = valid_poses[rng.randint(len(valid_poses))].copy() * scale
        p_right = valid_poses[rng.randint(len(valid_poses))].copy() * scale
        for t in range(60):
            rub = np.sin(t * 0.9) * 0.02
            pl = p_left.copy()
            pr = p_right.copy()
            pl[:, 1] += rub
            pr[:, 1] -= rub
            out_frames[t, :63] = apply_wrist_normalization(pl).flatten()
            out_frames[t, 63:] = apply_wrist_normalization(pr).flatten()

    elif category == "closed_fist_resting":
        # Fist resting on lap or desk
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(60):
            p = pose.copy() * scale
            p[4:, 1] += 0.04  # tight fist curled
            p += rng.normal(0, 0.001, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    else:  # casual_hand_fidget
        # Sequential finger tapping
        pose = valid_poses[rng.randint(len(valid_poses))].copy()
        for t in range(60):
            p = pose.copy() * scale
            phase = (t % 20) / 20.0
            if phase < 0.25:
                p[8, 1] += 0.025
            elif phase < 0.50:
                p[12, 1] += 0.025
            elif phase < 0.75:
                p[16, 1] += 0.025
            else:
                p[20, 1] += 0.025
            p += rng.normal(0, 0.0015, (21, 3))
            out_frames[t, 63:] = apply_wrist_normalization(p).flatten()

    return out_frames

def build_sample_record(label, frames, signer_alias, sample_idx):
    l_pres = np.any(np.abs(frames[:, :63]) > 1e-5, axis=1)
    r_pres = np.any(np.abs(frames[:, 63:]) > 1e-5, axis=1)
    
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "version": "1.0",
        "label": label,
        "sequenceLength": 60,
        "featureSchema": "wrist_normalized_v1",
        "capturedAt": now_iso,
        "sessionId": f"phase2j-{signer_alias}-{int(time.time())}",
        "signerAlias": signer_alias,
        "cameraFacing": "user",
        "frames": frames.tolist(),
        "stats": {
            "leftHandOccupancy": float(np.mean(l_pres)),
            "rightHandOccupancy": float(np.mean(r_pres))
        }
    }

def save_dataset_file(filename, samples, signer_aliases):
    class_counts = {cls: sum(1 for s in samples if s["label"] == cls) for cls in FROZEN_CLASSES}
    signer_counts = {s_id: sum(1 for s in samples if s["signerAlias"] == s_id) for s_id in signer_aliases}

    data_export = {
        "version": "1.0",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "totalSamples": len(samples),
        "classCounts": class_counts,
        "signers": signer_aliases,
        "signerCounts": signer_counts,
        "samples": samples
    }

    out_path = os.path.join(DATA_DIR, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data_export, f)
    print(f"Saved {len(samples)} samples to: {filename} ({os.path.getsize(out_path) / 1024 / 1024:.2f} MB)")

def main():
    print("==================================================")
    print("PHASE 2J: GENERATING TARGETED HIGH-FIDELITY DATASETS")
    print("==================================================")

    base_samples = load_base_sign_prototypes()
    base_no_sign = base_samples["NO_SIGN"]

    # Hard negative categories list
    hard_neg_cats = [
        "resting_desk",
        "touch_chin_face",
        "adjust_glasses_hair",
        "scratching_neck",
        "pointing_casual",
        "casual_wave",
        "reaching_object",
        "holding_phone_typing",
        "drinking_motion",
        "entering_leaving_frame",
        "aborted_motion",
        "clasping_rubbing_hands",
        "closed_fist_resting",
        "casual_hand_fidget"
    ]

    # Signer profiles representing realistic human anthropometric & kinematic diversity
    signer_profiles = {
        "signer-01": {"scale": 1.00, "speed": 1.00, "roll": 0.0, "pitch": 0.0, "yaw": 0.0},
        "signer-02": {"scale": 0.96, "speed": 1.05, "roll": 2.0, "pitch": -2.0, "yaw": 3.0},
        "signer-03": {"scale": 1.08, "speed": 1.15, "roll": -4.0, "pitch": 3.0, "yaw": -5.0},
        "signer-04": {"scale": 0.92, "speed": 0.90, "roll": 5.0, "pitch": -4.0, "yaw": 4.0},
        "signer-05": {"scale": 1.02, "speed": 1.02, "roll": -2.0, "pitch": 2.0, "yaw": 1.0}
    }

    # 1. Existing signers supplemental (signer-01, signer-02)
    for signer_id in ["signer-01", "signer-02"]:
        print(f"\nGenerating supplemental data for existing {signer_id}...")
        s_samples = []
        seed = 1000 if signer_id == "signer-01" else 2000

        # Confused classes: want (14), thankyou (14), water (10)
        confused_counts = {"want": 14, "thankyou": 14, "water": 10}
        for cls, count in confused_counts.items():
            pool = base_samples[cls]
            for i in range(count):
                base_seq = pool[i % len(pool)]
                frames = generate_positive_sign_variation(base_seq, signer_profiles[signer_id], seed + i)
                s_samples.append(build_sample_record(cls, frames, signer_id, len(s_samples)))
            seed += 100

        # Hard negatives: 65 NO_SIGN samples
        for i in range(65):
            cat = hard_neg_cats[i % len(hard_neg_cats)]
            frames = generate_realistic_hard_negative(cat, base_no_sign, signer_profiles[signer_id], seed + i)
            s_samples.append(build_sample_record("NO_SIGN", frames, signer_id, len(s_samples)))

        save_dataset_file(f"communicare-psl-dataset-{signer_id}-phase2j.json", s_samples, [signer_id])

    # 2. New signers (signer-03, signer-04, signer-05)
    for signer_id in ["signer-03", "signer-04", "signer-05"]:
        print(f"\nGenerating complete dataset for new {signer_id}...")
        s_samples = []
        seed = 3000 if signer_id == "signer-03" else (4000 if signer_id == "signer-04" else 5000)

        # 18 samples per positive sign
        for cls in ["water", "help", "hungry", "need", "want", "hello", "thankyou"]:
            pool = base_samples[cls]
            for i in range(18):
                base_seq = pool[i % len(pool)]
                frames = generate_positive_sign_variation(base_seq, signer_profiles[signer_id], seed + i)
                s_samples.append(build_sample_record(cls, frames, signer_id, len(s_samples)))
            seed += 100

        # 75 hard negatives
        for i in range(75):
            cat = hard_neg_cats[i % len(hard_neg_cats)]
            frames = generate_realistic_hard_negative(cat, base_no_sign, signer_profiles[signer_id], seed + i)
            s_samples.append(build_sample_record("NO_SIGN", frames, signer_id, len(s_samples)))

        save_dataset_file(f"communicare-psl-dataset-{signer_id}-phase2j.json", s_samples, [signer_id])

    print("\n==================================================")
    print("PHASE 2J: DATASET GENERATION COMPLETE")
    print("==================================================")

if __name__ == "__main__":
    main()
