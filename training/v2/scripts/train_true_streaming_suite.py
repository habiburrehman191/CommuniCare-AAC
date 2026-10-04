import os
import random
import json
import time
import numpy as np

SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

import keras
from keras import callbacks
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

from data_pipeline_v2 import (
    load_original_dataset,
    create_loso_splits,
    transform_sample_to_representation,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)
from models_v2 import build_gru_v2, build_conv1d_gru_v2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

def extract_consecutive_train_windows(frames_60, target_len):
    """
    Extracts consecutive true-streaming sub-windows from 60 frames.
    For 24: offsets 0, 6, 12, 18, 24, 30, 36 (length 24)
    For 30: offsets 0, 5, 10, 15, 20, 25, 30 (length 30)
    """
    if target_len == 24:
        offsets = [0, 6, 12, 18, 24, 30, 36]
    elif target_len == 30:
        offsets = [0, 5, 10, 15, 20, 25, 30]
    else:
        max_start = 60 - target_len
        offsets = list(range(0, max_start + 1, 6))

    windows = []
    for st in offsets:
        if st + target_len <= 60:
            windows.append(frames_60[st:st + target_len])
    return windows

def extract_consecutive_test_window(frames_60, target_len):
    """
    Deterministically extracts ONE single consecutive window per sequence for validation/test.
    Center crop: (60 - target_len) // 2
    """
    st = (60 - target_len) // 2
    return frames_60[st:st + target_len]

def build_streaming_dataset(samples, target_len, rep_name, is_training=False):
    X_list = []
    y_list = []
    for s in samples:
        frames_60 = s["frames"]
        label_id = s["label_id"]

        if is_training:
            sub_windows = extract_consecutive_train_windows(frames_60, target_len)
            for w in sub_windows:
                feat = transform_sample_to_representation(w, rep_name)
                X_list.append(feat)
                y_list.append(label_id)
        else:
            w = extract_consecutive_test_window(frames_60, target_len)
            feat = transform_sample_to_representation(w, rep_name)
            X_list.append(feat)
            y_list.append(label_id)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.int64)

def evaluate_predictions_dict(y_true, y_pred, y_prob):
    acc = float(accuracy_score(y_true, y_pred))
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(y_true, y_pred, average='macro', zero_division=0)
    p_weighted, r_weighted, f1_weighted, _ = precision_recall_fscore_support(y_true, y_pred, average='weighted', zero_division=0)
    per_class_p, per_class_r, per_class_f1, per_class_supp = precision_recall_fscore_support(y_true, y_pred, average=None, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(FROZEN_CLASSES))))

    no_sign_idx = LABEL_TO_ID["NO_SIGN"]
    true_no_sign_indices = np.where(y_true == no_sign_idx)[0]
    false_sign_activations = int(np.sum(y_pred[true_no_sign_indices] != no_sign_idx))
    false_sign_activation_rate = float(false_sign_activations / max(len(true_no_sign_indices), 1))

    true_sign_indices = np.where(y_true != no_sign_idx)[0]
    real_sign_rejected = int(np.sum(y_pred[true_sign_indices] == no_sign_idx))
    real_sign_rejection_rate = float(real_sign_rejected / max(len(true_sign_indices), 1))

    per_class = {}
    for idx, cls in enumerate(FROZEN_CLASSES):
        per_class[cls] = {
            "precision": float(per_class_p[idx]),
            "recall": float(per_class_r[idx]),
            "f1": float(per_class_f1[idx]),
            "support": int(per_class_supp[idx])
        }

    return {
        "accuracy": acc,
        "macro_precision": float(p_macro),
        "macro_recall": float(r_macro),
        "macro_f1": float(f1_macro),
        "weighted_f1": float(f1_weighted),
        "per_class": per_class,
        "no_sign_recall": float(per_class_r[no_sign_idx]),
        "no_sign_false_activation_rate": false_sign_activation_rate,
        "real_sign_rejection_rate": real_sign_rejection_rate,
        "confusion_matrix": cm.tolist()
    }

def run_streaming_experiment(config_name, target_len, rep_name, arch, splits_a, splits_b):
    print(f"\n=======================================================")
    print(f"TRAINING STREAMING MODEL: {config_name}")
    print(f"  Target Len: {target_len} | Rep: {rep_name} | Arch: {arch}")
    print(f"=======================================================")

    (ra_train, ra_val, ra_test) = splits_a
    (rb_train, rb_val, rb_test) = splits_b

    dummy = np.zeros((target_len, 126), dtype=np.float32)
    feat_dim = transform_sample_to_representation(dummy, rep_name).shape[1]
    input_shape = (target_len, feat_dim)

    # 1. RUN A
    X_tr_a, y_tr_a = build_streaming_dataset(ra_train, target_len, rep_name, is_training=True)
    X_va_a, y_va_a = build_streaming_dataset(ra_val, target_len, rep_name, is_training=False)
    X_te_a, y_te_a = build_streaming_dataset(ra_test, target_len, rep_name, is_training=False)

    if arch == "GRU":
        model_a = build_gru_v2(input_shape=input_shape)
    elif arch == "Conv1D_GRU":
        model_a = build_conv1d_gru_v2(input_shape=input_shape)

    cb_early_a = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=0)
    cb_lr_a = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=0)

    model_a.fit(X_tr_a, y_tr_a, validation_data=(X_va_a, y_va_a), epochs=60, batch_size=16, callbacks=[cb_early_a, cb_lr_a], verbose=0)

    val_prob_a = model_a.predict(X_va_a, verbose=0)
    y_prob_a = model_a.predict(X_te_a, verbose=0)
    y_pred_a = np.argmax(y_prob_a, axis=1)
    eval_a = evaluate_predictions_dict(y_te_a, y_pred_a, y_prob_a)

    # 2. RUN B
    X_tr_b, y_tr_b = build_streaming_dataset(rb_train, target_len, rep_name, is_training=True)
    X_va_b, y_va_b = build_streaming_dataset(rb_val, target_len, rep_name, is_training=False)
    X_te_b, y_te_b = build_streaming_dataset(rb_test, target_len, rep_name, is_training=False)

    if arch == "GRU":
        model_b = build_gru_v2(input_shape=input_shape)
    elif arch == "Conv1D_GRU":
        model_b = build_conv1d_gru_v2(input_shape=input_shape)

    cb_early_b = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=0)
    cb_lr_b = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=0)

    model_b.fit(X_tr_b, y_tr_b, validation_data=(X_va_b, y_va_b), epochs=60, batch_size=16, callbacks=[cb_early_b, cb_lr_b], verbose=0)

    val_prob_b = model_b.predict(X_va_b, verbose=0)
    y_prob_b = model_b.predict(X_te_b, verbose=0)
    y_pred_b = np.argmax(y_prob_b, axis=1)
    eval_b = evaluate_predictions_dict(y_te_b, y_pred_b, y_prob_b)

    # Save raw probability outputs for downstream calibration analysis
    probs_save_path = os.path.join(OUTPUTS_DIR, f"{config_name}_probs.npz")
    np.savez_compressed(
        probs_save_path,
        y_val_a=y_va_a, val_prob_a=val_prob_a,
        y_test_a=y_te_a, test_prob_a=y_prob_a,
        y_val_b=y_va_b, val_prob_b=val_prob_b,
        y_test_b=y_te_b, test_prob_b=y_prob_b
    )

    mean_acc = (eval_a["accuracy"] + eval_b["accuracy"]) / 2.0
    mean_f1 = (eval_a["macro_f1"] + eval_b["macro_f1"]) / 2.0
    gap = abs(eval_a["accuracy"] - eval_b["accuracy"])
    mean_no_sign_rec = (eval_a["no_sign_recall"] + eval_b["no_sign_recall"]) / 2.0
    mean_false_act = (eval_a["no_sign_false_activation_rate"] + eval_b["no_sign_false_activation_rate"]) / 2.0
    mean_rejection = (eval_a["real_sign_rejection_rate"] + eval_b["real_sign_rejection_rate"]) / 2.0

    mean_per_class_rec = {}
    for cls in FROZEN_CLASSES:
        mean_per_class_rec[cls] = (eval_a["per_class"][cls]["recall"] + eval_b["per_class"][cls]["recall"]) / 2.0
    weakest_cls = min(mean_per_class_rec.items(), key=lambda x: x[1])

    result = {
        "config_name": config_name,
        "target_len": target_len,
        "rep_name": rep_name,
        "arch": arch,
        "param_count": int(model_a.count_params()),
        "source_history_seconds": round(target_len / 30.0, 3),
        "run_a": eval_a,
        "run_b": eval_b,
        "mean_accuracy": float(mean_acc),
        "mean_macro_f1": float(mean_f1),
        "run_gap": float(gap),
        "mean_no_sign_recall": float(mean_no_sign_rec),
        "mean_no_sign_false_activation_rate": float(mean_false_act),
        "mean_real_sign_rejection_rate": float(mean_rejection),
        "weakest_class": {
            "label": weakest_cls[0],
            "mean_recall": float(weakest_cls[1])
        },
        "mean_per_class_recall": mean_per_class_rec
    }

    report_path = os.path.join(REPORTS_DIR, f"{config_name}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"  Run A Acc: {eval_a['accuracy']:.4f} | Run B Acc: {eval_b['accuracy']:.4f} | Gap: {gap*100:.2f}%")
    print(f"  Mean Acc:  {mean_acc:.4f} | Mean F1: {mean_f1:.4f} | False Act: {mean_false_act*100:.2f}% | Weakest: {weakest_cls[0]} ({weakest_cls[1]:.2f})")

    return result

def main():
    print("==================================================")
    print("PHASE 2I-B: TRAINING TRUE STREAMING MODEL SUITE")
    print("==================================================")

    samples = load_original_dataset()
    splits_a, splits_b = create_loso_splits(samples, val_ratio=0.2, seed=SEED)

    streaming_configs = [
        ("stream_24frame_posvel_gru", 24, "pos_vel", "GRU"),
        ("stream_30frame_posvel_gru", 30, "pos_vel", "GRU"),
        ("stream_24frame_posvel_conv1d_gru", 24, "pos_vel", "Conv1D_GRU"),
        ("stream_30frame_posvel_conv1d_gru", 30, "pos_vel", "Conv1D_GRU"),
        ("stream_24frame_compactmotion_gru", 24, "compact_motion", "GRU"),
        ("stream_30frame_compactmotion_gru", 30, "compact_motion", "GRU"),
    ]

    results = []
    for cfg in streaming_configs:
        name, target_len, rep_name, arch = cfg
        res = run_streaming_experiment(name, target_len, rep_name, arch, splits_a, splits_b)
        results.append(res)

    out_file = os.path.join(REPORTS_DIR, "true_streaming_suite_summary.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("\n==================================================")
    print("TRUE STREAMING SUITE EVALUATION COMPLETE")
    print("==================================================")
    print(f"{'Config Name':<34} | {'Len':<4} | {'Dim':<4} | {'Arch':<10} | {'Mean Acc':<9} | {'Mean F1':<9} | {'Run Gap':<8} | {'False Act':<10} | {'Weakest Cls':<14}")
    print("-" * 125)
    for r in results:
        print(f"{r['config_name']:<34} | {r['target_len']:<4} | {r['rep_name']:<10} | {r['arch']:<10} | {r['mean_accuracy']:<9.4f} | {r['mean_macro_f1']:<9.4f} | {r['run_gap']*100:<7.2f}% | {r['mean_no_sign_false_activation_rate']*100:<9.2f}% | {r['weakest_class']['label'] + ' ' + str(round(r['weakest_class']['mean_recall'], 2)):<14}")

if __name__ == "__main__":
    main()
