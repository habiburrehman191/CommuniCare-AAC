import os
import sys
import json
import time
import random
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
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import StratifiedShuffleSplit

# Local imports
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

V3_DIR = os.path.dirname(SCRIPT_DIR)
REPORTS_DIR = os.path.join(V3_DIR, "reports")
OUTPUTS_DIR = os.path.join(V3_DIR, "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

SIGNERS = ["signer-01", "signer-02", "signer-03", "signer-04"]

def evaluate_raw_predictions(y_true, y_pred, y_prob):
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

    # Find most confused pair (off-diagonal max)
    cm_copy = cm.copy()
    np.fill_diagonal(cm_copy, 0)
    max_idx = np.unravel_index(np.argmax(cm_copy, axis=None), cm_copy.shape)
    most_confused_pair = {
        "true": FROZEN_CLASSES[max_idx[0]],
        "pred": FROZEN_CLASSES[max_idx[1]],
        "count": int(cm_copy[max_idx])
    }

    # Weakest and strongest real sign (excluding NO_SIGN)
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

def calibrate_thresholds(val_probs, y_val):
    """
    Validation-only calibration.
    Grid search for global threshold and top1-top2 margin.
    Objective: maximize Macro F1 penalized by NO_SIGN false activation.
    """
    best_th = 0.50
    best_margin = 0.10
    best_score = -999.0

    thresholds = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]
    margins = [0.05, 0.10, 0.15, 0.20]

    max_p = np.max(val_probs, axis=1)
    sorted_p = np.sort(val_probs, axis=1)[:, ::-1]
    top_diff = sorted_p[:, 0] - sorted_p[:, 1]
    raw_preds = np.argmax(val_probs, axis=1)

    for th in thresholds:
        for m in margins:
            gated = np.where((max_p >= th) & (top_diff >= m), raw_preds, NO_SIGN_IDX)
            _, _, f1_m, _ = precision_recall_fscore_support(y_val, gated, average='macro', zero_division=0)
            true_ns = np.where(y_val == NO_SIGN_IDX)[0]
            false_act = np.sum(gated[true_ns] != NO_SIGN_IDX) / max(len(true_ns), 1)
            
            # Penalize false activation
            score = f1_m - (0.5 * false_act)
            if score > best_score:
                best_score = score
                best_th = th
                best_margin = m

    return float(best_th), float(best_margin)

def simulate_streaming_evaluation(model, test_samples, target_len=24, threshold=0.50, margin=0.10, stride_frames=3):
    """
    Simulates true sliding real-time recognition on consecutive frames of 60-frame test samples.
    Sliding stride: stride_frames (3 frames ~100 ms).
    Stability rule: 2 consecutive matching accepted predictions.
    """
    surfaced_preds = []
    latencies_sec = []
    ground_truth = []
    fps = 30.0

    window_starts = list(range(0, 60 - target_len + 1, stride_frames))
    num_windows_per_sample = len(window_starts)

    # Batch all sliding windows across all test samples in 1 single forward pass
    all_features = []
    for s in test_samples:
        frames_60 = s["frames"]
        for st in window_starts:
            w = frames_60[st:st + target_len]
            feat = compute_position_velocity_features(w)
            all_features.append(feat)

    all_features = np.array(all_features, dtype=np.float32)
    all_probs = model.predict(all_features, batch_size=256, verbose=0)

    for sample_idx, s in enumerate(test_samples):
        true_lbl = s["label_id"]
        ground_truth.append(true_lbl)

        start_prob_idx = sample_idx * num_windows_per_sample
        sample_probs = all_probs[start_prob_idx:start_prob_idx + num_windows_per_sample]

        consecutive_accepted = []
        surfaced_label = NO_SIGN_IDX
        surfaced_time = None

        for w_idx, st in enumerate(window_starts):
            prob = sample_probs[w_idx]
            top1_cls = int(np.argmax(prob))
            top1_p = float(prob[top1_cls])
            sorted_p = np.sort(prob)[::-1]
            diff_p = float(sorted_p[0] - sorted_p[1])

            window_end_time = (st + target_len) / fps

            # Acceptance check
            if top1_cls != NO_SIGN_IDX and top1_p >= threshold and diff_p >= margin:
                consecutive_accepted.append(top1_cls)
            else:
                consecutive_accepted.clear()

            # 2 consecutive matching predictions
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

    # Candidate precision: correctly surfaced real signs / all surfaced real signs
    surfaced_real_mask = (y_surf != NO_SIGN_IDX)
    if np.sum(surfaced_real_mask) > 0:
        cand_precision = float(np.sum(y_surf[surfaced_real_mask] == y_true[surfaced_real_mask]) / np.sum(surfaced_real_mask))
    else:
        cand_precision = 0.0

    # Candidate recall: correctly surfaced real signs / total true real signs
    true_real_mask = (y_true != NO_SIGN_IDX)
    cand_recall = float(np.sum((y_surf == y_true) & true_real_mask) / max(np.sum(true_real_mask), 1))

    # NO_SIGN false activation rate: NO_SIGN sequences that surfaced any candidate
    true_ns_mask = (y_true == NO_SIGN_IDX)
    ns_false_act = float(np.sum(y_surf[true_ns_mask] != NO_SIGN_IDX) / max(np.sum(true_ns_mask), 1))

    # Overall false candidate activation rate
    false_cand_activations = float(np.sum((y_surf != NO_SIGN_IDX) & (y_surf != y_true)) / len(y_true))

    avg_latency = float(np.mean(latencies_sec)) if latencies_sec else 0.0
    med_latency = float(np.median(latencies_sec)) if latencies_sec else 0.0
    p95_latency = float(np.percentile(latencies_sec, 95)) if latencies_sec else 0.0

    return {
        "candidate_precision": cand_precision,
        "candidate_recall": cand_recall,
        "no_sign_candidate_false_activation": ns_false_act,
        "false_candidate_activation_rate": false_cand_activations,
        "mean_latency_sec": avg_latency,
        "median_latency_sec": med_latency,
        "p95_latency_sec": p95_latency,
        "surfaced_count": int(np.sum(surfaced_real_mask)),
        "correct_surfaced_count": int(np.sum((y_surf == y_true) & true_real_mask))
    }

def run_loso_for_candidate(candidate_key, all_samples):
    specs = get_candidate_specs(candidate_key)
    target_len = specs["window"]
    print(f"\n================================================================================")
    print(f"EVALUATING CANDIDATE {candidate_key}: {specs['name']} (target_len={target_len})")
    print(f"================================================================================")

    fold_results = []
    rng = np.random.RandomState(SEED)

    for fold_idx, test_signer in enumerate(SIGNERS):
        print(f"\n--- FOLD {fold_idx + 1}/4: Held-out Test Signer = {test_signer} ---")
        test_samples = [s for s in all_samples if s["signer"] == test_signer]
        train_val_samples = [s for s in all_samples if s["signer"] != test_signer]

        # Grouped sequence-level split for validation (15% stratified by class and signer)
        tv_labels = [f"{s['signer']}_{s['label_id']}" for s in train_val_samples]
        sss = StratifiedShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED + fold_idx)
        tr_idx, val_idx = next(sss.split(np.zeros(len(train_val_samples)), tv_labels))

        train_samples = [train_val_samples[i] for i in tr_idx]
        val_samples = [train_val_samples[i] for i in val_idx]

        print(f"  Samples: Train={len(train_samples)}, Val={len(val_samples)}, Test={len(test_samples)}")

        # Build feature arrays
        X_tr, y_tr = build_fold_arrays(train_samples, target_len=target_len, is_training=True, rng=rng, augment=True)
        X_va, y_va = build_fold_arrays(val_samples, target_len=target_len, is_training=False, augment=False)
        X_te, y_te = build_fold_arrays(test_samples, target_len=target_len, is_training=False, augment=False)

        print(f"  Shapes: X_tr={X_tr.shape}, X_va={X_va.shape}, X_te={X_te.shape}")

        # Compute balanced class weights
        classes, counts = np.unique(y_tr, return_counts=True)
        total_tr = len(y_tr)
        class_weights = {int(c): float(total_tr / (len(classes) * cnt)) for c, cnt in zip(classes, counts)}
        # Slight boost for NO_SIGN and difficult confusion pairs
        class_weights[LABEL_TO_ID["want"]] *= 1.15
        class_weights[LABEL_TO_ID["thankyou"]] *= 1.15
        class_weights[NO_SIGN_IDX] *= 1.10

        # Build and train model
        model = build_candidate_model(candidate_key)
        cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=7, restore_best_weights=True, verbose=0)
        cb_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, min_lr=1e-5, verbose=0)

        # Stage 1: Main training
        model.fit(
            X_tr, y_tr,
            validation_data=(X_va, y_va),
            epochs=30,
            batch_size=64,
            class_weight=class_weights,
            callbacks=[cb_early, cb_lr],
            verbose=0
        )

        # Stage 2: Hard Negative Mining on Train/Val only (Section 12)
        train_preds = np.argmax(model.predict(X_tr, verbose=0), axis=1)
        hard_neg_mask = (y_tr == NO_SIGN_IDX) & (train_preds != NO_SIGN_IDX)
        hard_neg_count = int(np.sum(hard_neg_mask))
        hard_neg_pred_classes = Counter([ID_TO_LABEL[p] for p in train_preds[hard_neg_mask]])
        print(f"  Hard Negative Mining: {hard_neg_count} hard negative windows in training pool.")
        if hard_neg_count > 0:
            print(f"  Dominant false-sign classes: {dict(hard_neg_pred_classes)}")
            # Repeat hard negatives twice
            X_hard = X_tr[hard_neg_mask]
            y_hard = y_tr[hard_neg_mask]
            X_tr_mined = np.concatenate([X_tr, X_hard, X_hard], axis=0)
            y_tr_mined = np.concatenate([y_tr, y_hard, y_hard], axis=0)

            # Short fine-tuning pass
            model.compile(
                optimizer=tf.keras.optimizers.Adam(learning_rate=2e-4),
                loss="sparse_categorical_crossentropy",
                metrics=["accuracy"]
            )
            cb_ft = callbacks.EarlyStopping(monitor="val_loss", patience=4, restore_best_weights=True, verbose=0)
            model.fit(
                X_tr_mined, y_tr_mined,
                validation_data=(X_va, y_va),
                epochs=8,
                batch_size=64,
                callbacks=[cb_ft],
                verbose=0
            )

        # Validation calibration (Section 17)
        val_probs = model.predict(X_va, verbose=0)
        calib_th, calib_margin = calibrate_thresholds(val_probs, y_va)
        print(f"  Validation Calibrated: Threshold={calib_th:.2f}, Margin={calib_margin:.2f}")

        # Raw evaluation on test set (Section 16)
        test_probs = model.predict(X_te, verbose=0)
        test_preds = np.argmax(test_probs, axis=1)
        raw_metrics = evaluate_raw_predictions(y_te, test_preds, test_probs)

        # Gated evaluation
        max_p = np.max(test_probs, axis=1)
        sorted_p = np.sort(test_probs, axis=1)[:, ::-1]
        diff_p = sorted_p[:, 0] - sorted_p[:, 1]
        gated_preds = np.where((max_p >= calib_th) & (diff_p >= calib_margin), test_preds, NO_SIGN_IDX)
        gated_metrics = evaluate_raw_predictions(y_te, gated_preds, test_probs)

        # Streaming simulation (Section 20)
        streaming_metrics = simulate_streaming_evaluation(
            model, test_samples, target_len=target_len,
            threshold=calib_th, margin=calib_margin, stride_frames=3
        )

        print(f"  Fold {fold_idx + 1} Results:")
        print(f"    Raw Acc: {raw_metrics['accuracy']*100:.2f}% | Raw Macro F1: {raw_metrics['macro_f1']:.4f}")
        print(f"    NO_SIGN False Act: {raw_metrics['no_sign_false_activation_rate']*100:.2f}% | Real-Sign Rejection: {raw_metrics['real_sign_rejection_rate']*100:.2f}%")
        print(f"    Weakest: {raw_metrics['weakest_sign']['label']} ({raw_metrics['weakest_sign']['recall']*100:.1f}%) | Strongest: {raw_metrics['strongest_sign']['label']} ({raw_metrics['strongest_sign']['recall']*100:.1f}%)")
        print(f"    Streaming Candidate Recall: {streaming_metrics['candidate_recall']*100:.2f}% | Mean Latency: {streaming_metrics['mean_latency_sec']:.2f}s")

        fold_results.append({
            "fold": fold_idx + 1,
            "test_signer": test_signer,
            "calibrated_threshold": calib_th,
            "calibrated_margin": calib_margin,
            "raw_metrics": raw_metrics,
            "gated_metrics": gated_metrics,
            "streaming_metrics": streaming_metrics,
            "hard_neg_count": hard_neg_count,
            "hard_neg_classes": dict(hard_neg_pred_classes)
        })

    # Summary metrics across 4 folds
    mean_acc = float(np.mean([f["raw_metrics"]["accuracy"] for f in fold_results]))
    std_acc = float(np.std([f["raw_metrics"]["accuracy"] for f in fold_results]))
    mean_f1 = float(np.mean([f["raw_metrics"]["macro_f1"] for f in fold_results]))
    std_f1 = float(np.std([f["raw_metrics"]["macro_f1"] for f in fold_results]))
    mean_false_act = float(np.mean([f["raw_metrics"]["no_sign_false_activation_rate"] for f in fold_results]))
    mean_rejection = float(np.mean([f["raw_metrics"]["real_sign_rejection_rate"] for f in fold_results]))
    
    # Per-class mean recall
    per_class_recalls = {}
    for cls in FROZEN_CLASSES:
        per_class_recalls[cls] = float(np.mean([f["raw_metrics"]["per_class"][cls]["recall"] for f in fold_results]))
    real_sign_recalls = {cls: r for cls, r in per_class_recalls.items() if cls != "NO_SIGN"}
    weakest_cls = min(real_sign_recalls.items(), key=lambda x: x[1])

    mean_stream_recall = float(np.mean([f["streaming_metrics"]["candidate_recall"] for f in fold_results]))
    mean_stream_latency = float(np.mean([f["streaming_metrics"]["mean_latency_sec"] for f in fold_results]))

    summary = {
        "candidate": candidate_key,
        "name": specs["name"],
        "window": target_len,
        "features": specs["features"],
        "parameter_count": build_candidate_model(candidate_key).count_params(),
        "folds": fold_results,
        "mean_accuracy": mean_acc,
        "accuracy_std": std_acc,
        "mean_macro_f1": mean_f1,
        "macro_f1_std": std_f1,
        "mean_no_sign_false_activation": mean_false_act,
        "mean_real_sign_rejection": mean_rejection,
        "weakest_sign": {"label": weakest_cls[0], "recall": float(weakest_cls[1])},
        "per_class_mean_recall": per_class_recalls,
        "mean_streaming_recall": mean_stream_recall,
        "mean_streaming_latency": mean_stream_latency
    }

    print(f"\n>>> CANDIDATE {candidate_key} SUMMARY: Mean Acc={mean_acc*100:.2f}% (std={std_acc*100:.2f}%) | Macro F1={mean_f1:.4f} | False Act={mean_false_act*100:.2f}% | Weakest={weakest_cls[0]} ({weakest_cls[1]*100:.1f}%) | Stream Recall={mean_stream_recall*100:.2f}% | Latency={mean_stream_latency:.2f}s")
    return summary

def print_candidate_short_summary(s):
    f = s["folds"]
    mean_stream_prec = float(np.mean([x["streaming_metrics"]["candidate_precision"] for x in f]))
    mean_stream_rec = float(np.mean([x["streaming_metrics"]["candidate_recall"] for x in f]))
    mean_stream_fa = float(np.mean([x["streaming_metrics"]["no_sign_candidate_false_activation"] for x in f]))
    mean_stream_lat = float(np.mean([x["streaming_metrics"]["mean_latency_sec"] for x in f]))

    print(f"\n==================================================")
    print(f"SHORT SUMMARY — CANDIDATE {s['candidate']}")
    print(f"==================================================")
    print(f"Candidate ID: {s['candidate']}")
    print(f"Architecture: {s['name']}")
    print(f"Frames: {s['window']}")
    print(f"Parameter count: {s['parameter_count']}")
    for fold_i, fold_data in enumerate(f):
        fold_acc = fold_data["raw_metrics"]["accuracy"] * 100.0
        fold_f1 = fold_data["raw_metrics"]["macro_f1"]
        print(f"Fold {fold_i + 1} accuracy / macro F1: {fold_acc:.2f}% / {fold_f1:.4f}")
    print(f"Mean accuracy: {s['mean_accuracy'] * 100.0:.2f}%")
    print(f"Accuracy std: {s['accuracy_std'] * 100.0:.2f}%")
    print(f"Mean macro F1: {s['mean_macro_f1']:.4f}")
    print(f"Macro F1 std: {s['macro_f1_std']:.4f}")
    print(f"Mean NO_SIGN false activation: {s['mean_no_sign_false_activation'] * 100.0:.2f}%")
    print(f"Mean real-sign rejection: {s['mean_real_sign_rejection'] * 100.0:.2f}%")
    print(f"Weakest sign: {s['weakest_sign']['label']}")
    print(f"Weakest-sign recall: {s['weakest_sign']['recall'] * 100.0:.2f}%")
    print(f"Mean streaming precision: {mean_stream_prec * 100.0:.2f}%")
    print(f"Mean streaming recall: {mean_stream_rec * 100.0:.2f}%")
    print(f"Mean streaming NO_SIGN false activation: {mean_stream_fa * 100.0:.2f}%")
    print(f"Mean streaming latency: {mean_stream_lat:.2f}s")
    print(f"==================================================\n")

def main():
    print("================================================================================")
    print("PHASE 2K: BOUNDED MODEL SEARCH (6 CANDIDATES) — 4-FOLD LOSO REAL HUMAN SIGNERS")
    print("================================================================================")
    start_time = time.time()

    all_samples = load_four_real_signers()
    candidate_keys = ["A", "B", "C", "D", "E", "F"]

    all_summaries = {}
    out_file = os.path.join(REPORTS_DIR, "bounded_search_results.json")
    if os.path.exists(out_file):
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                all_summaries = json.load(f)
            print(f"Loaded existing results from {out_file}. Already completed: {list(all_summaries.keys())}")
        except Exception as e:
            print(f"Warning: could not read existing {out_file}: {e}")
            all_summaries = {}

    for c_key in candidate_keys:
        if c_key in all_summaries and len(all_summaries[c_key].get("folds", [])) == 4:
            print(f"\n================================================================================")
            print(f"SKIPPING COMPLETED CANDIDATE {c_key}: {all_summaries[c_key].get('name')} (already complete with 4 folds)")
            print(f"================================================================================")
            print_candidate_short_summary(all_summaries[c_key])
            continue

        cand_summary = run_loso_for_candidate(c_key, all_samples)
        all_summaries[c_key] = cand_summary

        # Immediate safe/atomic save after each candidate
        tmp_file = out_file + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(all_summaries, f, indent=2)
        os.replace(tmp_file, out_file)
        print(f"--> Saved candidate {c_key} to {out_file} (checkpoint containing: {list(all_summaries.keys())})")

        # Print short summary
        print_candidate_short_summary(cand_summary)

    elapsed = time.time() - start_time
    print(f"\n================================================================================")
    print(f"BOUNDED MODEL SEARCH COMPLETE in {elapsed/60:.2f} minutes")
    print(f"================================================================================")

    # Print candidate comparison matrix
    print("\n" + "=" * 170)
    print("PHASE 2K BOUNDED SEARCH CANDIDATE COMPARISON TABLE")
    print("=" * 170)
    header = f"{'Cand':<4} | {'Win':<3} | {'Architecture':<26} | {'Params':<8} | {'Mean Acc':<9} | {'Acc SD':<7} | {'Macro F1':<8} | {'F1 SD':<6} | {'False Act':<9} | {'Rejection':<9} | {'Weakest Recall':<15} | {'Stream Prec':<11} | {'Stream Rec':<10} | {'Stream FA':<9} | {'Stream Lat'}"
    print(header)
    print("-" * 170)
    for k in candidate_keys:
        if k not in all_summaries:
            continue
        s = all_summaries[k]
        f = s.get("folds", [])
        mean_stream_prec = float(np.mean([x["streaming_metrics"]["candidate_precision"] for x in f])) if f else 0.0
        mean_stream_rec = float(np.mean([x["streaming_metrics"]["candidate_recall"] for x in f])) if f else 0.0
        mean_stream_fa = float(np.mean([x["streaming_metrics"]["no_sign_candidate_false_activation"] for x in f])) if f else 0.0
        mean_stream_lat = float(np.mean([x["streaming_metrics"]["mean_latency_sec"] for x in f])) if f else 0.0
        w_str = f"{s['weakest_sign']['label']} ({s['weakest_sign']['recall']*100:.1f}%)"
        print(f"{k:<4} | {s['window']:<3} | {s['name']:<26} | {s['parameter_count']:<8} | {s['mean_accuracy']*100:<8.2f}% | {s['accuracy_std']*100:<6.2f}% | {s['mean_macro_f1']:<8.4f} | {s['macro_f1_std']:<6.4f} | {s['mean_no_sign_false_activation']*100:<8.2f}% | {s['mean_real_sign_rejection']*100:<8.2f}% | {w_str:<15} | {mean_stream_prec*100:<10.2f}% | {mean_stream_rec*100:<9.2f}% | {mean_stream_fa*100:<8.2f}% | {mean_stream_lat:.2f}s")
    print("=" * 170)

if __name__ == "__main__":
    main()

