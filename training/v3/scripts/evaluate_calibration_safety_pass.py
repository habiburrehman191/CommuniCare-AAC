import os
import sys
import json
import time
import random
import numpy as np
from sklearn.model_selection import StratifiedShuffleSplit
import onnxruntime as ort

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from data_loader_phase2k import (
    load_four_real_signers,
    compute_position_velocity_features,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL,
    NO_SIGN_IDX
)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
CANDIDATE_DEPLOY_DIR = os.path.join(WORKSPACE_ROOT, "public", "models", "communicare-aac-sign-v3-candidate")
ONNX_PATH = os.path.join(CANDIDATE_DEPLOY_DIR, "model.onnx")

def simulate_streaming(seq_probs_list, sequences, threshold=0.60, margin=0.00, stability_windows=2, class_thresholds=None):
    fps = 30.0
    target_len = 24
    stride_frames = 3
    window_starts = list(range(0, 60 - target_len + 1, stride_frames))

    ground_truth = []
    surfaced_preds = []
    latencies_sec = []

    for seq_idx, s in enumerate(sequences):
        true_lbl = s["label_id"]
        ground_truth.append(true_lbl)
        seq_probs = seq_probs_list[seq_idx]

        consecutive_accepted = []
        surfaced_label = NO_SIGN_IDX
        surfaced_time = None

        for w_idx, st in enumerate(window_starts):
            prob = seq_probs[w_idx]
            top1_cls = int(np.argmax(prob))
            top1_p = float(prob[top1_cls])
            sorted_p = np.sort(prob)[::-1]
            diff_p = float(sorted_p[0] - sorted_p[1])
            window_end_time = (st + target_len) / fps

            th = threshold
            if class_thresholds and ID_TO_LABEL[top1_cls] in class_thresholds:
                th = class_thresholds[ID_TO_LABEL[top1_cls]]

            if top1_cls != NO_SIGN_IDX and top1_p >= th and diff_p >= margin:
                consecutive_accepted.append(top1_cls)
            else:
                consecutive_accepted.clear()

            if len(consecutive_accepted) >= stability_windows:
                if all(x == consecutive_accepted[-1] for x in consecutive_accepted[-stability_windows:]):
                    surfaced_label = consecutive_accepted[-1]
                    surfaced_time = window_end_time
                    break

        surfaced_preds.append(surfaced_label)
        if surfaced_label != NO_SIGN_IDX and surfaced_time is not None:
            latencies_sec.append(surfaced_time)

    y_true = np.array(ground_truth, dtype=np.int64)
    y_surf = np.array(surfaced_preds, dtype=np.int64)

    surfaced_real_mask = (y_surf != NO_SIGN_IDX)
    if np.sum(surfaced_real_mask) > 0:
        cand_precision = float(np.sum(y_surf[surfaced_real_mask] == y_true[surfaced_real_mask]) / np.sum(surfaced_real_mask))
    else:
        cand_precision = 0.0

    true_real_mask = (y_true != NO_SIGN_IDX)
    cand_recall = float(np.sum((y_surf == y_true) & true_real_mask) / max(np.sum(true_real_mask), 1))

    true_ns_mask = (y_true == NO_SIGN_IDX)
    ns_false_act = float(np.sum(y_surf[true_ns_mask] != NO_SIGN_IDX) / max(np.sum(true_ns_mask), 1))

    real_sign_rejection = float(np.sum((y_surf == NO_SIGN_IDX) & true_real_mask) / max(np.sum(true_real_mask), 1))

    per_class_stream_recall = {}
    for cls_name, cls_id in LABEL_TO_ID.items():
        if cls_name == "NO_SIGN":
            continue
        c_mask = (y_true == cls_id)
        if np.sum(c_mask) > 0:
            per_class_stream_recall[cls_name] = float(np.sum(y_surf[c_mask] == cls_id) / np.sum(c_mask))
        else:
            per_class_stream_recall[cls_name] = 0.0

    weakest_stream = min(per_class_stream_recall.items(), key=lambda x: x[1])

    avg_lat = float(np.mean(latencies_sec)) if latencies_sec else 0.0
    p95_lat = float(np.percentile(latencies_sec, 95)) if latencies_sec else 0.0

    return {
        "candidate_precision": cand_precision,
        "candidate_recall": cand_recall,
        "no_sign_false_activation": ns_false_act,
        "real_sign_rejection": real_sign_rejection,
        "mean_latency_sec": avg_lat,
        "p95_latency_sec": p95_lat,
        "per_class_recall": per_class_stream_recall,
        "weakest_class": weakest_stream[0],
        "weakest_recall": weakest_stream[1],
        "surfaced_count": int(np.sum(surfaced_real_mask)),
        "correct_count": int(np.sum((y_surf == y_true) & true_real_mask))
    }

def main():
    print("=" * 80)
    print("PHASE 2M: CALIBRATION-ONLY SAFETY PASS ON CANDIDATE B ONNX MODEL")
    print(f"Loading ONNX Model: {ONNX_PATH}")
    print("=" * 80)

    # 1. Exact Phase 2L grouped validation split
    all_samples = load_four_real_signers()
    total_samples = len(all_samples)
    strat_keys = [f"{s['signer']}_{s['label_id']}" for s in all_samples]
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
    tr_idx, val_idx = next(sss.split(np.zeros(total_samples), strat_keys))
    val_samples = [all_samples[i] for i in val_idx]
    print(f"Validation Sequences: {len(val_samples)} (15% grouped stratified partition)")

    # 2. Extract sliding windows and run ONNX inference
    target_len = 24
    stride_frames = 3
    window_starts = list(range(0, 60 - target_len + 1, stride_frames))
    num_windows_per_seq = len(window_starts)

    ort_session = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])

    all_windows = []
    for s in val_samples:
        frames_60 = s["frames"]
        for st in window_starts:
            w = frames_60[st:st + target_len]
            feat = compute_position_velocity_features(w)
            all_windows.append(feat)

    all_windows = np.array(all_windows, dtype=np.float32)
    print(f"Computed features for {len(all_windows)} windows across {len(val_samples)} validation sequences.")

    t0 = time.time()
    all_probs = ort_session.run(None, {"input_frames": all_windows})[0]
    print(f"Inference complete in {time.time() - t0:.2f}s.")

    seq_probs_list = []
    for i in range(len(val_samples)):
        start_idx = i * num_windows_per_seq
        seq_probs_list.append(all_probs[start_idx:start_idx + num_windows_per_seq])

    # Baseline (Th=0.60, Mg=0.00, Stab=2)
    base = simulate_streaming(seq_probs_list, val_samples, threshold=0.60, margin=0.00, stability_windows=2)

    # 3. Sweep all combinations
    threshold_range = [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]
    margin_range = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]

    all_results_stab2 = []
    all_results_stab3 = []

    for th in threshold_range:
        for mg in margin_range:
            r2 = simulate_streaming(seq_probs_list, val_samples, threshold=th, margin=mg, stability_windows=2)
            r2["threshold"] = th
            r2["margin"] = mg
            r2["stability"] = 2
            all_results_stab2.append(r2)

            r3 = simulate_streaming(seq_probs_list, val_samples, threshold=th, margin=mg, stability_windows=3)
            r3["threshold"] = th
            r3["margin"] = mg
            r3["stability"] = 3
            all_results_stab3.append(r3)

    # Pick the best configuration for stability=2
    # Selection priority:
    # 1. lower NO_SIGN false activation
    # 2. higher candidate precision
    # 3. lower real-sign rejection
    # 4. higher weakest sign recall
    # 5. higher candidate recall
    # 6. lower latency
    sorted_stab2 = sorted(
        all_results_stab2,
        key=lambda x: (
            x["no_sign_false_activation"],
            -x["candidate_precision"],
            x["real_sign_rejection"],
            -x["weakest_recall"],
            -x["candidate_recall"],
            x["mean_latency_sec"]
        )
    )

    best_stab2 = sorted_stab2[0]

    # Save to public/models/communicare-aac-sign-v3-candidate/calibration.json
    calib_json_path = os.path.join(CANDIDATE_DEPLOY_DIR, "calibration.json")
    with open(calib_json_path, "r", encoding="utf-8") as f:
        calib_data = json.load(f)

    calib_data["calibratedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    calib_data["phase"] = "PHASE_2M_SAFETY_PASS"
    calib_data["globalConfidenceThreshold"] = float(best_stab2["threshold"])
    calib_data["marginThreshold"] = float(best_stab2["margin"])

    class_thresholds = {cls: float(best_stab2["threshold"]) for cls in FROZEN_CLASSES}
    # Keep thankyou with appropriate margin/threshold
    class_thresholds["thankyou"] = float(best_stab2["threshold"])
    calib_data["classSpecificThresholds"] = class_thresholds

    calib_data["temporalStability"] = {
        "requiredConsecutiveWindows": 2,
        "inferenceStrideFrames": 3,
        "inferenceStrideMs": 100,
        "cooldownFrames": 15,
        "cooldownMs": 500
    }
    calib_data["rejectionRules"] = {
        "noSignRule": "If top1 class is NO_SIGN, never surface candidate.",
        "confidenceRule": f"top1 confidence must be >= threshold ({best_stab2['threshold']:.2f})",
        "marginRule": f"top1 - top2 probability difference must be >= {best_stab2['margin']:.2f}",
        "stabilityRule": "Must observe 2 consecutive matching accepted windows before candidate is surfaced."
    }
    calib_data["validationPerformance"] = {
        "streamingPrecision": best_stab2["candidate_precision"],
        "streamingRecall": best_stab2["candidate_recall"],
        "noSignFalseActivation": best_stab2["no_sign_false_activation"],
        "realSignRejection": best_stab2["real_sign_rejection"],
        "meanLatencySec": best_stab2["mean_latency_sec"],
        "p95LatencySec": best_stab2["p95_latency_sec"],
        "weakestClass": best_stab2["weakest_class"],
        "weakestRecall": best_stab2["weakest_recall"]
    }
    calib_data["safetyImprovement"] = {
        "noSignFalseActivationBefore": base["no_sign_false_activation"],
        "noSignFalseActivationAfter": best_stab2["no_sign_false_activation"],
        "deltaFalseActivation": best_stab2["no_sign_false_activation"] - base["no_sign_false_activation"]
    }

    with open(calib_json_path, "w", encoding="utf-8") as f:
        json.dump(calib_data, f, indent=2)

    # Save complete sweep report
    sweep_report_path = os.path.join(WORKSPACE_ROOT, "training", "v3", "reports", "calibration_safety_pass_results.json")
    with open(sweep_report_path, "w", encoding="utf-8") as f:
        json.dump({
            "baseline": base,
            "best_stab2": best_stab2,
            "all_stab2": all_results_stab2,
            "all_stab3": all_results_stab3
        }, f, indent=2)

    print("Phase 2M calibration execution complete.")

if __name__ == "__main__":
    main()
