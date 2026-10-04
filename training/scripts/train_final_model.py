import os
import random
import json
import datetime
import numpy as np

SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

import keras
from keras import layers, models, callbacks
import tf2onnx
import onnx
import onnxruntime as ort
import matplotlib.pyplot as plt

from data_loader import (
    load_all_dataset_samples,
    stratified_train_val_split,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DEPLOY_DIR = os.path.join(WORKSPACE_ROOT, "public", "models", "communicare-aac-sign-v1")
REPORTS_DIR = os.path.join(WORKSPACE_ROOT, "training", "reports")
OUTPUTS_DIR = os.path.join(WORKSPACE_ROOT, "training", "outputs")

os.makedirs(DEPLOY_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

def build_final_gru_model(input_shape=(60, 126), num_classes=8):
    inputs = keras.Input(shape=input_shape, name="input_frames")
    x = layers.GRU(64, dropout=0.2, recurrent_dropout=0.0, name="gru_layer")(inputs)
    x = layers.Dense(32, activation="relu", name="dense_intermediate")(x)
    x = layers.Dropout(0.2, name="dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
    model = keras.Model(inputs=inputs, outputs=outputs, name="Communicare_AAC_Sign_V1_GRU")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def main():
    print("==================================================")
    print("PHASE 9: FINAL PRODUCTION TRAINING (2 SIGNERS COMBINED)")
    print("==================================================")
    
    X, y, signers, labels, records = load_all_dataset_samples()
    total_samples = len(X)
    print(f"Total verified samples: {total_samples}")
    print(f"Signers: {set(signers)}")
    
    (X_tr, y_tr), (X_val, y_val), tr_idx, val_idx = stratified_train_val_split(
        X, y, val_ratio=0.2, random_state=SEED
    )
    print(f"Train split: {len(X_tr)} samples, Val split: {len(X_val)} samples")
    
    model = build_final_gru_model()
    model.summary()
    
    cb_early = callbacks.EarlyStopping(
        monitor="val_loss",
        patience=15,
        restore_best_weights=True,
        verbose=1
    )
    cb_lr = callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=5,
        min_lr=1e-5,
        verbose=1
    )
    
    history = model.fit(
        X_tr, y_tr,
        validation_data=(X_val, y_val),
        epochs=70,
        batch_size=16,
        callbacks=[cb_early, cb_lr],
        verbose=1
    )
    
    final_train_acc = float(history.history['accuracy'][-1])
    best_val_acc = float(max(history.history['val_accuracy']))
    val_loss = float(min(history.history['val_loss']))
    
    # Save training history
    hist_dict = {k: [float(v) for v in vals] for k, vals in history.history.items()}
    hist_json_path = os.path.join(REPORTS_DIR, "final-training-history.json")
    with open(hist_json_path, 'w', encoding='utf-8') as f:
        json.dump(hist_dict, f, indent=2)
        
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    ax1.plot(history.history['loss'], label='Train Loss')
    ax1.plot(history.history['val_loss'], label='Val Loss')
    ax1.set_title("Final GRU Production Model - Loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.legend()
    ax1.grid(True, linestyle='--', alpha=0.5)

    ax2.plot(history.history['accuracy'], label='Train Acc')
    ax2.plot(history.history['val_accuracy'], label='Val Acc')
    ax2.set_title("Final GRU Production Model - Accuracy")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy")
    ax2.legend()
    ax2.grid(True, linestyle='--', alpha=0.5)

    plt.tight_layout()
    hist_png_path = os.path.join(REPORTS_DIR, "final-training-history.png")
    plt.savefig(hist_png_path, dpi=150)
    plt.close()
    
    # Save Keras model in training/outputs/
    keras_path = os.path.join(OUTPUTS_DIR, "communicare_aac_sign_v1_gru.keras")
    model.save(keras_path)
    print(f"Saved native Keras model to: {keras_path}")
    
    # Validation evaluation
    val_prob = model.predict(X_val, verbose=0)
    val_pred = np.argmax(val_prob, axis=1)
    val_acc = float(np.mean(val_pred == y_val))
    print(f"Final Model Validation Accuracy (restored best weights): {val_acc:.4f}")
    
    print("\n==================================================")
    print("PHASE 10: DEPLOYMENT METADATA")
    print("==================================================")
    # 1. labels.json
    labels_path = os.path.join(DEPLOY_DIR, "labels.json")
    with open(labels_path, 'w', encoding='utf-8') as f:
        json.dump(FROZEN_CLASSES, f, indent=2)
    print(f"Saved {labels_path}")
    
    # 2. feature-schema.json
    schema_dict = {
        "schemaName": "wrist_normalized_v1",
        "sequenceLength": 60,
        "featuresPerFrame": 126,
        "leftHandSlot": "0-62",
        "rightHandSlot": "63-125",
        "missingHand": "zeros",
        "inputDtype": "float32"
    }
    schema_path = os.path.join(DEPLOY_DIR, "feature-schema.json")
    with open(schema_path, 'w', encoding='utf-8') as f:
        json.dump(schema_dict, f, indent=2)
    print(f"Saved {schema_path}")
    
    print("\n==================================================")
    print("PHASE 11: ONNX EXPORT")
    print("==================================================")
    onnx_target_path = os.path.join(DEPLOY_DIR, "model.onnx")
    input_signature = [tf.TensorSpec([1, 60, 126], tf.float32, name="input_frames")]
    
    # Convert model using tf2onnx
    onnx_model, _ = tf2onnx.convert.from_keras(
        model,
        input_signature=input_signature,
        opset=17
    )
    onnx.save(onnx_model, onnx_target_path)
    print(f"Exported ONNX model to: {onnx_target_path}")
    
    print("\n==================================================")
    print("PHASE 12: ONNX MODEL INSPECTION")
    print("==================================================")
    model_size_bytes = os.path.getsize(onnx_target_path)
    model_size_kb = model_size_bytes / 1024.0
    
    loaded_onnx = onnx.load(onnx_target_path)
    opset_version = loaded_onnx.opset_import[0].version
    
    # Inputs and outputs
    graph = loaded_onnx.graph
    input_tensor = graph.input[0]
    input_name = input_tensor.name
    input_type_code = input_tensor.type.tensor_type.elem_type
    input_dtype = onnx.TensorProto.DataType.Name(input_type_code)
    input_shape = [d.dim_value for d in input_tensor.type.tensor_type.shape.dim]
    
    output_tensor = graph.output[0]
    output_name = output_tensor.name
    output_type_code = output_tensor.type.tensor_type.elem_type
    output_dtype = onnx.TensorProto.DataType.Name(output_type_code)
    output_shape = [d.dim_value for d in output_tensor.type.tensor_type.shape.dim]
    
    op_types = sorted(list({node.op_type for node in graph.node}))
    
    print(f"ONNX Model File Size:    {model_size_kb:.2f} KB ({model_size_bytes} bytes)")
    print(f"ONNX Opset Version:      {opset_version}")
    print(f"Input Tensor Name:       {input_name}")
    print(f"Input Dtype:             {input_dtype}")
    print(f"Input Shape:             {input_shape}")
    print(f"Output Tensor Name:      {output_name}")
    print(f"Output Dtype:            {output_dtype}")
    print(f"Output Shape:            {output_shape}")
    print(f"Operator Types Used:     {', '.join(op_types)}")
    
    # Save model-metadata.json
    metadata_dict = {
        "modelName": "communicare-aac-sign-v1",
        "version": "1.0.0",
        "architecture": "GRU",
        "classes": FROZEN_CLASSES,
        "classCount": len(FROZEN_CLASSES),
        "sequenceLength": 60,
        "featuresPerFrame": 126,
        "featureSchema": "wrist_normalized_v1",
        "inputShape": input_shape,
        "outputShape": output_shape,
        "trainingSignerCount": 2,
        "trainingSampleCount": total_samples,
        "evaluationMethod": "Leave-One-Signer-Out prototype evaluation across signer-01 and signer-02",
        "selectedArchitectureReason": "GRU achieved superior cross-signer macro F1 (0.5228 vs 0.4772) and cross-signer test accuracy (55.53% vs 51.78%) compared to LSTM, with a compact ~155 KB browser footprint and low parameter count (38,888).",
        "onnxOpset": opset_version,
        "inputName": input_name,
        "outputName": output_name,
        "operatorTypes": op_types,
        "modelSizeBytes": model_size_bytes,
        "modelSizeKb": round(model_size_kb, 2),
        "trainingDate": datetime.date.today().isoformat(),
        "trainingValidationAccuracy": round(val_acc, 4)
    }
    meta_path = os.path.join(DEPLOY_DIR, "model-metadata.json")
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata_dict, f, indent=2)
    print(f"Saved {meta_path}")
    
    print("\n==================================================")
    print("PHASE 13: ONNX PARITY VERIFICATION")
    print("==================================================")
    session = ort.InferenceSession(onnx_target_path)
    
    # Test parity on all 483 samples
    n_parity_samples = len(X)
    top1_agreements = 0
    max_abs_diff = 0.0
    sum_abs_diff = 0.0
    total_probs_compared = 0
    
    per_class_sample_counts = {cls: 0 for cls in FROZEN_CLASSES}
    
    for i in range(n_parity_samples):
        sample_x = X[i:i+1] # shape (1, 60, 126)
        label_str = labels[i]
        per_class_sample_counts[label_str] += 1
        
        # Keras prediction
        keras_prob = model.predict(sample_x, verbose=0)[0] # shape (8,)
        
        # ONNX prediction
        ort_inputs = {input_name: sample_x}
        ort_prob = session.run([output_name], ort_inputs)[0][0] # shape (8,)
        
        keras_top1 = int(np.argmax(keras_prob))
        ort_top1 = int(np.argmax(ort_prob))
        
        if keras_top1 == ort_top1:
            top1_agreements += 1
            
        diffs = np.abs(keras_prob - ort_prob)
        sample_max_diff = float(np.max(diffs))
        if sample_max_diff > max_abs_diff:
            max_abs_diff = sample_max_diff
            
        sum_abs_diff += float(np.sum(diffs))
        total_probs_compared += len(diffs)
        
    top1_agreement_pct = (top1_agreements / n_parity_samples) * 100.0
    mean_abs_diff = sum_abs_diff / max(total_probs_compared, 1)
    
    print(f"Parity Sample Count:                {n_parity_samples}")
    print(f"Top-1 Agreement Count:              {top1_agreements} / {n_parity_samples}")
    print(f"Top-1 Agreement Percentage:         {top1_agreement_pct:.2f}%")
    print(f"Maximum Absolute Probability Diff:  {max_abs_diff:.8e}")
    print(f"Mean Absolute Probability Diff:     {mean_abs_diff:.8e}")
    print(f"Per-Class Sample Representation:    {per_class_sample_counts}")
    
    parity_report = {
        "status": "PASSED" if (top1_agreement_pct >= 99.0 and max_abs_diff < 1e-4) else "FAILED",
        "parity_sample_count": n_parity_samples,
        "top1_agreement_count": top1_agreements,
        "top1_agreement_percentage": top1_agreement_pct,
        "max_absolute_probability_difference": max_abs_diff,
        "mean_absolute_probability_difference": mean_abs_diff,
        "per_class_sample_representation": per_class_sample_counts
    }
    parity_path = os.path.join(REPORTS_DIR, "onnx-parity-report.json")
    with open(parity_path, 'w', encoding='utf-8') as f:
        json.dump(parity_report, f, indent=2)
    print(f"Saved {parity_path}")

if __name__ == "__main__":
    main()
