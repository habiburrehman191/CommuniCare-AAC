import os
import random
import json
import numpy as np

# Set deterministic seeds before importing heavy libraries
SEED = 42
random.seed(SEED)
os.environ['PYTHONHASHSEED'] = str(SEED)
os.environ['TF_DETERMINISTIC_OPS'] = '1'
np.random.seed(SEED)

import tensorflow as tf
tf.random.set_seed(SEED)

import keras
from keras import layers, models, callbacks
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    classification_report
)
import matplotlib.pyplot as plt

from data_loader import (
    load_all_dataset_samples,
    get_signer_split,
    stratified_train_val_split,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL
)

REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
OUTPUTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "outputs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

def build_gru_model(input_shape=(60, 126), num_classes=8):
    inputs = keras.Input(shape=input_shape, name="input_frames")
    x = layers.GRU(64, dropout=0.2, recurrent_dropout=0.0, name="gru_layer")(inputs)
    x = layers.Dense(32, activation="relu", name="dense_intermediate")(x)
    x = layers.Dropout(0.2, name="dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
    model = keras.Model(inputs=inputs, outputs=outputs, name="CommuniCare_GRU")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def build_lstm_model(input_shape=(60, 126), num_classes=8):
    inputs = keras.Input(shape=input_shape, name="input_frames")
    x = layers.LSTM(64, dropout=0.2, recurrent_dropout=0.0, name="lstm_layer")(inputs)
    x = layers.Dense(32, activation="relu", name="dense_intermediate")(x)
    x = layers.Dropout(0.2, name="dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
    model = keras.Model(inputs=inputs, outputs=outputs, name="CommuniCare_LSTM")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

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

def plot_history(history, title, output_path):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    
    # Loss
    ax1.plot(history.history['loss'], label='Train Loss')
    ax1.plot(history.history['val_loss'], label='Val Loss')
    ax1.set_title(f"{title} - Loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.legend()
    ax1.grid(True, linestyle='--', alpha=0.5)

    # Accuracy
    ax1_acc = history.history.get('accuracy', [])
    ax1_val_acc = history.history.get('val_accuracy', [])
    ax2.plot(ax1_acc, label='Train Acc')
    ax2.plot(ax1_val_acc, label='Val Acc')
    ax2.set_title(f"{title} - Accuracy")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy")
    ax2.legend()
    ax2.grid(True, linestyle='--', alpha=0.5)

    fig.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()

def evaluate_predictions(y_true, y_pred, y_prob, history, train_acc, best_val_acc, run_name, model_type):
    test_acc = float(accuracy_score(y_true, y_pred))
    
    precision_macro, recall_macro, f1_macro, _ = precision_recall_fscore_support(
        y_true, y_pred, average='macro', zero_division=0
    )
    precision_weighted, recall_weighted, f1_weighted, _ = precision_recall_fscore_support(
        y_true, y_pred, average='weighted', zero_division=0
    )
    
    per_class_p, per_class_r, per_class_f1, per_class_supp = precision_recall_fscore_support(
        y_true, y_pred, average=None, zero_division=0
    )
    
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(FROZEN_CLASSES))))
    
    # NO_SIGN safety metrics
    # NO_SIGN index is 7
    no_sign_idx = LABEL_TO_ID["NO_SIGN"]
    no_sign_p = float(per_class_p[no_sign_idx])
    no_sign_r = float(per_class_r[no_sign_idx])
    no_sign_f1 = float(per_class_f1[no_sign_idx])
    no_sign_support = int(per_class_supp[no_sign_idx])
    
    # False sign activations: true NO_SIGN predicted as sign (class 0..6)
    true_no_sign_indices = np.where(y_true == no_sign_idx)[0]
    false_sign_activations = int(np.sum(y_pred[true_no_sign_indices] != no_sign_idx))
    false_sign_activation_rate = float(false_sign_activations / max(len(true_no_sign_indices), 1))
    
    no_sign_confusions = {}
    for idx in true_no_sign_indices:
        pred_label_id = y_pred[idx]
        if pred_label_id != no_sign_idx:
            pred_label = ID_TO_LABEL[pred_label_id]
            no_sign_confusions[pred_label] = no_sign_confusions.get(pred_label, 0) + 1
            
    # Real sign rejection: true sign (0..6) predicted as NO_SIGN (7)
    true_sign_indices = np.where(y_true != no_sign_idx)[0]
    real_sign_rejected_count = int(np.sum(y_pred[true_sign_indices] == no_sign_idx))
    real_sign_rejection_rate = float(real_sign_rejected_count / max(len(true_sign_indices), 1))
    
    real_sign_rejection_breakdown = {}
    for idx in true_sign_indices:
        if y_pred[idx] == no_sign_idx:
            true_label = ID_TO_LABEL[y_true[idx]]
            real_sign_rejection_breakdown[true_label] = real_sign_rejection_breakdown.get(true_label, 0) + 1
            
    per_class_metrics = {}
    for idx, cls in enumerate(FROZEN_CLASSES):
        per_class_metrics[cls] = {
            "precision": float(per_class_p[idx]),
            "recall": float(per_class_r[idx]),
            "f1": float(per_class_f1[idx]),
            "support": int(per_class_supp[idx])
        }
        
    metrics = {
        "run_name": run_name,
        "model_type": model_type,
        "training_accuracy": float(train_acc),
        "best_validation_accuracy": float(best_val_acc),
        "test_accuracy": test_acc,
        "macro_precision": float(precision_macro),
        "macro_recall": float(recall_macro),
        "macro_f1": float(f1_macro),
        "weighted_f1": float(f1_weighted),
        "per_class_metrics": per_class_metrics,
        "no_sign_safety": {
            "precision": no_sign_p,
            "recall": no_sign_r,
            "f1": no_sign_f1,
            "support": no_sign_support,
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
    }
    
    return metrics, cm

def train_and_eval_run(
    train_signer,
    test_signer,
    run_id,
    model_type,
    X_train_full,
    y_train_full,
    X_test,
    y_test
):
    print(f"\n=======================================================")
    print(f"STARTING {model_type} RUN {run_id}: Train on {train_signer}, Test on {test_signer}")
    print(f"=======================================================")
    
    # Deterministic sequence split within training signer
    (X_tr, y_tr), (X_val, y_val), tr_idx, val_idx = stratified_train_val_split(
        X_train_full, y_train_full, val_ratio=0.2, random_state=SEED
    )
    print(f"Train split: {len(X_tr)} samples, Val split: {len(X_val)} samples, Test split: {len(X_test)} samples")
    
    # Model instantiation
    if model_type == "GRU":
        model = build_gru_model()
    elif model_type == "LSTM":
        model = build_lstm_model()
    else:
        raise ValueError(f"Unknown model_type: {model_type}")
        
    cb_early = callbacks.EarlyStopping(
        monitor="val_loss",
        patience=12,
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
        epochs=60,
        batch_size=16,
        callbacks=[cb_early, cb_lr],
        verbose=1
    )
    
    train_acc = float(history.history['accuracy'][-1])
    best_val_acc = float(max(history.history['val_accuracy']))
    
    # Evaluate on held-out test signer
    y_prob = model.predict(X_test, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)
    
    run_name = f"run_{run_id.lower()}_{model_type.lower()}"
    metrics, cm = evaluate_predictions(
        y_test, y_pred, y_prob, history, train_acc, best_val_acc, run_name, model_type
    )
    
    # Save artifacts
    cm_png_path = os.path.join(REPORTS_DIR, f"confusion_matrix_{run_name}.png")
    plot_confusion_matrix(cm, FROZEN_CLASSES, f"{model_type} Run {run_id} ({train_signer} -> {test_signer})", cm_png_path)
    
    hist_png_path = os.path.join(REPORTS_DIR, f"history_{run_name}.png")
    plot_history(history, f"{model_type} Run {run_id}", hist_png_path)
    
    metrics_json_path = os.path.join(REPORTS_DIR, f"{run_name}.json")
    with open(metrics_json_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=2)
        
    print(f"\n{model_type} Run {run_id} Results:")
    print(f"  Training Accuracy:     {train_acc:.4f}")
    print(f"  Best Val Accuracy:     {best_val_acc:.4f}")
    print(f"  Held-Out Test Acc:     {metrics['test_accuracy']:.4f}")
    print(f"  Macro F1:              {metrics['macro_f1']:.4f}")
    print(f"  Weighted F1:           {metrics['weighted_f1']:.4f}")
    print(f"  NO_SIGN Recall:        {metrics['no_sign_safety']['recall']:.4f}")
    print(f"  NO_SIGN False Sign Act:{metrics['no_sign_safety']['false_sign_activations']} (rate: {metrics['no_sign_safety']['false_sign_activation_rate']:.4f})")
    
    return metrics, model

def main():
    print("Loading datasets...")
    X, y, signers, labels, records = load_all_dataset_samples()
    print(f"Total loaded: {len(X)} samples.")
    
    X_s1, y_s1, _, _ = get_signer_split(X, y, signers, labels, "signer-01")
    X_s2, y_s2, _, _ = get_signer_split(X, y, signers, labels, "signer-02")
    
    print(f"signer-01: {len(X_s1)} samples")
    print(f"signer-02: {len(X_s2)} samples")
    
    experiments = {}
    
    # 1. GRU Run A (Train signer-01, Test signer-02)
    m_gru_a, _ = train_and_eval_run("signer-01", "signer-02", "A", "GRU", X_s1, y_s1, X_s2, y_s2)
    experiments["gru_run_a"] = m_gru_a
    
    # 2. GRU Run B (Train signer-02, Test signer-01)
    m_gru_b, _ = train_and_eval_run("signer-02", "signer-01", "B", "GRU", X_s2, y_s2, X_s1, y_s1)
    experiments["gru_run_b"] = m_gru_b
    
    # 3. LSTM Run A (Train signer-01, Test signer-02)
    m_lstm_a, _ = train_and_eval_run("signer-01", "signer-02", "A", "LSTM", X_s1, y_s1, X_s2, y_s2)
    experiments["lstm_run_a"] = m_lstm_a
    
    # 4. LSTM Run B (Train signer-02, Test signer-01)
    m_lstm_b, _ = train_and_eval_run("signer-02", "signer-01", "B", "LSTM", X_s2, y_s2, X_s1, y_s1)
    experiments["lstm_run_b"] = m_lstm_b
    
    # Model Comparison
    comparison = {
        "GRU": {
            "run_a_test_acc": m_gru_a["test_accuracy"],
            "run_a_macro_f1": m_gru_a["macro_f1"],
            "run_a_no_sign_recall": m_gru_a["no_sign_safety"]["recall"],
            "run_a_false_sign_rate": m_gru_a["no_sign_safety"]["false_sign_activation_rate"],
            "run_b_test_acc": m_gru_b["test_accuracy"],
            "run_b_macro_f1": m_gru_b["macro_f1"],
            "run_b_no_sign_recall": m_gru_b["no_sign_safety"]["recall"],
            "run_b_false_sign_rate": m_gru_b["no_sign_safety"]["false_sign_activation_rate"],
            "mean_test_acc": (m_gru_a["test_accuracy"] + m_gru_b["test_accuracy"]) / 2.0,
            "mean_macro_f1": (m_gru_a["macro_f1"] + m_gru_b["macro_f1"]) / 2.0,
            "acc_diff": abs(m_gru_a["test_accuracy"] - m_gru_b["test_accuracy"]),
            "f1_diff": abs(m_gru_a["macro_f1"] - m_gru_b["macro_f1"]),
        },
        "LSTM": {
            "run_a_test_acc": m_lstm_a["test_accuracy"],
            "run_a_macro_f1": m_lstm_a["macro_f1"],
            "run_a_no_sign_recall": m_lstm_a["no_sign_safety"]["recall"],
            "run_a_false_sign_rate": m_lstm_a["no_sign_safety"]["false_sign_activation_rate"],
            "run_b_test_acc": m_lstm_b["test_accuracy"],
            "run_b_macro_f1": m_lstm_b["macro_f1"],
            "run_b_no_sign_recall": m_lstm_b["no_sign_safety"]["recall"],
            "run_b_false_sign_rate": m_lstm_b["no_sign_safety"]["false_sign_activation_rate"],
            "mean_test_acc": (m_lstm_a["test_accuracy"] + m_lstm_b["test_accuracy"]) / 2.0,
            "mean_macro_f1": (m_lstm_a["macro_f1"] + m_lstm_b["macro_f1"]) / 2.0,
            "acc_diff": abs(m_lstm_a["test_accuracy"] - m_lstm_b["test_accuracy"]),
            "f1_diff": abs(m_lstm_a["macro_f1"] - m_lstm_b["macro_f1"]),
        }
    }
    
    comp_json_path = os.path.join(REPORTS_DIR, "model-comparison.json")
    with open(comp_json_path, 'w', encoding='utf-8') as f:
        json.dump(comparison, f, indent=2)
        
    print("\n=======================================================")
    print("MODEL COMPARISON SUMMARY")
    print("=======================================================")
    print(f"GRU  - Run A Acc: {comparison['GRU']['run_a_test_acc']:.4f}, Run B Acc: {comparison['GRU']['run_b_test_acc']:.4f}, Mean: {comparison['GRU']['mean_test_acc']:.4f}, Mean F1: {comparison['GRU']['mean_macro_f1']:.4f}, Diff: {comparison['GRU']['acc_diff']:.4f}")
    print(f"LSTM - Run A Acc: {comparison['LSTM']['run_a_test_acc']:.4f}, Run B Acc: {comparison['LSTM']['run_b_test_acc']:.4f}, Mean: {comparison['LSTM']['mean_test_acc']:.4f}, Mean F1: {comparison['LSTM']['mean_macro_f1']:.4f}, Diff: {comparison['LSTM']['acc_diff']:.4f}")
    
    # Save markdown summary
    md_content = f"""# Model Selection Report

## 1. Research Overview
- **Run A**: Trained on signer-01 (243 samples), Tested on held-out signer-02 (240 samples).
- **Run B**: Trained on signer-02 (240 samples), Tested on held-out signer-01 (243 samples).

## 2. Quantitative Summary

| Architecture | Run A Test Acc | Run A Macro F1 | Run B Test Acc | Run B Macro F1 | Mean Test Acc | Mean Macro F1 | Acc Difference |
|---|---|---|---|---|---|---|---|
| **GRU** | {comparison['GRU']['run_a_test_acc']:.4f} | {comparison['GRU']['run_a_macro_f1']:.4f} | {comparison['GRU']['run_b_test_acc']:.4f} | {comparison['GRU']['run_b_macro_f1']:.4f} | {comparison['GRU']['mean_test_acc']:.4f} | {comparison['GRU']['mean_macro_f1']:.4f} | {comparison['GRU']['acc_diff']:.4f} |
| **LSTM** | {comparison['LSTM']['run_a_test_acc']:.4f} | {comparison['LSTM']['run_a_macro_f1']:.4f} | {comparison['LSTM']['run_b_test_acc']:.4f} | {comparison['LSTM']['run_b_macro_f1']:.4f} | {comparison['LSTM']['mean_test_acc']:.4f} | {comparison['LSTM']['mean_macro_f1']:.4f} | {comparison['LSTM']['acc_diff']:.4f} |

## 3. NO_SIGN Safety Metrics

| Architecture | Run A NO_SIGN Recall | Run A False Act Rate | Run B NO_SIGN Recall | Run B False Act Rate |
|---|---|---|---|---|
| **GRU** | {comparison['GRU']['run_a_no_sign_recall']:.4f} | {comparison['GRU']['run_a_false_sign_rate']:.4f} | {comparison['GRU']['run_b_no_sign_recall']:.4f} | {comparison['GRU']['run_b_false_sign_rate']:.4f} |
| **LSTM** | {comparison['LSTM']['run_a_no_sign_recall']:.4f} | {comparison['LSTM']['run_a_false_sign_rate']:.4f} | {comparison['LSTM']['run_b_no_sign_recall']:.4f} | {comparison['LSTM']['run_b_false_sign_rate']:.4f} |
"""
    with open(os.path.join(REPORTS_DIR, "selection-report.md"), 'w', encoding='utf-8') as f:
        f.write(md_content)

if __name__ == "__main__":
    main()
