import os
import time
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
from train_true_streaming_suite import extract_consecutive_train_windows, extract_consecutive_test_window

import tensorflow as tf
from tensorflow.keras import layers, models, callbacks
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")

NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]

def build_binary_dataset(samples, target_len, rep_name, is_training=False):
    X = []
    y = []  # 1 for SIGN, 0 for NO_SIGN
    for s in samples:
        frames_60 = s["frames"]
        is_sign = 1 if s["label_id"] != NO_SIGN_IDX else 0

        if is_training:
            sub_w = extract_consecutive_train_windows(frames_60, target_len)
            for w in sub_w:
                X.append(transform_sample_to_representation(w, rep_name))
                y.append(is_sign)
        else:
            w = extract_consecutive_test_window(frames_60, target_len)
            X.append(transform_sample_to_representation(w, rep_name))
            y.append(is_sign)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)

def build_binary_classifier(input_shape):
    inp = layers.Input(shape=input_shape)
    x = layers.Masking(mask_value=0.0)(inp)
    x = layers.GRU(48, return_sequences=False)(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(32, activation="relu")(x)
    out = layers.Dense(2, activation="softmax")(x)  # class 0: NO_SIGN, class 1: SIGN
    model = models.Model(inputs=inp, outputs=out, name="binary_sign_gate")
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model

def main():
    print("==================================================")
    print("PHASE 2I-B: BINARY SIGN-VS-NO_SIGN GATE EVALUATION")
    print("==================================================")

    samples = load_original_dataset()
    splits_a, splits_b = create_loso_splits(samples, val_ratio=0.2, seed=42)

    target_len = 24
    rep_name = "pos_vel"

    # RUN A
    X_tr_a, y_tr_a = build_binary_dataset(splits_a[0], target_len, rep_name, is_training=True)
    X_va_a, y_va_a = build_binary_dataset(splits_a[1], target_len, rep_name, is_training=False)
    X_te_a, y_te_a = build_binary_dataset(splits_a[2], target_len, rep_name, is_training=False)

    model_bin_a = build_binary_classifier((target_len, X_tr_a.shape[2]))
    # Class weights to counteract the 7:1 imbalance
    cw_0 = len(y_tr_a) / (2.0 * np.sum(y_tr_a == 0))
    cw_1 = len(y_tr_a) / (2.0 * np.sum(y_tr_a == 1))
    class_weights = {0: cw_0, 1: cw_1}

    cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=12, restore_best_weights=True, verbose=0)
    model_bin_a.fit(X_tr_a, y_tr_a, validation_data=(X_va_a, y_va_a), epochs=50, batch_size=16, class_weight=class_weights, callbacks=[cb_early], verbose=0)

    # Measure binary inference latency
    t0 = time.perf_counter()
    for _ in range(50):
        _ = model_bin_a.predict(X_te_a[:1], verbose=0)
    bin_lat_ms = (time.perf_counter() - t0) / 50.0 * 1000.0

    preds_bin_a = np.argmax(model_bin_a.predict(X_te_a, verbose=0), axis=1)
    p_a, r_a, f1_a, _ = precision_recall_fscore_support(y_te_a, preds_bin_a, average='binary', zero_division=0)

    # True NO_SIGN false activation on binary gate: true 0 predicted as 1
    true_no_sign_a = np.where(y_te_a == 0)[0]
    false_act_a = float(np.sum(preds_bin_a[true_no_sign_a] == 1) / max(len(true_no_sign_a), 1))

    # RUN B
    X_tr_b, y_tr_b = build_binary_dataset(splits_b[0], target_len, rep_name, is_training=True)
    X_va_b, y_va_b = build_binary_dataset(splits_b[1], target_len, rep_name, is_training=False)
    X_te_b, y_te_b = build_binary_dataset(splits_b[2], target_len, rep_name, is_training=False)

    model_bin_b = build_binary_classifier((target_len, X_tr_b.shape[2]))
    cb_early_b = callbacks.EarlyStopping(monitor="val_loss", patience=12, restore_best_weights=True, verbose=0)
    model_bin_b.fit(X_tr_b, y_tr_b, validation_data=(X_va_b, y_va_b), epochs=50, batch_size=16, class_weight=class_weights, callbacks=[cb_early_b], verbose=0)

    preds_bin_b = np.argmax(model_bin_b.predict(X_te_b, verbose=0), axis=1)
    p_b, r_b, f1_b, _ = precision_recall_fscore_support(y_te_b, preds_bin_b, average='binary', zero_division=0)
    true_no_sign_b = np.where(y_te_b == 0)[0]
    false_act_b = float(np.sum(preds_bin_b[true_no_sign_b] == 1) / max(len(true_no_sign_b), 1))

    mean_prec = (p_a + p_b) / 2.0
    mean_rec = (r_a + r_b) / 2.0
    mean_f1 = (f1_a + f1_b) / 2.0
    mean_false_act = (false_act_a + false_act_b) / 2.0

    result = {
        "binary_precision": float(mean_prec),
        "binary_recall": float(mean_rec),
        "binary_f1": float(mean_f1),
        "false_sign_activation_rate": float(mean_false_act),
        "added_inference_latency_ms": round(float(bin_lat_ms), 2),
        "run_a": {
            "precision": float(p_a),
            "recall": float(r_a),
            "f1": float(f1_a),
            "false_sign_activation_rate": float(false_act_a)
        },
        "run_b": {
            "precision": float(p_b),
            "recall": float(r_b),
            "f1": float(f1_b),
            "false_sign_activation_rate": float(false_act_b)
        }
    }

    print("\n" + "=" * 80)
    print("BINARY SIGN-VS-NO_SIGN GATE EVALUATION RESULTS")
    print("=" * 80)
    print(f"  Binary Precision:     {mean_prec*100:.2f}%")
    print(f"  Binary Recall (Sign): {mean_rec*100:.2f}%")
    print(f"  Binary F1:            {mean_f1:.4f}")
    print(f"  NO_SIGN False Act:    {mean_false_act*100:.2f}%")
    print(f"  Added Latency:        +{bin_lat_ms:.2f} ms")

    out_file = os.path.join(REPORTS_DIR, "binary_gate_results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved binary gate results to: {out_file}")

if __name__ == "__main__":
    main()
