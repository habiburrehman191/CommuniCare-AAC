import os
import json
import numpy as np

from data_pipeline_v2 import (
    load_original_dataset,
    create_loso_splits,
    compute_position_velocity_features,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)

NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]

def analyze_motion_energy_per_class(samples):
    """
    Computes motion statistics across all samples for each class:
    - Mean landmark velocity magnitude (per frame, averaged across hands)
    - Wrist displacement magnitude
    - Hand presence continuity
    """
    class_stats = {cls: {
        "mean_velocities": [],
        "wrist_velocities": [],
        "presence_ratios": []
    } for cls in FROZEN_CLASSES}

    for s in samples:
        cls = s["label"]
        frames = s["frames"]  # (60, 126)
        
        # Position + Velocity
        pv = compute_position_velocity_features(frames)
        vel = pv[:, 126:]  # (60, 126)

        left_vel = vel[:, :63].reshape(60, 21, 3)
        right_vel = vel[:, 63:].reshape(60, 21, 3)

        left_speed = np.sqrt(np.sum(left_vel**2, axis=-1))  # (60, 21)
        right_speed = np.sqrt(np.sum(right_vel**2, axis=-1)) # (60, 21)

        # Non-zero speeds
        all_speeds = np.concatenate([left_speed, right_speed], axis=-1)  # (60, 42)
        mean_speed = np.mean(all_speeds[1:])  # ignore t=0

        # Wrist velocity: landmark 0
        left_wrist_v = left_speed[1:, 0]
        right_wrist_v = right_speed[1:, 0]
        mean_wrist_v = np.mean((left_wrist_v + right_wrist_v) / 2.0)

        # Hand presence
        left_pres = np.any(np.abs(frames[:, :63]) > 1e-5, axis=1)
        right_pres = np.any(np.abs(frames[:, 63:]) > 1e-5, axis=1)
        presence_ratio = np.mean((left_pres | right_pres).astype(np.float32))

        class_stats[cls]["mean_velocities"].append(float(mean_speed))
        class_stats[cls]["wrist_velocities"].append(float(mean_wrist_v))
        class_stats[cls]["presence_ratios"].append(float(presence_ratio))

    summary = {}
    for cls in FROZEN_CLASSES:
        m_vels = np.array(class_stats[cls]["mean_velocities"])
        w_vels = np.array(class_stats[cls]["wrist_velocities"])
        pres = np.array(class_stats[cls]["presence_ratios"])

        summary[cls] = {
            "mean_velocity_avg": float(np.mean(m_vels)),
            "mean_velocity_std": float(np.std(m_vels)),
            "mean_velocity_min": float(np.min(m_vels)),
            "mean_velocity_max": float(np.max(m_vels)),
            "wrist_velocity_avg": float(np.mean(w_vels)),
            "wrist_velocity_min": float(np.min(w_vels)),
            "wrist_velocity_max": float(np.max(w_vels)),
            "presence_ratio_avg": float(np.mean(pres)),
            "presence_ratio_min": float(np.min(pres))
        }

    return summary

def evaluate_motion_gate_effect(samples, motion_threshold):
    """
    Evaluates what happens if we apply a motion gate:
    If mean_speed < motion_threshold -> force to NO_SIGN.
    We check:
    - NO_SIGN rejected/accepted rate
    - Real signs blocked rate per class
    """
    no_sign_samples = [s for s in samples if s["label"] == "NO_SIGN"]
    real_sign_samples = [s for s in samples if s["label"] != "NO_SIGN"]

    no_sign_blocked = 0
    for s in no_sign_samples:
        pv = compute_position_velocity_features(s["frames"])
        vel = pv[:, 126:]
        speeds = np.sqrt(np.sum(vel[1:].reshape(-1, 42, 3)**2, axis=-1))
        if np.mean(speeds) < motion_threshold:
            no_sign_blocked += 1  # Correctly stays NO_SIGN

    per_class_blocked = {cls: 0 for cls in FROZEN_CLASSES if cls != "NO_SIGN"}
    per_class_total = {cls: 0 for cls in FROZEN_CLASSES if cls != "NO_SIGN"}

    for s in real_sign_samples:
        cls = s["label"]
        per_class_total[cls] += 1
        pv = compute_position_velocity_features(s["frames"])
        vel = pv[:, 126:]
        speeds = np.sqrt(np.sum(vel[1:].reshape(-1, 42, 3)**2, axis=-1))
        if np.mean(speeds) < motion_threshold:
            per_class_blocked[cls] += 1  # False rejection due to low motion

    return {
        "motion_threshold": motion_threshold,
        "no_sign_correctly_gated_idle": float(no_sign_blocked / len(no_sign_samples)),
        "real_signs_falsely_blocked_rate": float(sum(per_class_blocked.values()) / len(real_sign_samples)),
        "per_class_falsely_blocked": {cls: float(per_class_blocked[cls] / per_class_total[cls]) for cls in per_class_total}
    }

def main():
    print("==================================================")
    print("PHASE 2I-B: MOTION & IDLE GATE AUDIT")
    print("==================================================")

    samples = load_original_dataset()
    summary = analyze_motion_energy_per_class(samples)

    print(f"\n{'Class':<12} | {'Mean Vel Avg':<14} | {'Mean Vel Min':<14} | {'Mean Vel Max':<14} | {'Wrist Vel Avg':<14}")
    print("-" * 75)
    for cls in FROZEN_CLASSES:
        s = summary[cls]
        print(f"{cls:<12} | {s['mean_velocity_avg']:<14.5f} | {s['mean_velocity_min']:<14.5f} | {s['mean_velocity_max']:<14.5f} | {s['wrist_velocity_avg']:<14.5f}")

    # Evaluate multiple candidate motion gate thresholds
    thresholds = [0.001, 0.002, 0.003, 0.005, 0.008, 0.010, 0.015]
    gate_evals = []
    print("\n--- MOTION GATE IMPACT ANALYSIS ---")
    for th in thresholds:
        res = evaluate_motion_gate_effect(samples, th)
        gate_evals.append(res)
        print(f"Thresh {th:.4f}: NO_SIGN Gated={res['no_sign_correctly_gated_idle']*100:.1f}% | Real Signs Blocked={res['real_signs_falsely_blocked_rate']*100:.1f}%")

    out_file = os.path.join(REPORTS_DIR, "motion_idle_gate_analysis.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            "class_motion_statistics": summary,
            "motion_gate_threshold_evaluations": gate_evals
        }, f, indent=2)
    print(f"\nSaved motion gate analysis to: {out_file}")

if __name__ == "__main__":
    main()
