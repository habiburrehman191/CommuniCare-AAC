import os
import json
import numpy as np

from data_pipeline_v2 import (
    load_original_dataset,
    create_loso_splits,
    transform_sample_to_representation,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)
from models_v2 import build_conv1d_gru_v2, build_gru_v2
from train_true_streaming_suite import extract_consecutive_train_windows

import tensorflow as tf
from keras import callbacks

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")

NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]

def train_eval_model_loso(target_len, rep_name, arch, splits):
    """
    Trains on train/val of one signer, returns trained model.
    """
    (train_samples, val_samples, test_samples) = splits

    X_tr = []
    y_tr = []
    for s in train_samples:
        for w in extract_consecutive_train_windows(s["frames"], target_len):
            X_tr.append(transform_sample_to_representation(w, rep_name))
            y_tr.append(s["label_id"])
    X_tr = np.array(X_tr, dtype=np.float32)
    y_tr = np.array(y_tr, dtype=np.int64)

    X_va = []
    y_va = []
    for s in val_samples:
        st = (60 - target_len) // 2
        w = s["frames"][st:st + target_len]
        X_va.append(transform_sample_to_representation(w, rep_name))
        y_va.append(s["label_id"])
    X_va = np.array(X_va, dtype=np.float32)
    y_va = np.array(y_va, dtype=np.int64)

    input_shape = (target_len, X_tr.shape[2])
    if arch == "Conv1D_GRU":
        model = build_conv1d_gru_v2(input_shape=input_shape)
    else:
        model = build_gru_v2(input_shape=input_shape)

    cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=0)
    cb_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=0)
    model.fit(X_tr, y_tr, validation_data=(X_va, y_va), epochs=50, batch_size=16, callbacks=[cb_early, cb_lr], verbose=0)
    return model

def extract_sliding_stream(frames_60, target_len, rep_name, stride=3):
    windows = []
    for st in range(0, 60 - target_len + 1, stride):
        w = frames_60[st:st + target_len]
        windows.append(transform_sample_to_representation(w, rep_name))
    return np.array(windows, dtype=np.float32)

def evaluate_stability_rules(model, test_samples, target_len, rep_name, stride=3):
    """
    Evaluates:
    - 1-window rule (raw streaming)
    - 2-consecutive matching rule
    - 3-consecutive matching rule
    Across all test sequences.
    """
    results_1w = {"correct_sign": 0, "false_sign_on_no_sign": 0, "detected_sign": 0, "total_sign": 0, "total_no_sign": 0, "delays": []}
    results_2w = {"correct_sign": 0, "false_sign_on_no_sign": 0, "detected_sign": 0, "total_sign": 0, "total_no_sign": 0, "delays": []}
    results_3w = {"correct_sign": 0, "false_sign_on_no_sign": 0, "detected_sign": 0, "total_sign": 0, "total_no_sign": 0, "delays": []}

    for s in test_samples:
        true_label = s["label_id"]
        stream = extract_sliding_stream(s["frames"], target_len, rep_name, stride=stride)
        probs = model.predict(stream, verbose=0)
        preds = np.argmax(probs, axis=1)

        is_no_sign = (true_label == NO_SIGN_IDX)
        if is_no_sign:
            results_1w["total_no_sign"] += 1
            results_2w["total_no_sign"] += 1
            results_3w["total_no_sign"] += 1

            # 1-window false activation: any window predicts sign != NO_SIGN
            if np.any(preds != NO_SIGN_IDX):
                results_1w["false_sign_on_no_sign"] += 1

            # 2-window false activation: any 2 consecutive windows predict the SAME sign
            has_2w = False
            for t in range(1, len(preds)):
                if preds[t] != NO_SIGN_IDX and preds[t] == preds[t-1]:
                    has_2w = True
                    break
            if has_2w:
                results_2w["false_sign_on_no_sign"] += 1

            # 3-window false activation: any 3 consecutive windows predict the SAME sign
            has_3w = False
            for t in range(2, len(preds)):
                if preds[t] != NO_SIGN_IDX and preds[t] == preds[t-1] and preds[t] == preds[t-2]:
                    has_3w = True
                    break
            if has_3w:
                results_3w["false_sign_on_no_sign"] += 1

        else:
            results_1w["total_sign"] += 1
            results_2w["total_sign"] += 1
            results_3w["total_sign"] += 1

            # 1-window detection
            idx_1w = None
            for t in range(len(preds)):
                if preds[t] != NO_SIGN_IDX:
                    idx_1w = t
                    break
            if idx_1w is not None:
                results_1w["detected_sign"] += 1
                if preds[idx_1w] == true_label:
                    results_1w["correct_sign"] += 1
                results_1w["delays"].append(idx_1w * stride / 30.0)

            # 2-window detection
            idx_2w = None
            for t in range(1, len(preds)):
                if preds[t] != NO_SIGN_IDX and preds[t] == preds[t-1]:
                    idx_2w = t
                    break
            if idx_2w is not None:
                results_2w["detected_sign"] += 1
                if preds[idx_2w] == true_label:
                    results_2w["correct_sign"] += 1
                results_2w["delays"].append(idx_2w * stride / 30.0)

            # 3-window detection
            idx_3w = None
            for t in range(2, len(preds)):
                if preds[t] != NO_SIGN_IDX and preds[t] == preds[t-1] and preds[t] == preds[t-2]:
                    idx_3w = t
                    break
            if idx_3w is not None:
                results_3w["detected_sign"] += 1
                if preds[idx_3w] == true_label:
                    results_3w["correct_sign"] += 1
                results_3w["delays"].append(idx_3w * stride / 30.0)

    def summarize(res):
        cand_prec = float(res["correct_sign"] / max(res["detected_sign"], 1))
        cand_rec = float(res["correct_sign"] / max(res["total_sign"], 1))
        false_act = float(res["false_sign_on_no_sign"] / max(res["total_no_sign"], 1))
        avg_delay = float(np.mean(res["delays"])) if res["delays"] else 0.0
        return {
            "candidate_precision": cand_prec,
            "candidate_recall": cand_rec,
            "false_sign_activation_rate": false_act,
            "avg_additional_decision_delay_seconds": avg_delay
        }

    return {
        "1_window_raw": summarize(results_1w),
        "2_matching_windows": summarize(results_2w),
        "3_matching_windows": summarize(results_3w)
    }

def main():
    print("==================================================")
    print("PHASE 2I-B: TEMPORAL STABILITY EVALUATION (2 vs 3 MATCHING)")
    print("==================================================")

    samples = load_original_dataset()
    splits_a, splits_b = create_loso_splits(samples, val_ratio=0.2, seed=42)

    # Evaluate best candidate: stream_24frame_posvel_conv1d_gru
    print("\nTraining Run A (signer-01 train, signer-02 test)...")
    model_a = train_eval_model_loso(24, "pos_vel", "Conv1D_GRU", splits_a)
    print("Evaluating stability rules on Run A test set...")
    eval_a = evaluate_stability_rules(model_a, splits_a[2], 24, "pos_vel", stride=3)

    print("\nTraining Run B (signer-02 train, signer-01 test)...")
    model_b = train_eval_model_loso(24, "pos_vel", "Conv1D_GRU", splits_b)
    print("Evaluating stability rules on Run B test set...")
    eval_b = evaluate_stability_rules(model_b, splits_b[2], 24, "pos_vel", stride=3)

    combined = {}
    for rule in ["1_window_raw", "2_matching_windows", "3_matching_windows"]:
        combined[rule] = {
            "candidate_precision": (eval_a[rule]["candidate_precision"] + eval_b[rule]["candidate_precision"]) / 2.0,
            "candidate_recall": (eval_a[rule]["candidate_recall"] + eval_b[rule]["candidate_recall"]) / 2.0,
            "false_sign_activation_rate": (eval_a[rule]["false_sign_activation_rate"] + eval_b[rule]["false_sign_activation_rate"]) / 2.0,
            "avg_additional_decision_delay_seconds": (eval_a[rule]["avg_additional_decision_delay_seconds"] + eval_b[rule]["avg_additional_decision_delay_seconds"]) / 2.0,
            "run_a": eval_a[rule],
            "run_b": eval_b[rule]
        }

    print("\n" + "=" * 90)
    print("TEMPORAL STABILITY EVALUATION SUMMARY (stream_24frame_posvel_conv1d_gru)")
    print("=" * 90)
    print(f"{'Rule':<22} | {'Cand Prec':<11} | {'Cand Rec':<11} | {'False Act':<11} | {'Avg Decision Delay':<18}")
    print("-" * 90)
    for rule in ["1_window_raw", "2_matching_windows", "3_matching_windows"]:
        c = combined[rule]
        print(f"{rule:<22} | {c['candidate_precision']*100:<10.2f}% | {c['candidate_recall']*100:<10.2f}% | {c['false_sign_activation_rate']*100:<10.2f}% | +{c['avg_additional_decision_delay_seconds']*1000:<6.1f} ms")

    out_file = os.path.join(REPORTS_DIR, "temporal_stability_results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2)
    print(f"\nSaved temporal stability results to: {out_file}")

if __name__ == "__main__":
    main()
