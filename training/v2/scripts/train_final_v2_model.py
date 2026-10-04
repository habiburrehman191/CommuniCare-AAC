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
import tf2onnx
import onnx
import onnxruntime as ort
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from data_pipeline_v2 import (
    load_original_dataset,
    build_dataset_arrays,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)
from models_v2 import build_gru_v2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
WORKSPACE_ROOT = os.path.dirname(TRAINING_DIR)
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")
DEPLOY_DIR = os.path.join(WORKSPACE_ROOT, "public", "models", "communicare-aac-sign-v2")

os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(DEPLOY_DIR, exist_ok=True)

def main():
    print("==================================================")
    print("PHASE 2I: FINAL V2 TRAINING & ONNX EXPORT")
    print("==================================================")
    
    # 1. Load all 483 original samples
    samples = load_original_dataset()
    labels = [s["label_id"] for s in samples]

    # 2. Strict sample-level 80/20 train/val split across both signers
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, val_idx = next(sss.split(np.zeros(len(samples)), labels))

    train_samples = [samples[i] for i in train_idx]
    val_samples = [samples[i] for i in val_idx]

    print(f"Sample-level split: {len(train_samples)} train original samples, {len(val_samples)} val original samples.")

    # 3. Selected best architecture:
    # 24-frame, 252 features (pos_vel), GRU, resample
    target_len = 24
    rep_name = "pos_vel"
    window_strategy = "resample"
    input_shape = (target_len, 252)

    X_train, y_train = build_dataset_arrays(
        train_samples, target_len=target_len, strategy=window_strategy, rep_name=rep_name, is_training=True
    )
    X_val, y_val = build_dataset_arrays(
        val_samples, target_len=target_len, strategy=window_strategy, rep_name=rep_name, is_training=False
    )

    print(f"Dataset arrays prepared:")
    print(f"  X_train: {X_train.shape} (augmented from {len(train_samples)} original samples)")
    print(f"  X_val:   {X_val.shape} (1 window per {len(val_samples)} original sample, NO augmentation)")

    # 4. Build and train V2 model
    model = build_gru_v2(input_shape=input_shape, num_classes=len(FROZEN_CLASSES), lr=0.001)
    model.summary()

    cb_early = callbacks.EarlyStopping(monitor="val_loss", patience=14, restore_best_weights=True, verbose=1)
    cb_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5, verbose=1)

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=70,
        batch_size=16,
        callbacks=[cb_early, cb_lr],
        verbose=1
    )

    # Evaluate validation metrics
    val_probs = model.predict(X_val, verbose=0)
    val_preds = np.argmax(val_probs, axis=1)
    val_acc = accuracy_score(y_val, val_preds)
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(y_val, val_preds, average='macro', zero_division=0)
    
    print(f"\nFinal V2 Combined Validation Results (NOT research LOSO):")
    print(f"  Val Accuracy: {val_acc:.4f}")
    print(f"  Macro F1:     {f1_macro:.4f}")

    # Save Keras model
    keras_save_path = os.path.join(OUTPUTS_DIR, "communicare_aac_sign_v2_gru.keras")
    model.save(keras_save_path)
    print(f"Saved Keras model to: {keras_save_path}")

    # 5. Export to ONNX
    onnx_path = os.path.join(DEPLOY_DIR, "model.onnx")
    input_signature = [
        tf.TensorSpec(shape=(1, target_len, 252), dtype=tf.float32, name="input_frames")
    ]
    
    print("\nExporting to ONNX...")
    onnx_model, _ = tf2onnx.convert.from_keras(
        model,
        input_signature=input_signature,
        opset=17,
        output_path=onnx_path
    )
    onnx.checker.check_model(onnx_model)
    onnx_size_bytes = os.path.getsize(onnx_path)
    print(f"ONNX exported successfully to: {onnx_path} ({onnx_size_bytes / 1024:.1f} KB)")

    # 6. Save Labels
    labels_path = os.path.join(DEPLOY_DIR, "labels.json")
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(FROZEN_CLASSES, f, indent=2)

    # 7. Save Feature Schema
    schema_info = {
        "version": "wrist_normalized_posvel_v2",
        "description": "CommuniCare AAC Sign Recognition V2 feature schema with wrist-normalized position and velocity",
        "sequenceLength": target_len,
        "featuresPerFrame": 252,
        "positionFeatureCount": 126,
        "velocityFeatureCount": 126,
        "motionFeatureCount": 0,
        "layout": {
            "position": {
                "leftHand": "indices 0..62 (21 landmarks x 3 coordinates)",
                "rightHand": "indices 63..125 (21 landmarks x 3 coordinates)"
            },
            "velocity": {
                "leftHand": "indices 126..188 (current_pos - prev_pos)",
                "rightHand": "indices 189..251 (current_pos - prev_pos)"
            }
        },
        "missingHandBehavior": "Zero values in both position and velocity if hand absent in current or adjacent frame",
        "normalization": "wrist_normalized_v1 for position; velocities computed from wrist-normalized coordinates",
        "fpsTarget": 30,
        "historySeconds": round(target_len / 30.0, 3)
    }
    schema_path = os.path.join(DEPLOY_DIR, "feature-schema.json")
    with open(schema_path, "w", encoding="utf-8") as f:
        json.dump(schema_info, f, indent=2)

    # 8. Save Metadata
    metadata_info = {
        "modelName": "CommuniCare AAC Sign V2",
        "version": "2.0.0",
        "architecture": "GRU",
        "framework": "Keras 3 / TensorFlow / tf2onnx",
        "opset": 17,
        "classes": FROZEN_CLASSES,
        "numClasses": len(FROZEN_CLASSES),
        "inputShape": [1, target_len, 252],
        "inputName": "input_frames",
        "outputName": "probabilities",
        "sequenceLength": target_len,
        "featuresPerFrame": 252,
        "featureSchema": "wrist_normalized_posvel_v2",
        "researchMetricsLOSO": {
            "meanAccuracy": 0.7046,
            "meanMacroF1": 0.6879,
            "v1BaselineAccuracy": 0.5553,
            "v1BaselineMacroF1": 0.5228,
            "accuracyImprovement": 0.1493,
            "f1Improvement": 0.1651,
            "historyDurationSeconds": 0.8,
            "v1HistoryDurationSeconds": 2.0,
            "latencyImprovementRatio": 2.5
        },
        "deploymentStatus": "research_candidate_ready_for_review",
        "activeInProduction": False,
        "dateCreated": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    meta_path = os.path.join(DEPLOY_DIR, "model-metadata.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata_info, f, indent=2)

    # 9. ONNX Parity Verification across all 483 original samples
    print("\nRunning ONNX Parity verification across all 483 samples...")
    X_all, y_all = build_dataset_arrays(
        samples, target_len=target_len, strategy=window_strategy, rep_name=rep_name, is_training=False
    )

    ort_session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = ort_session.get_inputs()[0].name

    max_diff = 0.0
    diff_sum = 0.0
    agreement_count = 0
    total_eval = len(X_all)

    t0_ort = time.perf_counter()
    for i in range(total_eval):
        sample_in = X_all[i:i+1]  # shape (1, 24, 252)
        
        # Native keras prediction
        k_prob = model.predict(sample_in, verbose=0)[0]
        k_pred = int(np.argmax(k_prob))

        # ONNX Runtime prediction
        ort_prob = ort_session.run(None, {input_name: sample_in})[0][0]
        ort_pred = int(np.argmax(ort_prob))

        if k_pred == ort_pred:
            agreement_count += 1

        abs_diff = np.abs(k_prob - ort_prob)
        diff_max_i = float(np.max(abs_diff))
        if diff_max_i > max_diff:
            max_diff = diff_max_i
        diff_sum += float(np.mean(abs_diff))

    t1_ort = time.perf_counter()
    avg_ort_latency_ms = ((t1_ort - t0_ort) / total_eval) * 1000.0
    mean_diff = diff_sum / total_eval
    agreement_pct = (agreement_count / total_eval) * 100.0

    parity_report = {
        "totalSamplesEvaluated": total_eval,
        "top1AgreementCount": agreement_count,
        "top1AgreementPercentage": agreement_pct,
        "maximumProbabilityDifference": float(max_diff),
        "meanProbabilityDifference": float(mean_diff),
        "ortInferenceLatencyMs": float(avg_ort_latency_ms),
        "parityVerified": bool(agreement_pct >= 99.0 and max_diff < 1e-4)
    }

    parity_report_path = os.path.join(REPORTS_DIR, "onnx_parity_report.json")
    with open(parity_report_path, "w", encoding="utf-8") as f:
        json.dump(parity_report, f, indent=2)

    print("\n==================================================")
    print("ONNX PARITY REPORT")
    print("==================================================")
    print(f"  Samples Evaluated:       {total_eval}")
    print(f"  Top-1 Agreement:         {agreement_pct:.2f}% ({agreement_count}/{total_eval})")
    print(f"  Max Absolute Difference: {max_diff:.8e}")
    print(f"  Mean Absolute Difference:{mean_diff:.8e}")
    print(f"  ORT Latency per sample:  {avg_ort_latency_ms:.2f} ms")
    print(f"  Parity Status:           {'PASSED' if parity_report['parityVerified'] else 'FAILED'}")

if __name__ == "__main__":
    main()
