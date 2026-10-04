import os
import random
import json
import time
import numpy as np

# Deterministic seeding
SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

import keras
from keras import callbacks
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix
)
import matplotlib.pyplot as plt

from data_pipeline_v2 import (
    load_original_dataset,
    create_loso_splits,
    build_dataset_arrays,
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

def plot_confusion_matrix(cm, classes, title, output_path):
    fig, ax = plt.subplots(figsize=(8, 7))
    im = ax.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    
    ax.set(
        xticks=np.arange(cm.shape[1]),
        yticks=np.arange(cm.shape[0]),
        xticklabels=classes,
        yticklabels=classes,
        title=title,
        ylabel='True Label',
        xlabel='Predicted Label'
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")

    thresh = cm.max() / 2.
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, format(cm[i, j], 'd'),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black"
            )
    fig.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()

def evaluate_run_predictions(y_true, y_pred, y_prob):
    test_acc = float(accuracy_score(y_true, y_pred))
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(
        y_true, y_pred, average='macro', zero_division=0
    )
    p_weighted, r_weighted, f1_weighted, _ = precision_recall_fscore_support(
        y_true, y_pred, average='weighted', zero_division=0
    )
    per_class_p, per_class_r, per_class_f1, per_class_supp = precision_recall_fscore_support(
        y_true, y_pred, average=None, zero_division=0
    )
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(FROZEN_CLASSES))))

    # NO_SIGN safety (index 7)
    no_sign_idx = LABEL_TO_ID["NO_SIGN"]
    true_no_sign_indices = np.where(y_true == no_sign_idx)[0]
    false_sign_activations = int(np.sum(y_pred[true_no_sign_indices] != no_sign_idx))
    false_sign_activation_rate = float(false_sign_activations / max(len(true_no_sign_indices), 1))
    
    no_sign_confusions = {}
    for idx in true_no_sign_indices:
        pred_label_id = y_pred[idx]
        if pred_label_id != no_sign_idx:
            pred_label = ID_TO_LABEL[pred_label_id]
            no_sign_confusions[pred_label] = no_sign_confusions.get(pred_label, 0) + 1

    # Real sign rejection (ground truth != 7, predicted == 7)
    true_sign_indices = np.where(y_true != no_sign_idx)[0]
    real_sign_rejected_count = int(np.sum(y_pred[true_sign_indices] == no_sign_idx))
    real_sign_rejection_rate = float(real_sign_rejected_count / max(len(true_sign_indices), 1))

    real_sign_rejection_breakdown = {}
    for idx in true_sign_indices:
        if y_pred[idx] == no_sign_idx:
            t_label = ID_TO_LABEL[y_true[idx]]
            real_sign_rejection_breakdown[t_label] = real_sign_rejection_breakdown.get(t_label, 0) + 1

    per_class_metrics = {}
    for idx, cls in enumerate(FROZEN_CLASSES):
        per_class_metrics[cls] = {
            "precision": float(per_class_p[idx]),
            "recall": float(per_class_r[idx]),
            "f1": float(per_class_f1[idx]),
            "support": int(per_class_supp[idx])
        }

    return {
        "test_accuracy": test_acc,
        "macro_precision": float(p_macro),
        "macro_recall": float(r_macro),
        "macro_f1": float(f1_macro),
        "weighted_f1": float(f1_weighted),
        "per_class_metrics": per_class_metrics,
        "no_sign_safety": {
            "precision": float(per_class_p[no_sign_idx]),
            "recall": float(per_class_r[no_sign_idx]),
            "f1": float(per_class_f1[no_sign_idx]),
            "support": int(per_class_supp[no_sign_idx]),
            "false_sign_activations": false_sign_activations,
            "false_sign_activation_rate": false_sign_activation_rate,
            "confusions": no_sign_confusions
        },
        "real_sign_rejection": {
            "count": real_sign_rejected_count,
            "rate": real_sign_rejection_rate,
            "breakdown": real_sign_rejection_breakdown
        },
        "confusion_matrix": cm.tolist()
    }, cm

def measure_inference_latency(model, input_shape, runs=100):
    dummy_input = np.random.randn(1, *input_shape).astype(np.float32)
    # Warmup
    for _ in range(10):
        _ = model.predict(dummy_input, verbose=0)
    
    t0 = time.perf_counter()
    for _ in range(runs):
        _ = model.predict(dummy_input, verbose=0)
    t1 = time.perf_counter()
    avg_ms = ((t1 - t0) / runs) * 1000.0
    return float(avg_ms)

def train_and_eval_configuration(
    config_name,
    target_len,
    rep_name,
    model_arch,
    window_strategy,
    splits_a,
    splits_b
):
    print(f"\n=======================================================")
    print(f"RUNNING CONFIGURATION: {config_name}")
    print(f"  Length: {target_len} | Rep: {rep_name} | Arch: {model_arch} | Strategy: {window_strategy}")
    print(f"=======================================================")

    (ra_train, ra_val, ra_test) = splits_a
    (rb_train, rb_val, rb_test) = splits_b

    # Determine feature dim
    dummy_frames = np.zeros((target_len, 126), dtype=np.float32)
    from data_pipeline_v2 import transform_sample_to_representation
    feat_dim = transform_sample_to_representation(dummy_frames, rep_name).shape[1]
    input_shape = (target_len, feat_dim)

    # 1. RUN A: Train on signer-01, Test on signer-02
    print("\n--- RUN A (Train on signer-01, Test on signer-02) ---")
    X_tr_a, y_tr_a = build_dataset_arrays(ra_train, target_len, strategy=window_strategy, rep_name=rep_name, is_training=True)
    X_va_a, y_va_a = build_dataset_arrays(ra_val, target_len, strategy=window_strategy, rep_name=rep_name, is_training=False)
    X_te_a, y_te_a = build_dataset_arrays(ra_test, target_len, strategy=window_strategy, rep_name=rep_name, is_training=False)

    if model_arch == "GRU":
        model_a = build_gru_v2(input_shape=input_shape)
    elif model_arch == "Conv1D_GRU":
        model_a = build_conv1d_gru_v2(input_shape=input_shape)
    else:
        raise ValueError(f"Unknown arch: {model_arch}")

    cb_early_a = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=0)
    cb_lr_a = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=0)

    model_a.fit(
        X_tr_a, y_tr_a,
        validation_data=(X_va_a, y_va_a),
        epochs=60,
        batch_size=16,
        callbacks=[cb_early_a, cb_lr_a],
        verbose=0
    )

    y_prob_a = model_a.predict(X_te_a, verbose=0)
    y_pred_a = np.argmax(y_prob_a, axis=1)
    res_a, cm_a = evaluate_run_predictions(y_te_a, y_pred_a, y_prob_a)

    cm_path_a = os.path.join(REPORTS_DIR, f"cm_{config_name}_run_a.png")
    plot_confusion_matrix(cm_a, FROZEN_CLASSES, f"{config_name} Run A (s1->s2)", cm_path_a)

    print(f"Run A Test Acc: {res_a['test_accuracy']:.4f} | Macro F1: {res_a['macro_f1']:.4f} | NO_SIGN Rec: {res_a['no_sign_safety']['recall']:.4f} | False Act: {res_a['no_sign_safety']['false_sign_activation_rate']:.4f}")

    # 2. RUN B: Train on signer-02, Test on signer-01
    print("\n--- RUN B (Train on signer-02, Test on signer-01) ---")
    X_tr_b, y_tr_b = build_dataset_arrays(rb_train, target_len, strategy=window_strategy, rep_name=rep_name, is_training=True)
    X_va_b, y_va_b = build_dataset_arrays(rb_val, target_len, strategy=window_strategy, rep_name=rep_name, is_training=False)
    X_te_b, y_te_b = build_dataset_arrays(rb_test, target_len, strategy=window_strategy, rep_name=rep_name, is_training=False)

    if model_arch == "GRU":
        model_b = build_gru_v2(input_shape=input_shape)
    elif model_arch == "Conv1D_GRU":
        model_b = build_conv1d_gru_v2(input_shape=input_shape)

    cb_early_b = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=0)
    cb_lr_b = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=0)

    model_b.fit(
        X_tr_b, y_tr_b,
        validation_data=(X_va_b, y_va_b),
        epochs=60,
        batch_size=16,
        callbacks=[cb_early_b, cb_lr_b],
        verbose=0
    )

    y_prob_b = model_b.predict(X_te_b, verbose=0)
    y_pred_b = np.argmax(y_prob_b, axis=1)
    res_b, cm_b = evaluate_run_predictions(y_te_b, y_pred_b, y_prob_b)

    cm_path_b = os.path.join(REPORTS_DIR, f"cm_{config_name}_run_b.png")
    plot_confusion_matrix(cm_b, FROZEN_CLASSES, f"{config_name} Run B (s2->s1)", cm_path_b)

    print(f"Run B Test Acc: {res_b['test_accuracy']:.4f} | Macro F1: {res_b['macro_f1']:.4f} | NO_SIGN Rec: {res_b['no_sign_safety']['recall']:.4f} | False Act: {res_b['no_sign_safety']['false_sign_activation_rate']:.4f}")

    # Latency & param count
    param_count = int(model_a.count_params())
    latency_ms = measure_inference_latency(model_a, input_shape)
    history_sec = float(target_len / 30.0)

    # Combined / Mean metrics
    mean_acc = (res_a["test_accuracy"] + res_b["test_accuracy"]) / 2.0
    mean_f1 = (res_a["macro_f1"] + res_b["macro_f1"]) / 2.0
    mean_no_sign_recall = (res_a["no_sign_safety"]["recall"] + res_b["no_sign_safety"]["recall"]) / 2.0
    mean_false_act = (res_a["no_sign_safety"]["false_sign_activation_rate"] + res_b["no_sign_safety"]["false_sign_activation_rate"]) / 2.0

    # Weakest class recall
    mean_per_class_recall = {}
    for cls in FROZEN_CLASSES:
        mean_per_class_recall[cls] = (res_a["per_class_metrics"][cls]["recall"] + res_b["per_class_metrics"][cls]["recall"]) / 2.0
    weakest_class = min(mean_per_class_recall.items(), key=lambda x: x[1])

    # Combined confusion matrix
    cm_total = np.array(cm_a) + np.array(cm_b)

    # Confusion pairs discovery
    confusion_pairs = []
    for i in range(len(FROZEN_CLASSES)):
        for j in range(len(FROZEN_CLASSES)):
            if i != j and cm_total[i, j] > 0:
                confusion_pairs.append({
                    "true_label": FROZEN_CLASSES[i],
                    "predicted_label": FROZEN_CLASSES[j],
                    "count": int(cm_total[i, j])
                })
    confusion_pairs.sort(key=lambda x: x["count"], reverse=True)

    summary = {
        "config_name": config_name,
        "sequence_length": target_len,
        "feature_representation": rep_name,
        "feature_dimension": feat_dim,
        "model_architecture": model_arch,
        "window_strategy": window_strategy,
        "parameter_count": param_count,
        "history_duration_seconds": history_sec,
        "inference_latency_ms": latency_ms,
        "run_a": res_a,
        "run_b": res_b,
        "mean_accuracy": float(mean_acc),
        "mean_macro_f1": float(mean_f1),
        "mean_no_sign_recall": float(mean_no_sign_recall),
        "mean_no_sign_false_activation_rate": float(mean_false_act),
        "weakest_class": {
            "label": weakest_class[0],
            "mean_recall": float(weakest_class[1])
        },
        "mean_per_class_recall": mean_per_class_recall,
        "combined_confusion_matrix": cm_total.tolist(),
        "top_confusion_pairs": confusion_pairs[:10]
    }

    # Save configuration JSON
    cfg_json_path = os.path.join(REPORTS_DIR, f"{config_name}.json")
    with open(cfg_json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"\n=> MEAN RESULTS FOR {config_name}:")
    print(f"   Mean Test Acc:       {mean_acc:.4f}")
    print(f"   Mean Macro F1:       {mean_f1:.4f}")
    print(f"   Mean NO_SIGN Recall: {mean_no_sign_recall:.4f}")
    print(f"   Mean False Act Rate: {mean_false_act:.4f}")
    print(f"   Weakest Class:       {weakest_class[0]} ({weakest_class[1]:.4f})")
    print(f"   Inference Latency:   {latency_ms:.2f} ms")

    return summary

def main():
    print("==================================================")
    print("PHASE 2I: V2 RESEARCH & EXPERIMENTATION SUITE")
    print("==================================================")

    # 1. Load data & create strict original-sample splits
    samples = load_original_dataset()
    splits_a, splits_b = create_loso_splits(samples, val_ratio=0.2, seed=SEED)

    # 2. Experiment Matrix
    # We will test:
    # 1. 24-frame, pos_only (126), GRU, center_crop
    # 2. 30-frame, pos_only (126), GRU, center_crop
    # 3. 24-frame, pos_vel (252), GRU, center_crop
    # 4. 30-frame, pos_vel (252), GRU, center_crop
    # 5. 24-frame, pos_vel (252), Conv1D_GRU, center_crop
    # 6. 30-frame, pos_vel (252), Conv1D_GRU, center_crop
    # 7. 24-frame, compact_motion (134), GRU, center_crop
    # 8. 30-frame, compact_motion (134), GRU, center_crop
    # 9. 24-frame, pos_vel (252), GRU, resample
    # 10. 30-frame, pos_vel (252), GRU, resample

    experiments = [
        # (name, target_len, rep_name, arch, strategy)
        ("exp01_24frame_pos_gru_crop", 24, "pos_only", "GRU", "center_crop"),
        ("exp02_30frame_pos_gru_crop", 30, "pos_only", "GRU", "center_crop"),
        ("exp03_24frame_posvel_gru_crop", 24, "pos_vel", "GRU", "center_crop"),
        ("exp04_30frame_posvel_gru_crop", 30, "pos_vel", "GRU", "center_crop"),
        ("exp05_24frame_posvel_conv1d_gru_crop", 24, "pos_vel", "Conv1D_GRU", "center_crop"),
        ("exp06_30frame_posvel_conv1d_gru_crop", 30, "pos_vel", "Conv1D_GRU", "center_crop"),
        ("exp07_24frame_compactmotion_gru_crop", 24, "compact_motion", "GRU", "center_crop"),
        ("exp08_30frame_compactmotion_gru_crop", 30, "compact_motion", "GRU", "center_crop"),
        ("exp09_24frame_posvel_gru_resample", 24, "pos_vel", "GRU", "resample"),
        ("exp10_30frame_posvel_gru_resample", 30, "pos_vel", "GRU", "resample"),
    ]

    all_results = []
    for exp in experiments:
        name, target_len, rep_name, arch, strategy = exp
        res = train_and_eval_configuration(
            config_name=name,
            target_len=target_len,
            rep_name=rep_name,
            model_arch=arch,
            window_strategy=strategy,
            splits_a=splits_a,
            splits_b=splits_b
        )
        all_results.append(res)

    # 3. Overall comparison summary
    comparison_path = os.path.join(REPORTS_DIR, "v2_experiments_summary.json")
    with open(comparison_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    print("\n==================================================")
    print("V2 EXPERIMENTS COMPLETE - SUMMARY TABLE")
    print("==================================================")
    print(f"{'Config Name':<38} | {'Len':<4} | {'Dim':<4} | {'Arch':<10} | {'Mean Acc':<9} | {'Mean F1':<9} | {'False Act':<10} | {'Weakest Cls':<14} | {'Latency':<7}")
    print("-" * 125)
    for r in all_results:
        print(f"{r['config_name']:<38} | {r['sequence_length']:<4} | {r['feature_dimension']:<4} | {r['model_architecture']:<10} | {r['mean_accuracy']:<9.4f} | {r['mean_macro_f1']:<9.4f} | {r['mean_no_sign_false_activation_rate']:<10.4f} | {r['weakest_class']['label'] + ' ' + str(round(r['weakest_class']['mean_recall'], 2)):<14} | {r['inference_latency_ms']:<7.2f}ms")

if __name__ == "__main__":
    main()
