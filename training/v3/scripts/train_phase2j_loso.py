import os
import json
import time
import random
import numpy as np

SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

from tensorflow.keras import layers, models, callbacks
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import StratifiedShuffleSplit

# Import data pipeline from v2
import sys
V2_SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "v2", "scripts")
sys.path.append(V2_SCRIPTS)

from data_pipeline_v2 import (
    load_original_dataset,
    compute_position_velocity_features,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
V3_DIR = os.path.dirname(SCRIPT_DIR)
REPORTS_DIR = os.path.join(V3_DIR, "reports")
OUTPUTS_DIR = os.path.join(V3_DIR, "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]
TARGET_LEN = 24

def extract_consecutive_train_windows(frames_60, target_len=24):
    offsets = [0, 6, 12, 18, 24, 30, 36]
    windows = []
    for st in offsets:
        if st + target_len <= 60:
            windows.append(frames_60[st:st + target_len])
    return windows

def extract_consecutive_center_window(frames_60, target_len=24):
    st = (60 - target_len) // 2
    return frames_60[st:st + target_len]

def build_dataset_arrays(samples, target_len=24, is_training=False):
    X_list = []
    y_list = []
    for s in samples:
        frames_60 = s["frames"]
        lbl_id = s["label_id"]

        if is_training:
            sub_windows = extract_consecutive_train_windows(frames_60, target_len)
            for w in sub_windows:
                # 24 consecutive frames -> pos_vel features derived inside window
                feat = compute_position_velocity_features(w)
                X_list.append(feat)
                y_list.append(lbl_id)
        else:
            w = extract_consecutive_center_window(frames_60, target_len)
            feat = compute_position_velocity_features(w)
            X_list.append(feat)
            y_list.append(lbl_id)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.int64)

def build_conv1d_gru_model(input_shape=(24, 252)):
    inp = layers.Input(shape=input_shape)
    x = layers.Masking(mask_value=0.0)(inp)
    x = layers.Conv1D(64, kernel_size=3, padding="same", activation="relu")(x)
    x = layers.SpatialDropout1D(0.2)(x)
    x = layers.GRU(64, return_sequences=False)(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(64, activation="relu")(x)
    out = layers.Dense(len(FROZEN_CLASSES), activation="softmax")(x)

    model = models.Model(inputs=inp, outputs=out, name="communicare_stream_conv1d_gru_v3")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def evaluate_predictions(y_true, y_pred, y_prob):
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

    return {
        "accuracy": acc,
        "macro_f1": float(f1_macro),
        "macro_precision": float(p_macro),
        "macro_recall": float(r_macro),
        "weighted_f1": float(f1_weighted),
        "no_sign_recall": float(per_class_r[NO_SIGN_IDX]),
        "no_sign_false_activation_rate": false_sign_activation_rate,
        "real_sign_rejection_rate": real_sign_rejection_rate,
        "per_class": per_class,
        "confusion_matrix": cm.tolist()
    }

def calibrate_thresholds_on_validation(val_prob, y_val):
    """
    Finds optimal global threshold and top1-top2 margin on validation split only.
    Target: maximize macro F1 while keeping false activation low.
    """
    best_th = 0.50
    best_score = -999.0
    for th in [0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        preds = np.argmax(val_prob, axis=1)
        max_p = np.max(val_prob, axis=1)
        gated = np.where(max_p < th, NO_SIGN_IDX, preds)
        
        _, _, f1_m, _ = precision_recall_fscore_support(y_val, gated, average='macro', zero_division=0)
        true_ns = np.where(y_val == NO_SIGN_IDX)[0]
        false_act = np.sum(gated[true_ns] != NO_SIGN_IDX) / max(len(true_ns), 1)
        score = f1_m - (0.4 * false_act)
        if score > best_score:
            best_score = score
            best_th = th

    # Margin tuning
    best_margin = 0.10
    best_m_score = -999.0
    sorted_p = np.sort(val_prob, axis=1)[:, ::-1]
    top_diff = sorted_p[:, 0] - sorted_p[:, 1]
    for m in [0.05, 0.10, 0.15, 0.20, 0.25]:
        preds = np.argmax(val_prob, axis=1)
        gated = np.where(top_diff < m, NO_SIGN_IDX, preds)
        _, _, f1_m, _ = precision_recall_fscore_support(y_val, gated, average='macro', zero_division=0)
        true_ns = np.where(y_val == NO_SIGN_IDX)[0]
        false_act = np.sum(gated[true_ns] != NO_SIGN_IDX) / max(len(true_ns), 1)
        score = f1_m - (0.4 * false_act)
        if score > best_m_score:
            best_m_score = score
            best_margin = m

    return best_th, best_margin

def run_single_loso_fold(fold_idx, test_signer, all_samples, signers_list):
    print(f"\n=======================================================")
    print(f"RUNNING 5-FOLD LOSO: FOLD {fold_idx}/5 — TEST SIGNER: {test_signer}")
    print(f"=======================================================")

    test_samples = [s for s in all_samples if s["signer"] == test_signer]
    train_val_samples = [s for s in all_samples if s["signer"] != test_signer]

    # Stratified validation split from train_val pool (15%)
    tv_labels = [s["label_id"] for s in train_val_samples]
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED + fold_idx)
    tr_idx, val_idx = next(sss.split(np.zeros(len(train_val_samples)), tv_labels))

    train_samples = [train_val_samples[i] for i in tr_idx]
    val_samples = [train_val_samples[i] for i in val_idx]

    print(f"  Train: {len(train_samples)} samples | Val: {len(val_samples)} samples | Test: {len(test_samples)} samples")

    # Build datasets
    X_tr, y_tr = build_dataset_arrays(train_samples, TARGET_LEN, is_training=True)
    X_va, y_va = build_dataset_arrays(val_samples, TARGET_LEN, is_training=False)
    X_te, y_te = build_dataset_arrays(test_samples, TARGET_LEN, is_training=False)

    print(f"  Extracted sub-windows: X_tr={X_tr.shape}, X_va={X_va.shape}, X_te={X_te.shape}")

    # Compute balanced class weights to prevent positive bias
    unique_classes, class_counts = np.unique(y_tr, return_counts=True)
    total_tr = len(y_tr)
    class_weights = {}
    for c, cnt in zip(unique_classes, class_counts):
        class_weights[c] = float(total_tr / (len(unique_classes) * cnt))

    # Boost confused classes (want, thankyou) and NO_SIGN slightly
    class_weights[LABEL_TO_ID["want"]] *= 1.15
    class_weights[LABEL_TO_ID["thankyou"]] *= 1.15
    class_weights[NO_SIGN_IDX] *= 1.10

    model = build_conv1d_gru_model(input_shape=(TARGET_LEN, X_tr.shape[2]))

    cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True, verbose=0)
    cb_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, min_lr=1e-5, verbose=0)

    # Pass 1: Standard training
    model.fit(
        X_tr, y_tr,
        validation_data=(X_va, y_va),
        epochs=35,
        batch_size=64,
        class_weight=class_weights,
        callbacks=[cb_early, cb_lr],
        verbose=0
    )

    # Pass 2: Hard Negative Mining on Train
    train_preds = np.argmax(model.predict(X_tr, verbose=0), axis=1)
    hard_neg_mask = (y_tr == NO_SIGN_IDX) & (train_preds != NO_SIGN_IDX)
    hard_neg_count = int(np.sum(hard_neg_mask))
    print(f"  Hard Negative Mining: Identified {hard_neg_count} hard negative windows in training pool.")

    if hard_neg_count > 0:
        # Augment training set with hard negatives (2x repeat of misclassified NO_SIGN windows)
        X_hard = X_tr[hard_neg_mask]
        y_hard = y_tr[hard_neg_mask]
        X_tr_mined = np.concatenate([X_tr, X_hard, X_hard], axis=0)
        y_tr_mined = np.concatenate([y_tr, y_hard, y_hard], axis=0)

        # Fine-tune with reduced learning rate
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=2e-4),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"]
        )
        cb_ft = callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True, verbose=0)
        model.fit(
            X_tr_mined, y_tr_mined,
            validation_data=(X_va, y_va),
            epochs=10,
            batch_size=64,
            callbacks=[cb_ft],
            verbose=0
        )

    # Evaluate on validation to calibrate acceptance thresholds
    val_probs = model.predict(X_va, verbose=0)
    best_th, best_margin = calibrate_thresholds_on_validation(val_probs, y_va)
    print(f"  Validation-Tuned Acceptance: Global Threshold = {best_th:.2f}, Margin = {best_margin:.2f}")

    # Evaluate on held-out test signer
    test_probs = model.predict(X_te, verbose=0)
    test_preds_raw = np.argmax(test_probs, axis=1)

    eval_raw = evaluate_predictions(y_te, test_preds_raw, test_probs)

    # Gated predictions using validation-tuned threshold & margin
    max_p = np.max(test_probs, axis=1)
    sorted_p = np.sort(test_probs, axis=1)[:, ::-1]
    diff_p = sorted_p[:, 0] - sorted_p[:, 1]
    is_accepted = (max_p >= best_th) & (diff_p >= best_margin)
    test_preds_gated = np.where(~is_accepted, NO_SIGN_IDX, test_preds_raw)

    eval_gated = evaluate_predictions(y_te, test_preds_gated, test_probs)

    weakest_raw = min(
        [(cls, eval_raw["per_class"][cls]["recall"]) for cls in FROZEN_CLASSES if cls != "NO_SIGN"],
        key=lambda x: x[1]
    )
    weakest_gated = min(
        [(cls, eval_gated["per_class"][cls]["recall"]) for cls in FROZEN_CLASSES if cls != "NO_SIGN"],
        key=lambda x: x[1]
    )

    print(f"  [RAW TEST]   Acc: {eval_raw['accuracy']*100:.2f}% | Macro F1: {eval_raw['macro_f1']:.4f} | False Act: {eval_raw['no_sign_false_activation_rate']*100:.2f}% | Weakest: {weakest_raw[0]} ({weakest_raw[1]*100:.1f}%)")
    print(f"  [GATED TEST] Acc: {eval_gated['accuracy']*100:.2f}% | Macro F1: {eval_gated['macro_f1']:.4f} | False Act: {eval_gated['no_sign_false_activation_rate']*100:.2f}% | Weakest: {weakest_gated[0]} ({weakest_gated[1]*100:.1f}%)")

    fold_result = {
        "fold": fold_idx,
        "test_signer": test_signer,
        "sample_counts": {"train": len(train_samples), "val": len(val_samples), "test": len(test_samples)},
        "calibrated_params": {"threshold": best_th, "margin": best_margin},
        "raw_metrics": eval_raw,
        "gated_metrics": eval_gated,
        "weakest_class_raw": {"label": weakest_raw[0], "recall": weakest_raw[1]},
        "weakest_class_gated": {"label": weakest_gated[0], "recall": weakest_gated[1]}
    }
    return fold_result

def main():
    print("==================================================")
    print("PHASE 2J: 5-FOLD LEAVE-ONE-SIGNER-OUT EVALUATION")
    print("==================================================")

    all_samples = load_original_dataset()
    signers = ["signer-01", "signer-02", "signer-03", "signer-04", "signer-05"]

    fold_results = []
    out_file = os.path.join(REPORTS_DIR, "5fold_loso_summary.json")
    for i, s_id in enumerate(signers):
        res = run_single_loso_fold(i + 1, s_id, all_samples, signers)
        fold_results.append(res)
        # Incremental save
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump({"in_progress_folds": fold_results}, f, indent=2)
        print(f"  --> Saved incremental progress for {len(fold_results)}/5 folds.")

    # Compute overall LOSO summary
    mean_acc_raw = np.mean([r["raw_metrics"]["accuracy"] for r in fold_results])
    mean_f1_raw = np.mean([r["raw_metrics"]["macro_f1"] for r in fold_results])
    mean_false_act_raw = np.mean([r["raw_metrics"]["no_sign_false_activation_rate"] for r in fold_results])
    mean_rejection_raw = np.mean([r["raw_metrics"]["real_sign_rejection_rate"] for r in fold_results])

    mean_acc_gated = np.mean([r["gated_metrics"]["accuracy"] for r in fold_results])
    mean_f1_gated = np.mean([r["gated_metrics"]["macro_f1"] for r in fold_results])
    mean_false_act_gated = np.mean([r["gated_metrics"]["no_sign_false_activation_rate"] for r in fold_results])
    mean_rejection_gated = np.mean([r["gated_metrics"]["real_sign_rejection_rate"] for r in fold_results])

    acc_std = np.std([r["raw_metrics"]["accuracy"] for r in fold_results])

    # Per-class average recalls across folds
    per_class_recalls = {}
    for cls in FROZEN_CLASSES:
        per_class_recalls[cls] = float(np.mean([r["raw_metrics"]["per_class"][cls]["recall"] for r in fold_results]))

    weakest_overall = min(
        [(cls, per_class_recalls[cls]) for cls in FROZEN_CLASSES if cls != "NO_SIGN"],
        key=lambda x: x[1]
    )

    summary = {
        "evaluation_protocol": "5-Fold Leave-One-Signer-Out (LOSO)",
        "total_samples": len(all_samples),
        "signers": signers,
        "folds": fold_results,
        "mean_raw_metrics": {
            "accuracy": float(mean_acc_raw),
            "macro_f1": float(mean_f1_raw),
            "false_sign_activation_rate": float(mean_false_act_raw),
            "real_sign_rejection_rate": float(mean_rejection_raw),
            "accuracy_std": float(acc_std),
            "weakest_class": {"label": weakest_overall[0], "mean_recall": float(weakest_overall[1])},
            "per_class_mean_recall": per_class_recalls
        },
        "mean_gated_metrics": {
            "accuracy": float(mean_acc_gated),
            "macro_f1": float(mean_f1_gated),
            "false_sign_activation_rate": float(mean_false_act_gated),
            "real_sign_rejection_rate": float(mean_rejection_gated)
        }
    }

    out_file = os.path.join(REPORTS_DIR, "5fold_loso_summary.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 100)
    print("PHASE 2J: 5-FOLD LOSO EVALUATION COMPLETE")
    print("=" * 100)
    print(f"{'Fold':<6} | {'Test Signer':<12} | {'Raw Acc':<9} | {'Raw F1':<8} | {'False Act':<10} | {'Gated Acc':<10} | {'Gated False Act':<16} | {'Weakest Class'}")
    print("-" * 100)
    for r in fold_results:
        print(f"{r['fold']:<6} | {r['test_signer']:<12} | {r['raw_metrics']['accuracy']*100:<8.2f}% | {r['raw_metrics']['macro_f1']:<8.4f} | {r['raw_metrics']['no_sign_false_activation_rate']*100:<9.2f}% | {r['gated_metrics']['accuracy']*100:<9.2f}% | {r['gated_metrics']['no_sign_false_activation_rate']*100:<15.2f}% | {r['weakest_class_raw']['label']} ({r['weakest_class_raw']['recall']*100:.1f}%)")
    print("-" * 100)
    print(f"MEAN (LOSO RAW):   Acc={mean_acc_raw*100:.2f}% (std={acc_std*100:.2f}%) | Macro F1={mean_f1_raw:.4f} | False Act={mean_false_act_raw*100:.2f}% | Weakest={weakest_overall[0]} ({weakest_overall[1]*100:.1f}%)")
    print(f"MEAN (LOSO GATED): Acc={mean_acc_gated*100:.2f}% | Macro F1={mean_f1_gated:.4f} | False Act={mean_false_act_gated*100:.2f}%")
    print(f"Saved complete 5-fold report to: {out_file}")

if __name__ == "__main__":
    main()
