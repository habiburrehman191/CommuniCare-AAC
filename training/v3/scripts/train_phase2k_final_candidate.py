import os
import sys
import json
import time
import random
import argparse
import numpy as np
from collections import Counter
import functools
print = functools.partial(print, flush=True)

SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

from tensorflow.keras import callbacks
import tf2onnx
import onnx
import onnxruntime as ort
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from data_loader_phase2k import (
    load_four_real_signers,
    build_fold_arrays,
    compute_position_velocity_features,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL,
    NO_SIGN_IDX
)
from models_phase2k import build_candidate_model, get_candidate_specs

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
PUBLIC_MODELS_DIR = os.path.join(WORKSPACE_ROOT, "public", "models")
CANDIDATE_DEPLOY_DIR = os.path.join(PUBLIC_MODELS_DIR, "communicare-aac-sign-v3-candidate")
REPORTS_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "reports")
OUTPUTS_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "outputs")

os.makedirs(CANDIDATE_DEPLOY_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

def evaluate_predictions(y_true, y_pred, y_prob=None):
    acc = float(accuracy_score(y_true, y_pred))
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(y_true, y_pred, average='macro', zero_division=0)
    p_weighted, r_weighted, f1_weighted, _ = precision_recall_fscore_support(y_true, y_pred, average='weighted', zero_division=0)
    per_class_p, per_class_r, per_class_f1, per_class_supp = precision_recall_fscore_support(y_true, y_pred, average=None, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(FROZEN_CLASSES))))

    true_no_sign = np.where(y_true == NO_SIGN_IDX)[0]
    false_sign_activations = int(np.sum(y_pred[true_no_sign] != NO_SIGN_IDX))
    false_sign_activation_rate = float(false_sign_activations / max(len(true_no_sign), 1))

    true_sign = np.where(y_true != NO_SIGN_IDX)[0]
    real_sign_rejected = int(np.sum(y_pred[true_sign] == NO_SIGN_IDX))
    real_sign_rejection_rate = float(real_sign_rejected / max(len(true_sign), 1))

    per_class = {}
    for idx, cls in enumerate(FROZEN_CLASSES):
        per_class[cls] = {
            "precision": float(per_class_p[idx]),
            "recall": float(per_class_r[idx]),
            "f1": float(per_class_f1[idx]),
            "support": int(per_class_supp[idx])
        }

    cm_copy = cm.copy()
    np.fill_diagonal(cm_copy, 0)
    max_idx = np.unravel_index(np.argmax(cm_copy, axis=None), cm_copy.shape)
    most_confused_pair = {
        "true": FROZEN_CLASSES[max_idx[0]],
        "pred": FROZEN_CLASSES[max_idx[1]],
        "count": int(cm_copy[max_idx])
    }

    real_sign_recalls = [(cls, per_class[cls]["recall"]) for cls in FROZEN_CLASSES if cls != "NO_SIGN"]
    weakest_sign = min(real_sign_recalls, key=lambda x: x[1])
    strongest_sign = max(real_sign_recalls, key=lambda x: x[1])

    return {
        "accuracy": acc,
        "macro_f1": float(f1_macro),
        "macro_precision": float(p_macro),
        "macro_recall": float(r_macro),
        "weighted_f1": float(f1_weighted),
        "no_sign_recall": float(per_class_r[NO_SIGN_IDX]),
        "no_sign_false_activation_rate": false_sign_activation_rate,
        "real_sign_rejection_rate": real_sign_rejection_rate,
        "weakest_sign": {"label": weakest_sign[0], "recall": float(weakest_sign[1])},
        "strongest_sign": {"label": strongest_sign[0], "recall": float(strongest_sign[1])},
        "most_confused_pair": most_confused_pair,
        "per_class": per_class,
        "confusion_matrix": cm.tolist()
    }

def simulate_streaming_on_sequences(model, sequences, target_len=24, threshold=0.50, margin=0.10, class_thresholds=None, stride_frames=3):
    fps = 30.0
    window_starts = list(range(0, 60 - target_len + 1, stride_frames))
    num_windows_per_seq = len(window_starts)

    all_features = []
    for s in sequences:
        frames_60 = s["frames"]
        for st in window_starts:
            w = frames_60[st:st + target_len]
            feat = compute_position_velocity_features(w)
            all_features.append(feat)

    all_features = np.array(all_features, dtype=np.float32)
    all_probs = model.predict(all_features, batch_size=256, verbose=0)

    ground_truth = []
    surfaced_preds = []
    latencies_sec = []

    for seq_idx, s in enumerate(sequences):
        true_lbl = s["label_id"]
        ground_truth.append(true_lbl)

        start_prob_idx = seq_idx * num_windows_per_seq
        seq_probs = all_probs[start_prob_idx:start_prob_idx + num_windows_per_seq]

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

            if len(consecutive_accepted) >= 2:
                if consecutive_accepted[-1] == consecutive_accepted[-2]:
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

def train_and_export_final(candidate_key="B"):
    specs = get_candidate_specs(candidate_key)
    target_len = specs["window"]

    print("================================================================================")
    print(f"PHASE 2L: FINAL ALL-FOUR-SIGNER MODEL TRAINING — CANDIDATE {candidate_key}")
    print(f"Architecture: {specs['name']}")
    print(f"Frames: {target_len} | Features: 252 (pos + vel) | Target Params: ~60,568")
    print("================================================================================")
    print(f"Deployment Directory: {CANDIDATE_DEPLOY_DIR}")

    # 1. Load genuine samples
    all_samples = load_four_real_signers()
    total_samples = len(all_samples)
    assert total_samples == 808, f"Expected 808 genuine samples, got {total_samples}"

    # 2. Grouped sequence-level train / validation split
    # 85% train, 15% validation stratified by (signer, label)
    strat_keys = [f"{s['signer']}_{s['label_id']}" for s in all_samples]
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
    tr_idx, val_idx = next(sss.split(np.zeros(total_samples), strat_keys))

    train_samples = [all_samples[i] for i in tr_idx]
    val_samples = [all_samples[i] for i in val_idx]

    print(f"\nSequence Partition: {len(train_samples)} training sequences, {len(val_samples)} validation sequences.")
    print("CRITICAL NOTE: Mixed-signer validation is used ONLY for optimization/early stopping and threshold calibration.")
    print("The authoritative unseen-signer generalization evidence remains the 4-fold LOSO evaluation.")

    # 3. Build arrays
    rng = np.random.RandomState(SEED)
    X_tr, y_tr = build_fold_arrays(train_samples, target_len=target_len, is_training=True, rng=rng, augment=True)
    X_va, y_va = build_fold_arrays(val_samples, target_len=target_len, is_training=False, augment=False)

    print(f"Derived Windows: X_tr={X_tr.shape} (augmented), X_va={X_va.shape} (deterministic genuine)")

    # 4. Class weighting
    classes, counts = np.unique(y_tr, return_counts=True)
    total_tr = len(y_tr)
    class_weights = {int(c): float(total_tr / (len(classes) * cnt)) for c, cnt in zip(classes, counts)}
    class_weights[LABEL_TO_ID["want"]] *= 1.15
    class_weights[LABEL_TO_ID["thankyou"]] *= 1.15
    class_weights[NO_SIGN_IDX] *= 1.10

    # 5. Build model
    model = build_candidate_model(candidate_key)
    param_count = model.count_params()
    print(f"Model built: {model.name} with {param_count:,} parameters.")

    # 6. Stage 1: Main Training
    print("\n--- STAGE 1: Main Training ---")
    cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True, verbose=1)
    cb_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, min_lr=1e-5, verbose=1)

    t0_train = time.time()
    history = model.fit(
        X_tr, y_tr,
        validation_data=(X_va, y_va),
        epochs=35,
        batch_size=64,
        class_weight=class_weights,
        callbacks=[cb_early, cb_lr],
        verbose=1
    )
    t_train = time.time() - t0_train
    best_epoch = int(np.argmin(history.history["val_loss"]) + 1)
    best_val_loss = float(min(history.history["val_loss"]))
    best_tr_loss = float(history.history["loss"][best_epoch - 1])
    print(f"Stage 1 completed in {t_train:.1f}s. Best epoch: {best_epoch} (val_loss={best_val_loss:.4f}, tr_loss={best_tr_loss:.4f})")

    # Pre-mining validation evaluation
    val_probs_pre = model.predict(X_va, verbose=0)
    val_preds_pre = np.argmax(val_probs_pre, axis=1)
    pre_metrics = evaluate_predictions(y_va, val_preds_pre, val_probs_pre)
    print(f"Pre-Mining Validation: Acc={pre_metrics['accuracy']*100:.2f}%, Macro F1={pre_metrics['macro_f1']:.4f}, NO_SIGN False Act={pre_metrics['no_sign_false_activation_rate']*100:.2f}%, Real Rejection={pre_metrics['real_sign_rejection_rate']*100:.2f}%")

    # 7. Stage 2: Hard Negative Mining & Controlled Fine-Tuning
    print("\n--- STAGE 2: Hard Negative Mining on Training Data ---")
    train_preds = np.argmax(model.predict(X_tr, verbose=0), axis=1)
    hard_neg_mask = (y_tr == NO_SIGN_IDX) & (train_preds != NO_SIGN_IDX)
    hard_neg_count = int(np.sum(hard_neg_mask))
    print(f"Hard negative NO_SIGN windows in training set: {hard_neg_count}")

    if hard_neg_count > 0:
        hard_neg_classes = Counter([ID_TO_LABEL[p] for p in train_preds[hard_neg_mask]])
        print(f"False-sign distribution: {dict(hard_neg_classes)}")

        X_hard = X_tr[hard_neg_mask]
        y_hard = y_tr[hard_neg_mask]
        X_tr_mined = np.concatenate([X_tr, X_hard, X_hard], axis=0)
        y_tr_mined = np.concatenate([y_tr, y_hard, y_hard], axis=0)

        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=2e-4),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"]
        )
        cb_ft = callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True, verbose=1)
        model.fit(
            X_tr_mined, y_tr_mined,
            validation_data=(X_va, y_va),
            epochs=10,
            batch_size=64,
            callbacks=[cb_ft],
            verbose=1
        )

    # Post-mining validation evaluation
    val_probs_post = model.predict(X_va, verbose=0)
    val_preds_post = np.argmax(val_probs_post, axis=1)
    post_metrics = evaluate_predictions(y_va, val_preds_post, val_probs_post)
    print(f"Post-Mining Validation: Acc={post_metrics['accuracy']*100:.2f}%, Macro F1={post_metrics['macro_f1']:.4f}, NO_SIGN False Act={post_metrics['no_sign_false_activation_rate']*100:.2f}%, Real Rejection={post_metrics['real_sign_rejection_rate']*100:.2f}%")
    print(f"Delta False Activation: {(post_metrics['no_sign_false_activation_rate'] - pre_metrics['no_sign_false_activation_rate'])*100:+.2f}%")
    print(f"Delta Real Rejection: {(post_metrics['real_sign_rejection_rate'] - pre_metrics['real_sign_rejection_rate'])*100:+.2f}%")

    # 8. Stage 3: Validation-Only Calibration Search
    print("\n--- STAGE 3: Comprehensive Calibration Search (Validation Data Only) ---")
    threshold_range = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]
    margin_range = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25]

    max_p = np.max(val_probs_post, axis=1)
    sorted_p = np.sort(val_probs_post, axis=1)[:, ::-1]
    top_diff = sorted_p[:, 0] - sorted_p[:, 1]
    raw_preds = np.argmax(val_probs_post, axis=1)

    grid_results = []
    for th in threshold_range:
        for mg in margin_range:
            gated = np.where((max_p >= th) & (top_diff >= mg), raw_preds, NO_SIGN_IDX)
            m = evaluate_predictions(y_va, gated, val_probs_post)

            score = (
                - 2.5 * m["no_sign_false_activation_rate"]
                - 1.0 * m["real_sign_rejection_rate"]
                + 1.5 * m["macro_f1"]
                + 0.5 * m["weakest_sign"]["recall"]
            )
            grid_results.append({
                "threshold": th,
                "margin": mg,
                "score": score,
                "accuracy": m["accuracy"],
                "macro_f1": m["macro_f1"],
                "no_sign_false_act": m["no_sign_false_activation_rate"],
                "real_sign_rejection": m["real_sign_rejection_rate"],
                "weakest_sign": m["weakest_sign"]["label"],
                "weakest_recall": m["weakest_sign"]["recall"]
            })

    grid_results.sort(key=lambda x: x["score"], reverse=True)
    best_calib = grid_results[0]
    calib_th = best_calib["threshold"]
    calib_margin = best_calib["margin"]

    print(f"Top Calibrated Operating Points (Validation Gated Accuracy):")
    for r in grid_results[:5]:
        print(f"  Th={r['threshold']:.2f}, Mg={r['margin']:.2f} -> Score={r['score']:.4f} | FalseAct={r['no_sign_false_act']*100:.2f}% | Rejection={r['real_sign_rejection']*100:.2f}% | Macro F1={r['macro_f1']:.4f} | Weakest={r['weakest_sign']} ({r['weakest_recall']*100:.1f}%)")

    # Evaluate streaming simulation on validation sequences
    print("\n--- Sliding Window Streaming Validation Simulation ---")
    val_stream_metrics = simulate_streaming_on_sequences(
        model, val_samples, target_len=target_len,
        threshold=calib_th, margin=calib_margin, stride_frames=3
    )

    print(f"Selected Validation Calibration: Confidence Threshold >= {calib_th:.2f}, Margin >= {calib_margin:.2f}")
    print(f"Validation Streaming Precision: {val_stream_metrics['candidate_precision']*100:.2f}%")
    print(f"Validation Streaming Recall: {val_stream_metrics['candidate_recall']*100:.2f}%")
    print(f"Validation Streaming NO_SIGN False Activation: {val_stream_metrics['no_sign_false_activation']*100:.2f}%")
    print(f"Validation Streaming Real-Sign Rejection: {val_stream_metrics['real_sign_rejection']*100:.2f}%")
    print(f"Validation Streaming Weakest Sign: {val_stream_metrics['weakest_class']} ({val_stream_metrics['weakest_recall']*100:.2f}%)")
    print(f"Validation Streaming Mean Latency: {val_stream_metrics['mean_latency_sec']:.2f}s (P95: {val_stream_metrics['p95_latency_sec']:.2f}s)")

    class_thresholds = {cls: float(calib_th) for cls in FROZEN_CLASSES}
    class_thresholds["thankyou"] = max(0.45, float(calib_th - 0.05))

    # 9. Stage 4: ONNX Export
    print("\n--- STAGE 4: Export to ONNX (Opset 17) ---")
    onnx_path = os.path.join(CANDIDATE_DEPLOY_DIR, "model.onnx")
    spec = (tf.TensorSpec((None, target_len, 252), tf.float32, name="input_frames"),)
    onnx_model, _ = tf2onnx.convert.from_keras(model, input_signature=spec, opset=17)
    onnx.save_model(onnx_model, onnx_path)
    file_size_bytes = os.path.getsize(onnx_path)
    file_size_kb = file_size_bytes / 1024.0
    print(f"Exported model.onnx: {file_size_bytes:,} bytes ({file_size_kb:.2f} KB) to {onnx_path}")

    # 10. Stage 5: Mandatory ONNX Parity Verification
    print("\n--- STAGE 5: Mandatory ONNX Parity Verification on all 808 Genuine Sequences ---")
    t0_load = time.time()
    ort_session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    ort_load_time_ms = (time.time() - t0_load) * 1000.0

    X_all, y_all = build_fold_arrays(all_samples, target_len=target_len, is_training=False, augment=False)
    native_preds = model.predict(X_all, batch_size=64, verbose=0)
    ort_inputs = {"input_frames": X_all}
    ort_outputs = ort_session.run(None, ort_inputs)[0]

    native_top1 = np.argmax(native_preds, axis=1)
    ort_top1 = np.argmax(ort_outputs, axis=1)

    top1_agreement = float(np.mean(native_top1 == ort_top1))
    max_prob_diff = float(np.max(np.abs(native_preds - ort_outputs)))
    mean_prob_diff = float(np.mean(np.abs(native_preds - ort_outputs)))

    print(f"Evaluated Samples: {len(all_samples)}")
    print(f"Top-1 Agreement: {top1_agreement*100:.4f}% ({np.sum(native_top1 == ort_top1)}/{len(all_samples)})")
    print(f"Max Probability Difference: {max_prob_diff:.8e}")
    print(f"Mean Probability Difference: {mean_prob_diff:.8e}")

    parity_passed = (top1_agreement == 1.0) and (max_prob_diff < 1e-4)
    if not parity_passed:
        raise RuntimeError("FATAL: ONNX parity check FAILED! Parity target not met.")
    print("ONNX PARITY STATUS: PASSED (Exact numerical match within float32 tolerance)")

    # 11. Stage 6: Browser Speed & Latency Benchmark
    print("\n--- STAGE 6: ONNX Inference Latency Benchmark ---")
    single_input = np.random.randn(1, target_len, 252).astype(np.float32)
    for _ in range(100):
        _ = ort_session.run(None, {"input_frames": single_input})

    timed_latencies_ms = []
    for _ in range(500):
        t_start = time.perf_counter()
        _ = ort_session.run(None, {"input_frames": single_input})
        t_end = time.perf_counter()
        timed_latencies_ms.append((t_end - t_start) * 1000.0)

    mean_inf_ms = float(np.mean(timed_latencies_ms))
    p95_inf_ms = float(np.percentile(timed_latencies_ms, 95))
    history_dur_sec = target_len / 30.0
    inference_stride_sec = 3.0 / 30.0
    stab_delay_sec = 1.0 * inference_stride_sec
    est_first_cand_sec = history_dur_sec + stab_delay_sec + (mean_inf_ms / 1000.0)

    print(f"ONNX Model File Size: {file_size_kb:.2f} KB")
    print(f"ONNX Session Load Time: {ort_load_time_ms:.2f} ms")
    print(f"Mean Single-Window Inference Latency: {mean_inf_ms:.2f} ms")
    print(f"P95 Single-Window Inference Latency: {p95_inf_ms:.2f} ms")
    print(f"24-Frame Live History Duration: {history_dur_sec:.2f}s ({history_dur_sec*1000:.0f} ms)")
    print(f"Inference Stride: 3 frames ({inference_stride_sec*1000:.0f} ms)")
    print(f"2-Window Stabilization Delay: {stab_delay_sec*1000:.0f} ms")
    print(f"Estimated First Stable Candidate Latency: {est_first_cand_sec:.2f}s (~{est_first_cand_sec*1000:.0f} ms)")

    # 12. Stage 7: Write Production Artifacts
    print("\n--- STAGE 7: Writing Production & Calibration Artifacts ---")

    # labels.json
    with open(os.path.join(CANDIDATE_DEPLOY_DIR, "labels.json"), "w", encoding="utf-8") as f:
        json.dump(FROZEN_CLASSES, f, indent=2)

    # feature-schema.json
    schema_data = {
        "version": "wrist_normalized_posvel_v3",
        "description": "CommuniCare AAC 24-frame Position + Velocity Feature Representation",
        "sequenceLength": target_len,
        "featuresPerFrame": 252,
        "positionFeatures": 126,
        "velocityFeatures": 126,
        "handSlots": {
            "left": {
                "positionIndexRange": [0, 62],
                "velocityIndexRange": [126, 188],
                "landmarkCount": 21,
                "coordsPerLandmark": 3
            },
            "right": {
                "positionIndexRange": [63, 125],
                "velocityIndexRange": [189, 251],
                "landmarkCount": 21,
                "coordsPerLandmark": 3
            }
        },
        "velocitySemantics": "v[t] = pos[t] - pos[t-1]. v[0] = zeros(126). If a hand slot is absent in frame t OR frame t-1, velocity for that entire hand slot is strictly zero.",
        "normalizationVersion": "wrist_normalized_v1 for position coordinates (wrist at origin, hand scale normalized)"
    }
    with open(os.path.join(CANDIDATE_DEPLOY_DIR, "feature-schema.json"), "w", encoding="utf-8") as f:
        json.dump(schema_data, f, indent=2)

    # calibration.json
    calibration_data = {
        "candidate": candidate_key,
        "modelName": specs["name"],
        "calibratedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "globalConfidenceThreshold": float(calib_th),
        "marginThreshold": float(calib_margin),
        "classSpecificThresholds": class_thresholds,
        "temporalStability": {
            "requiredConsecutiveWindows": 2,
            "inferenceStrideFrames": 3,
            "inferenceStrideMs": 100,
            "cooldownFrames": 15,
            "cooldownMs": 500
        },
        "rejectionRules": {
            "noSignRule": "If top1 class is NO_SIGN, never surface candidate.",
            "confidenceRule": f"top1 confidence must be >= threshold ({calib_th:.2f})",
            "marginRule": f"top1 - top2 probability difference must be >= {calib_margin:.2f}",
            "stabilityRule": "Must observe 2 consecutive matching accepted windows before candidate is surfaced."
        },
        "validationPerformance": {
            "streamingPrecision": val_stream_metrics["candidate_precision"],
            "streamingRecall": val_stream_metrics["candidate_recall"],
            "noSignFalseActivation": val_stream_metrics["no_sign_false_activation"],
            "realSignRejection": val_stream_metrics["real_sign_rejection"],
            "meanLatencySec": val_stream_metrics["mean_latency_sec"]
        },
        "tuningSplit": "Grouped sequence-level validation (122 sequences, 15%) on genuine signers (signer-01..signer-04)",
        "rationale": "Conservative calibration prioritizing reduction of NO_SIGN false activation below LOSO baseline while preserving weakest sign (thankyou) and streaming responsiveness."
    }
    with open(os.path.join(CANDIDATE_DEPLOY_DIR, "calibration.json"), "w", encoding="utf-8") as f:
        json.dump(calibration_data, f, indent=2)

    # model-metadata.json
    metadata = {
        "modelName": "communicare-aac-sign-v3-candidate",
        "phase": "PHASE_2L_FINAL",
        "candidateKey": candidate_key,
        "architecture": specs["name"],
        "parameterCount": param_count,
        "inputShape": [1, target_len, 252],
        "outputShape": [1, 8],
        "opset": 17,
        "fileSizeBytes": file_size_bytes,
        "fileSizeKb": round(file_size_kb, 2),
        "dataset": {
            "authenticSigners": ["signer-01", "signer-02", "signer-03", "signer-04"],
            "totalUniqueSamples": total_samples,
            "trainSequences": len(train_samples),
            "valSequences": len(val_samples),
            "syntheticSignersUsed": False,
            "syntheticQuarantineUsed": False
        },
        "training": {
            "bestEpoch": best_epoch,
            "trainingDurationSec": round(t_train, 1),
            "trainLoss": round(best_tr_loss, 4),
            "valLoss": round(best_val_loss, 4),
            "hardNegativeMining": {
                "minedWindows": hard_neg_count,
                "preFalseAct": pre_metrics["no_sign_false_activation_rate"],
                "postFalseAct": post_metrics["no_sign_false_activation_rate"]
            }
        },
        "parity": {
            "status": "PASSED" if parity_passed else "FAILED",
            "samplesEvaluated": len(all_samples),
            "top1Agreement": top1_agreement,
            "maxProbabilityDiff": max_prob_diff,
            "meanProbabilityDiff": mean_prob_diff
        },
        "validationMetrics": {
            "accuracy": post_metrics["accuracy"],
            "macroF1": post_metrics["macro_f1"],
            "noSignFalseActivation": post_metrics["no_sign_false_activation_rate"],
            "realSignRejection": post_metrics["real_sign_rejection_rate"],
            "perClass": post_metrics["per_class"]
        },
        "benchmark": {
            "meanInferenceMs": round(mean_inf_ms, 2),
            "p95InferenceMs": round(p95_inf_ms, 2),
            "estimatedFirstCandidateSec": round(est_first_cand_sec, 2)
        }
    }
    with open(os.path.join(CANDIDATE_DEPLOY_DIR, "model-metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    # Save final report json in training/v3/reports/
    final_report_path = os.path.join(REPORTS_DIR, "final_candidate_b_report.json")
    with open(final_report_path, "w", encoding="utf-8") as f:
        json.dump({
            "candidate": candidate_key,
            "metadata": metadata,
            "calibration": calibration_data,
            "preMiningMetrics": pre_metrics,
            "postMiningMetrics": post_metrics,
            "streamingMetrics": val_stream_metrics
        }, f, indent=2)

    print(f"All deployment artifacts successfully written to: {CANDIDATE_DEPLOY_DIR}")
    print(f"Final training and calibration report written to: {final_report_path}")
    print("\nPHASE 2L FINAL MODEL TRAINING & EXPORT COMPLETE.")
    return metadata

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=str, default="B", help="Candidate key (default: B)")
    args = parser.parse_args()
    train_and_export_final(args.candidate)
