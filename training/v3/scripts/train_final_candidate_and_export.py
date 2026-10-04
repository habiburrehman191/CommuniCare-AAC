import os
import json
import time
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks
from sklearn.utils.class_weight import compute_class_weight
import tf2onnx
import onnx
import onnxruntime as ort

PROJECT_ROOT = r"C:\Users\ztech.pk\Downloads\CommuniCare-AAC-main\CommuniCare-AAC-main"
DATA_DIR = os.path.join(PROJECT_ROOT, "training", "data")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "public", "models", "communicare-aac-sign-v3-candidate")
REPORT_DIR = os.path.join(PROJECT_ROOT, "training", "v3", "reports")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

FROZEN_CLASSES = [
    "water", "help", "hungry", "need", "want", "hello", "thankyou", "NO_SIGN"
]
CLASS_TO_IDX = {c: i for i, c in enumerate(FROZEN_CLASSES)}

DATA_FILES = [
    "communicare-psl-dataset-signer-01.json",
    "communicare-psl-dataset-signer-02.json",
    "communicare-psl-dataset-signer-01-phase2j.json",
    "communicare-psl-dataset-signer-02-phase2j.json",
    "communicare-psl-dataset-signer-03-phase2j.json",
    "communicare-psl-dataset-signer-04-phase2j.json",
    "communicare-psl-dataset-signer-05-phase2j.json"
]

def load_all_samples():
    samples = []
    for fname in DATA_FILES:
        fpath = os.path.join(DATA_DIR, fname)
        if not os.path.exists(fpath):
            continue
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            seqs = data.get("sequences", data)
            samples.extend(seqs)
    print(f"Loaded {len(samples)} total samples from {len(DATA_FILES)} files.")
    return samples

def compute_pos_vel_24(window_24):
    """
    window_24: (24, 126)
    Returns: (24, 252) where features 0..125 are positions and 126..251 are velocities (dx/dt within window)
    """
    pos = window_24
    vel = np.zeros_like(pos)
    vel[1:] = pos[1:] - pos[:-1]
    return np.concatenate([pos, vel], axis=-1)

def extract_multi_windows(seq_60, offsets=(0, 6, 12, 18, 24, 30, 36)):
    windows = []
    arr = np.array(seq_60, dtype=np.float32)
    for off in offsets:
        if off + 24 <= len(arr):
            win_24 = arr[off:off+24]
            windows.append(compute_pos_vel_24(win_24))
    return windows

def build_model(input_shape=(24, 252), num_classes=8):
    model = models.Sequential([
        layers.Input(shape=input_shape),
        layers.Conv1D(filters=64, kernel_size=3, padding='same', activation='relu'),
        layers.BatchNormalization(),
        layers.Dropout(0.2),
        layers.GRU(64, return_sequences=False),
        layers.BatchNormalization(),
        layers.Dropout(0.2),
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(num_classes, activation='softmax')
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model

def main():
    print("==================================================")
    print("PHASE 2J: TRAINING CANDIDATE COMMUNICARE-AAC-SIGN-V3")
    print("==================================================")

    samples = load_all_samples()

    # Build full training dataset using multi-windows
    X_train_list = []
    y_train_list = []
    sample_indices = []

    # Also keep single canonical test windows (offset 18) for validation/parity testing
    X_canonical_list = []
    y_canonical_list = []

    for i, s in enumerate(samples):
        label = s["label"]
        if label not in CLASS_TO_IDX:
            continue
        c_idx = CLASS_TO_IDX[label]
        frames = s["landmarks"]
        if len(frames) != 60:
            continue

        # Canonical window
        canon_win = np.array(frames[18:42], dtype=np.float32)
        X_canonical_list.append(compute_pos_vel_24(canon_win))
        y_canonical_list.append(c_idx)

        # Multi-window for robust training
        offsets = (0, 6, 12, 18, 24, 30, 36)
        wins = extract_multi_windows(frames, offsets=offsets)
        for w in wins:
            X_train_list.append(w)
            y_train_list.append(c_idx)
            sample_indices.append(i)

    X_train = np.array(X_train_list, dtype=np.float32)
    y_train = np.array(y_train_list, dtype=np.int32)
    X_canonical = np.array(X_canonical_list, dtype=np.float32)
    y_canonical = np.array(y_canonical_list, dtype=np.int32)

    print(f"Total training windows: {X_train.shape}")
    print(f"Total canonical sequences: {X_canonical.shape}")

    # Compute class weights
    classes = np.unique(y_train)
    weights = compute_class_weight(class_weight='balanced', classes=classes, y=y_train)
    class_weight_dict = {int(c): float(w) for c, w in zip(classes, weights)}
    print("Computed Class Weights:", {FROZEN_CLASSES[k]: round(v, 2) for k, v in class_weight_dict.items()})

    # Shuffle training data
    p = np.random.permutation(len(X_train))
    X_train = X_train[p]
    y_train = y_train[p]

    # Build and train model
    model = build_model()
    model.summary()

    lr_reduce = callbacks.ReduceLROnPlateau(monitor='loss', factor=0.5, patience=5, min_lr=1e-5, verbose=1)
    early_stop = callbacks.EarlyStopping(monitor='loss', patience=12, restore_best_weights=True, verbose=1)

    print("\n--- Training Stage 1: Full Pool ---")
    start_train_time = time.time()
    history = model.fit(
        X_train, y_train,
        epochs=40,
        batch_size=64,
        class_weight=class_weight_dict,
        callbacks=[lr_reduce, early_stop],
        verbose=1
    )
    stage1_duration = time.time() - start_train_time
    print(f"Stage 1 completed in {stage1_duration:.1f}s.")

    # Hard Negative Mining on Canonical Windows
    print("\n--- Hard Negative Mining ---")
    preds = model.predict(X_canonical, verbose=0)
    pred_classes = np.argmax(preds, axis=1)

    no_sign_idx = CLASS_TO_IDX["NO_SIGN"]
    hard_neg_indices = []
    confusion_counts = {}

    for i in range(len(y_canonical)):
        if y_canonical[i] == no_sign_idx and pred_classes[i] != no_sign_idx:
            hard_neg_indices.append(i)
            wrong_cls = FROZEN_CLASSES[pred_classes[i]]
            confusion_counts[wrong_cls] = confusion_counts.get(wrong_cls, 0) + 1

    print(f"Identified {len(hard_neg_indices)} hard negative canonical samples. Errors by predicted sign: {confusion_counts}")

    if hard_neg_indices:
        # Extract all multi-windows for these hard negatives
        hn_windows = []
        hn_labels = []
        for orig_idx in hard_neg_indices:
            s = samples[orig_idx]
            wins = extract_multi_windows(s["landmarks"], offsets=(0, 6, 12, 18, 24, 30, 36))
            for w in wins:
                hn_windows.append(w)
                hn_labels.append(no_sign_idx)

        X_hn = np.array(hn_windows, dtype=np.float32)
        y_hn = np.array(hn_labels, dtype=np.int32)
        print(f"Fine-tuning with {len(X_hn)} mined hard-negative sub-windows...")

        # Re-train on hard negatives with small learning rate
        model.optimizer.learning_rate.assign(1e-4)
        model.fit(
            X_hn, y_hn,
            epochs=10,
            batch_size=32,
            verbose=1
        )
        print("Hard negative fine-tuning complete.")

    # Validation & Evaluation on Canonical Windows
    print("\n--- Canonical Windows Evaluation ---")
    final_preds = model.predict(X_canonical, verbose=0)
    final_pred_classes = np.argmax(final_preds, axis=1)

    acc = np.mean(final_pred_classes == y_canonical)
    print(f"Final Model Canonical Window Accuracy: {acc*100:.2f}%")

    # Save Feature Schema
    schema_dict = {
        "modelName": "communicare-aac-sign-v3-candidate",
        "featureSchema": "wrist_normalized_v1_posvel",
        "streamingFrames": 24,
        "featuresPerFrame": 252,
        "positionsPerFrame": 126,
        "velocitiesPerFrame": 126,
        "leftHandSlot": "0-62",
        "rightHandSlot": "63-125",
        "leftHandVelSlot": "126-188",
        "rightHandVelSlot": "189-251",
        "inputDtype": "float32"
    }
    schema_path = os.path.join(OUTPUT_DIR, "feature-schema.json")
    with open(schema_path, 'w', encoding='utf-8') as f:
        json.dump(schema_dict, f, indent=2)
    print(f"Saved {schema_path}")

    # ONNX Export
    print("\n==================================================")
    print("PHASE: ONNX EXPORT")
    print("==================================================")
    onnx_target_path = os.path.join(OUTPUT_DIR, "model.onnx")
    input_signature = [tf.TensorSpec([1, 24, 252], tf.float32, name="input_frames")]

    onnx_model, _ = tf2onnx.convert.from_keras(
        model,
        input_signature=input_signature,
        opset=17
    )
    onnx.save(onnx_model, onnx_target_path)
    print(f"Exported ONNX model to: {onnx_target_path}")

    # Inspect ONNX
    model_size_bytes = os.path.getsize(onnx_target_path)
    model_size_kb = model_size_bytes / 1024.0
    loaded_onnx = onnx.load(onnx_target_path)
    opset_version = loaded_onnx.opset_import[0].version
    graph = loaded_onnx.graph
    input_tensor = graph.input[0]
    output_tensor = graph.output[0]
    op_types = sorted(list({node.op_type for node in graph.node}))

    print(f"ONNX Model File Size: {model_size_kb:.2f} KB ({model_size_bytes} bytes)")
    print(f"Opset: {opset_version}")
    print(f"Input Name: {input_tensor.name}, Shape: {[d.dim_value for d in input_tensor.type.tensor_type.shape.dim]}")
    print(f"Output Name: {output_tensor.name}, Shape: {[d.dim_value for d in output_tensor.type.tensor_type.shape.dim]}")
    print(f"Operators: {', '.join(op_types)}")

    # Model Metadata
    metadata_dict = {
        "modelName": "communicare-aac-sign-v3-candidate",
        "version": "3.0.0-candidate",
        "architecture": "Conv1D_GRU_PosVel",
        "classes": FROZEN_CLASSES,
        "classCount": len(FROZEN_CLASSES),
        "sequenceLength": 24,
        "featuresPerFrame": 252,
        "featureSchema": "wrist_normalized_v1_posvel",
        "inputShape": [1, 24, 252],
        "outputShape": [1, 8],
        "trainingSignerCount": 5,
        "totalSamples": len(samples),
        "totalWindowsTrained": len(X_train),
        "onnxOpset": opset_version,
        "inputName": input_tensor.name,
        "outputName": output_tensor.name,
        "operatorTypes": op_types,
        "modelSizeBytes": model_size_bytes,
        "modelSizeKb": round(model_size_kb, 2),
        "rejectionThreshold": 0.70,
        "acceptanceMargin": 0.05,
        "requiredConsecutive": 2
    }
    meta_path = os.path.join(OUTPUT_DIR, "model_metadata.json")
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata_dict, f, indent=2)
    print(f"Saved {meta_path}")

    # ONNX Parity Test
    print("\n==================================================")
    print("PHASE: ONNX PARITY & LATENCY BENCHMARK")
    print("==================================================")
    session = ort.InferenceSession(onnx_target_path)
    n_parity_samples = len(X_canonical)
    top1_agreements = 0
    max_abs_diff = 0.0
    sum_abs_diff = 0.0
    total_probs_compared = 0

    # Latency benchmarking
    onnx_latencies = []

    for i in range(n_parity_samples):
        sample_x = X_canonical[i:i+1] # (1, 24, 252)

        # Keras prediction
        keras_prob = model.predict(sample_x, verbose=0)[0]

        # ONNX prediction
        t0 = time.perf_counter()
        ort_inputs = {input_tensor.name: sample_x}
        ort_prob = session.run([output_tensor.name], ort_inputs)[0][0]
        t1 = time.perf_counter()
        onnx_latencies.append((t1 - t0) * 1000.0) # ms

        k_top = int(np.argmax(keras_prob))
        o_top = int(np.argmax(ort_prob))
        if k_top == o_top:
            top1_agreements += 1

        diffs = np.abs(keras_prob - ort_prob)
        max_abs_diff = max(max_abs_diff, float(np.max(diffs)))
        sum_abs_diff += float(np.sum(diffs))
        total_probs_compared += len(diffs)

    top1_agreement_pct = (top1_agreements / n_parity_samples) * 100.0
    mean_abs_diff = sum_abs_diff / max(total_probs_compared, 1)
    mean_latency = float(np.mean(onnx_latencies))
    p95_latency = float(np.percentile(onnx_latencies, 95))

    print(f"Parity Sample Count:                {n_parity_samples}")
    print(f"Top-1 Agreement Count:              {top1_agreements} / {n_parity_samples}")
    print(f"Top-1 Agreement Percentage:         {top1_agreement_pct:.2f}%")
    print(f"Maximum Absolute Probability Diff:  {max_abs_diff:.8e}")
    print(f"Mean Absolute Probability Diff:     {mean_abs_diff:.8e}")
    print(f"Mean Inference Latency:             {mean_latency:.2f} ms")
    print(f"95th Percentile Latency:            {p95_latency:.2f} ms")

    parity_report = {
        "status": "PASSED" if (top1_agreement_pct >= 99.0 and max_abs_diff < 1e-4) else "FAILED",
        "parity_sample_count": n_parity_samples,
        "top1_agreement_count": top1_agreements,
        "top1_agreement_percentage": top1_agreement_pct,
        "max_absolute_probability_difference": max_abs_diff,
        "mean_absolute_probability_difference": mean_abs_diff,
        "mean_inference_latency_ms": mean_latency,
        "p95_inference_latency_ms": p95_latency
    }
    parity_path = os.path.join(REPORT_DIR, "onnx_parity_report.json")
    with open(parity_path, 'w', encoding='utf-8') as f:
        json.dump(parity_report, f, indent=2)
    print(f"Saved parity report to {parity_path}")

if __name__ == "__main__":
    main()
