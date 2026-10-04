import os
import json
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
    x = layers.Conv1D(64, kernel_size=3, padding="same", activation="relu", name="conv1d_feat")(x)
    x = layers.SpatialDropout1D(0.2)(x)
    x = layers.GRU(64, return_sequences=False, name="gru_temporal")(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(64, activation="relu", name="dense_head")(x)
    out = layers.Dense(len(FROZEN_CLASSES), activation="softmax", name="pred_out")(x)

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
    per_class_p, per_class_r, per_class_f1, _ = precision_recall_fscore_support(y_true, y_pred, average=None, zero_division=0)

    true_no_sign = np.where(y_true == NO_SIGN_IDX)[0]
    false_sign_activations = int(np.sum(y_pred[true_no_sign] != NO_SIGN_IDX))
    false_sign_activation_rate = float(false_sign_activations / max(len(true_no_sign), 1))

    true_sign = np.where(y_true != NO_SIGN_IDX)[0]
    real_sign_rejected = int(np.sum(y_pred[true_sign] == NO_SIGN_IDX))
    real_sign_rejection_rate = float(real_sign_rejected / max(len(true_sign), 1))

    weakest_class = min(
        [(cls, float(per_class_r[idx])) for idx, cls in enumerate(FROZEN_CLASSES) if cls != "NO_SIGN"],
        key=lambda x: x[1]
    )

    return {
        "accuracy": acc,
        "macro_f1": float(f1_macro),
        "macro_precision": float(p_macro),
        "macro_recall": float(r_macro),
        "no_sign_recall": float(per_class_r[NO_SIGN_IDX]),
        "no_sign_false_activation_rate": false_sign_activation_rate,
        "real_sign_rejection_rate": real_sign_rejection_rate,
        "weakest_class": {"label": weakest_class[0], "recall": weakest_class[1]},
        "per_class_recall": {cls: float(per_class_r[idx]) for idx, cls in enumerate(FROZEN_CLASSES)}
    }

def main():
    print("==================================================")
    print("PHASE 2J: PERSONALIZED CALIBRATION EXPERIMENT")
    print("==================================================")

    all_samples = load_original_dataset()
    designated_signer = "signer-01"

    target_samples = [s for s in all_samples if s["signer"] == designated_signer]
    other_samples = [s for s in all_samples if s["signer"] != designated_signer]

    # Split designated signer data into Calibration Set (8 samples per sign + 20 NO_SIGN) and Held-Out Test Set
    calib_samples = []
    test_samples = []

    # Group by class
    class_groups = {cls: [] for cls in FROZEN_CLASSES}
    for s in target_samples:
        class_groups[s["label"]].append(s)

    rng = random.Random(SEED)
    for cls in FROZEN_CLASSES:
        group = class_groups[cls]
        rng.shuffle(group)
        n_calib = 20 if cls == "NO_SIGN" else 8
        calib_samples.extend(group[:n_calib])
        test_samples.extend(group[n_calib:])

    print(f"Designated User: {designated_signer}")
    print(f"  Calibration Set (adaptation): {len(calib_samples)} samples")
    print(f"  Held-Out Evaluation Set:      {len(test_samples)} samples")
    print(f"  General Training Set (other 4 signers): {len(other_samples)} samples")

    # 1. Train General Model on the other 4 signers
    X_tr_gen, y_tr_gen = build_dataset_arrays(other_samples, TARGET_LEN, is_training=True)
    X_te_user, y_te_user = build_dataset_arrays(test_samples, TARGET_LEN, is_training=False)

    gen_model = build_conv1d_gru_model(input_shape=(TARGET_LEN, 252))
    cb_early = callbacks.EarlyStopping(monitor="loss", patience=8, restore_best_weights=True, verbose=0)
    print("\nTraining General Model on 4 signers...")
    gen_model.fit(X_tr_gen, y_tr_gen, epochs=30, batch_size=64, callbacks=[cb_early], verbose=0)

    # Evaluate General Model on designated user's held-out test set
    probs_gen = gen_model.predict(X_te_user, verbose=0)
    preds_gen = np.argmax(probs_gen, axis=1)
    eval_gen = evaluate_predictions(y_te_user, preds_gen, probs_gen)

    print(f"\n[GENERAL MODEL on {designated_signer} Held-Out Test]")
    print(f"  Accuracy:       {eval_gen['accuracy']*100:.2f}%")
    print(f"  Macro F1:       {eval_gen['macro_f1']:.4f}")
    print(f"  NO_SIGN False:  {eval_gen['no_sign_false_activation_rate']*100:.2f}%")
    print(f"  Weakest Class:  {eval_gen['weakest_class']['label']} ({eval_gen['weakest_class']['recall']*100:.1f}%)")

    # 2. Personalized Adaptation: Fine-tune on designated user's calibration set
    X_calib, y_calib = build_dataset_arrays(calib_samples, TARGET_LEN, is_training=True)

    pers_model = models.clone_model(gen_model)
    pers_model.set_weights(gen_model.get_weights())

    # Freeze convolutional feature extraction layer, adapt temporal GRU + head
    conv_layer = pers_model.get_layer("conv1d_feat")
    conv_layer.trainable = False

    pers_model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=2e-4),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )

    print(f"\nAdapting Personalized Model on {len(calib_samples)} calibration samples...")
    pers_model.fit(X_calib, y_calib, epochs=12, batch_size=16, verbose=0)

    # Evaluate Personalized Model on same held-out test set
    probs_pers = pers_model.predict(X_te_user, verbose=0)
    preds_pers = np.argmax(probs_pers, axis=1)
    eval_pers = evaluate_predictions(y_te_user, preds_pers, probs_pers)

    print(f"\n[PERSONALIZED MODEL on {designated_signer} Held-Out Test]")
    print(f"  Accuracy:       {eval_pers['accuracy']*100:.2f}%")
    print(f"  Macro F1:       {eval_pers['macro_f1']:.4f}")
    print(f"  NO_SIGN False:  {eval_pers['no_sign_false_activation_rate']*100:.2f}%")
    print(f"  Weakest Class:  {eval_pers['weakest_class']['label']} ({eval_pers['weakest_class']['recall']*100:.1f}%)")

    delta_acc = eval_pers["accuracy"] - eval_gen["accuracy"]
    delta_f1 = eval_pers["macro_f1"] - eval_gen["macro_f1"]
    delta_false_act = eval_pers["no_sign_false_activation_rate"] - eval_gen["no_sign_false_activation_rate"]

    print("\n" + "=" * 80)
    print("PERSONALIZATION COMPARISON SUMMARY")
    print("=" * 80)
    print(f"  Accuracy Delta:           {delta_acc*100:+.2f} percentage points")
    print(f"  Macro F1 Delta:           {delta_f1:+.4f}")
    print(f"  False Activation Delta:   {delta_false_act*100:+.2f} percentage points")

    result = {
        "designated_user": designated_signer,
        "calibration_sample_count": len(calib_samples),
        "held_out_test_sample_count": len(test_samples),
        "general_model": eval_gen,
        "personalized_model": eval_pers,
        "deltas": {
            "accuracy_pp": float(delta_acc * 100),
            "macro_f1": float(delta_f1),
            "false_activation_pp": float(delta_false_act * 100)
        }
    }

    out_file = os.path.join(REPORTS_DIR, "personalized_calibration_results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"Saved personalization report to: {out_file}")

if __name__ == "__main__":
    main()
