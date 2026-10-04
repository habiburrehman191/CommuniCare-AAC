import os
import json
import glob
import numpy as np
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

from data_pipeline_v2 import FROZEN_CLASSES, LABEL_TO_ID, ID_TO_LABEL, load_original_dataset, create_loso_splits

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")
OUTPUTS_DIR = os.path.join(TRAINING_DIR, "v2", "outputs")

NO_SIGN_IDX = LABEL_TO_ID["NO_SIGN"]

def evaluate_metrics(y_true, y_pred):
    acc = float(accuracy_score(y_true, y_pred))
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(y_true, y_pred, average='macro', zero_division=0)
    per_class_p, per_class_r, per_class_f1, _ = precision_recall_fscore_support(y_true, y_pred, average=None, zero_division=0)

    # NO_SIGN false sign activation: true NO_SIGN predicted as sign (0..6)
    true_no_sign_idx = np.where(y_true == NO_SIGN_IDX)[0]
    false_activations = int(np.sum(y_pred[true_no_sign_idx] != NO_SIGN_IDX))
    false_act_rate = float(false_activations / max(len(true_no_sign_idx), 1))

    # Real sign rejection: true sign (0..6) predicted as NO_SIGN (7)
    true_sign_idx = np.where(y_true != NO_SIGN_IDX)[0]
    real_sign_rejected = int(np.sum(y_pred[true_sign_idx] == NO_SIGN_IDX))
    real_sign_rejection_rate = float(real_sign_rejected / max(len(true_sign_idx), 1))

    # Real signs recall average
    real_sign_recalls = [float(per_class_r[i]) for i in range(len(FROZEN_CLASSES)) if i != NO_SIGN_IDX]
    mean_real_sign_recall = float(np.mean(real_sign_recalls))
    min_real_sign_recall = float(np.min(real_sign_recalls))

    return {
        "accuracy": acc,
        "macro_f1": float(f1_macro),
        "no_sign_recall": float(per_class_r[NO_SIGN_IDX]),
        "false_sign_activation_rate": false_act_rate,
        "real_sign_rejection_rate": real_sign_rejection_rate,
        "mean_real_sign_recall": mean_real_sign_recall,
        "min_real_sign_recall": min_real_sign_recall,
        "per_class_recall": {cls: float(per_class_r[i]) for i, cls in enumerate(FROZEN_CLASSES)}
    }

def apply_global_threshold(probs, threshold):
    preds = np.argmax(probs, axis=1)
    max_p = np.max(probs, axis=1)
    # If confidence < threshold, revert to NO_SIGN
    gated_preds = np.where(max_p < threshold, NO_SIGN_IDX, preds)
    return gated_preds

def apply_margin_gating(probs, margin):
    sorted_probs = np.sort(probs, axis=1)[:, ::-1]
    top1 = sorted_probs[:, 0]
    top2 = sorted_probs[:, 1]
    preds = np.argmax(probs, axis=1)
    diff = top1 - top2
    gated_preds = np.where(diff < margin, NO_SIGN_IDX, preds)
    return gated_preds

def apply_combined_threshold_margin(probs, threshold, margin):
    sorted_probs = np.sort(probs, axis=1)[:, ::-1]
    top1 = sorted_probs[:, 0]
    top2 = sorted_probs[:, 1]
    preds = np.argmax(probs, axis=1)
    diff = top1 - top2
    is_confident = (top1 >= threshold) & (diff >= margin)
    gated_preds = np.where(~is_confident, NO_SIGN_IDX, preds)
    return gated_preds

def apply_class_specific_thresholds(probs, class_thresholds):
    preds = np.argmax(probs, axis=1)
    max_p = np.max(probs, axis=1)
    gated_preds = np.copy(preds)
    for i in range(len(preds)):
        p_cls = preds[i]
        if p_cls != NO_SIGN_IDX:
            th = class_thresholds.get(p_cls, 0.70)
            if max_p[i] < th:
                gated_preds[i] = NO_SIGN_IDX
    return gated_preds

def calibrate_model_rejections(prob_npz_path):
    data = np.load(prob_npz_path)
    y_val_a = data["y_val_a"]
    val_prob_a = data["val_prob_a"]
    y_test_a = data["y_test_a"]
    test_prob_a = data["test_prob_a"]

    y_val_b = data["y_val_b"]
    val_prob_b = data["val_prob_b"]
    y_test_b = data["y_test_b"]
    test_prob_b = data["test_prob_b"]

    # 1. Baseline uncalibrated test metrics
    base_eval_a = evaluate_metrics(y_test_a, np.argmax(test_prob_a, axis=1))
    base_eval_b = evaluate_metrics(y_test_b, np.argmax(test_prob_b, axis=1))
    base_mean = {
        "accuracy": (base_eval_a["accuracy"] + base_eval_b["accuracy"]) / 2.0,
        "macro_f1": (base_eval_a["macro_f1"] + base_eval_b["macro_f1"]) / 2.0,
        "false_sign_activation_rate": (base_eval_a["false_sign_activation_rate"] + base_eval_b["false_sign_activation_rate"]) / 2.0,
        "real_sign_rejection_rate": (base_eval_a["real_sign_rejection_rate"] + base_eval_b["real_sign_rejection_rate"]) / 2.0,
        "mean_real_sign_recall": (base_eval_a["mean_real_sign_recall"] + base_eval_b["mean_real_sign_recall"]) / 2.0,
        "min_real_sign_recall": (base_eval_a["min_real_sign_recall"] + base_eval_b["min_real_sign_recall"]) / 2.0
    }

    # 2. Global Confidence Threshold Calibration
    # Sweep on validation data ONLY
    th_candidates = [0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90]
    
    def pick_best_threshold(y_val, val_prob):
        best_th = 0.50
        best_score = -999.0
        for th in th_candidates:
            v_preds = apply_global_threshold(val_prob, th)
            v_met = evaluate_metrics(y_val, v_preds)
            # Objective: minimize false activation while keeping real sign recall >= 0.60
            if v_met["mean_real_sign_recall"] >= 0.55:
                # Score = macro_f1 - 0.5 * false_act
                score = v_met["macro_f1"] - (0.5 * v_met["false_sign_activation_rate"])
                if score > best_score:
                    best_score = score
                    best_th = th
        return best_th

    best_th_a = pick_best_threshold(y_val_a, val_prob_a)
    best_th_b = pick_best_threshold(y_val_b, val_prob_b)

    # Evaluate frozen best thresholds on held-out test data
    th_test_a = evaluate_metrics(y_test_a, apply_global_threshold(test_prob_a, best_th_a))
    th_test_b = evaluate_metrics(y_test_b, apply_global_threshold(test_prob_b, best_th_b))
    th_mean = {
        "best_threshold_a": best_th_a,
        "best_threshold_b": best_th_b,
        "accuracy": (th_test_a["accuracy"] + th_test_b["accuracy"]) / 2.0,
        "macro_f1": (th_test_a["macro_f1"] + th_test_b["macro_f1"]) / 2.0,
        "false_sign_activation_rate": (th_test_a["false_sign_activation_rate"] + th_test_b["false_sign_activation_rate"]) / 2.0,
        "real_sign_rejection_rate": (th_test_a["real_sign_rejection_rate"] + th_test_b["real_sign_rejection_rate"]) / 2.0,
        "mean_real_sign_recall": (th_test_a["mean_real_sign_recall"] + th_test_b["mean_real_sign_recall"]) / 2.0,
        "min_real_sign_recall": (th_test_a["min_real_sign_recall"] + th_test_b["min_real_sign_recall"]) / 2.0
    }

    # 3. Top1 - Top2 Margin Gating Calibration
    margin_candidates = [0.10, 0.20, 0.30, 0.40, 0.50]
    def pick_best_margin(y_val, val_prob):
        best_m = 0.20
        best_score = -999.0
        for m in margin_candidates:
            v_preds = apply_margin_gating(val_prob, m)
            v_met = evaluate_metrics(y_val, v_preds)
            if v_met["mean_real_sign_recall"] >= 0.55:
                score = v_met["macro_f1"] - (0.5 * v_met["false_sign_activation_rate"])
                if score > best_score:
                    best_score = score
                    best_m = m
        return best_m

    best_m_a = pick_best_margin(y_val_a, val_prob_a)
    best_m_b = pick_best_margin(y_val_b, val_prob_b)

    m_test_a = evaluate_metrics(y_test_a, apply_margin_gating(test_prob_a, best_m_a))
    m_test_b = evaluate_metrics(y_test_b, apply_margin_gating(test_prob_b, best_m_b))
    m_mean = {
        "best_margin_a": best_m_a,
        "best_margin_b": best_m_b,
        "accuracy": (m_test_a["accuracy"] + m_test_b["accuracy"]) / 2.0,
        "macro_f1": (m_test_a["macro_f1"] + m_test_b["macro_f1"]) / 2.0,
        "false_sign_activation_rate": (m_test_a["false_sign_activation_rate"] + m_test_b["false_sign_activation_rate"]) / 2.0,
        "real_sign_rejection_rate": (m_test_a["real_sign_rejection_rate"] + m_test_b["real_sign_rejection_rate"]) / 2.0,
        "mean_real_sign_recall": (m_test_a["mean_real_sign_recall"] + m_test_b["mean_real_sign_recall"]) / 2.0,
        "min_real_sign_recall": (m_test_a["min_real_sign_recall"] + m_test_b["min_real_sign_recall"]) / 2.0
    }

    # 4. Class-Specific Thresholds Calibration
    def pick_class_thresholds(y_val, val_prob):
        class_th = {}
        for c in range(len(FROZEN_CLASSES)):
            if c == NO_SIGN_IDX:
                continue
            # Pick threshold for class c to maximize precision on validation while keeping recall >= 0.50
            best_c_th = 0.60
            best_c_score = -999.0
            for th in [0.40, 0.50, 0.60, 0.70, 0.80]:
                c_mask = (np.argmax(val_prob, axis=1) == c) & (np.max(val_prob, axis=1) >= th)
                # True positives
                tp = np.sum((y_val == c) & c_mask)
                fp = np.sum((y_val != c) & c_mask)
                fn = np.sum((y_val == c) & (~c_mask))
                prec = tp / max(tp + fp, 1)
                rec = tp / max(tp + fn, 1)
                if rec >= 0.50:
                    c_score = 2 * (prec * rec) / max(prec + rec, 1e-6)
                    if c_score > best_c_score:
                        best_c_score = c_score
                        best_c_th = th
            class_th[c] = best_c_th
        return class_th

    cls_th_a = pick_class_thresholds(y_val_a, val_prob_a)
    cls_th_b = pick_class_thresholds(y_val_b, val_prob_b)

    cls_test_a = evaluate_metrics(y_test_a, apply_class_specific_thresholds(test_prob_a, cls_th_a))
    cls_test_b = evaluate_metrics(y_test_b, apply_class_specific_thresholds(test_prob_b, cls_th_b))
    cls_mean = {
        "class_thresholds_a": {ID_TO_LABEL[c]: cls_th_a[c] for c in cls_th_a},
        "class_thresholds_b": {ID_TO_LABEL[c]: cls_th_b[c] for c in cls_th_b},
        "accuracy": (cls_test_a["accuracy"] + cls_test_b["accuracy"]) / 2.0,
        "macro_f1": (cls_test_a["macro_f1"] + cls_test_b["macro_f1"]) / 2.0,
        "false_sign_activation_rate": (cls_test_a["false_sign_activation_rate"] + cls_test_b["false_sign_activation_rate"]) / 2.0,
        "real_sign_rejection_rate": (cls_test_a["real_sign_rejection_rate"] + cls_test_b["real_sign_rejection_rate"]) / 2.0,
        "mean_real_sign_recall": (cls_test_a["mean_real_sign_recall"] + cls_test_b["mean_real_sign_recall"]) / 2.0,
        "min_real_sign_recall": (cls_test_a["min_real_sign_recall"] + cls_test_b["min_real_sign_recall"]) / 2.0
    }

    # 5. Combined Threshold + Margin Calibration
    def pick_combined(y_val, val_prob):
        best_cfg = (0.70, 0.20)
        best_score = -999.0
        for th in [0.50, 0.60, 0.70, 0.80]:
            for m in [0.10, 0.20, 0.30]:
                v_preds = apply_combined_threshold_margin(val_prob, th, m)
                v_met = evaluate_metrics(y_val, v_preds)
                if v_met["mean_real_sign_recall"] >= 0.50:
                    score = v_met["macro_f1"] - (0.5 * v_met["false_sign_activation_rate"])
                    if score > best_score:
                        best_score = score
                        best_cfg = (th, m)
        return best_cfg

    comb_a = pick_combined(y_val_a, val_prob_a)
    comb_b = pick_combined(y_val_b, val_prob_b)

    comb_test_a = evaluate_metrics(y_test_a, apply_combined_threshold_margin(test_prob_a, comb_a[0], comb_a[1]))
    comb_test_b = evaluate_metrics(y_test_b, apply_combined_threshold_margin(test_prob_b, comb_b[0], comb_b[1]))
    comb_mean = {
        "best_combined_a": {"threshold": comb_a[0], "margin": comb_a[1]},
        "best_combined_b": {"threshold": comb_b[0], "margin": comb_b[1]},
        "accuracy": (comb_test_a["accuracy"] + comb_test_b["accuracy"]) / 2.0,
        "macro_f1": (comb_test_a["macro_f1"] + comb_test_b["macro_f1"]) / 2.0,
        "false_sign_activation_rate": (comb_test_a["false_sign_activation_rate"] + comb_test_b["false_sign_activation_rate"]) / 2.0,
        "real_sign_rejection_rate": (comb_test_a["real_sign_rejection_rate"] + comb_test_b["real_sign_rejection_rate"]) / 2.0,
        "mean_real_sign_recall": (comb_test_a["mean_real_sign_recall"] + comb_test_b["mean_real_sign_recall"]) / 2.0,
        "min_real_sign_recall": (comb_test_a["min_real_sign_recall"] + comb_test_b["min_real_sign_recall"]) / 2.0
    }

    return {
        "uncalibrated_baseline": base_mean,
        "global_confidence_threshold": th_mean,
        "top1_top2_margin": m_mean,
        "class_specific_thresholds": cls_mean,
        "combined_threshold_margin": comb_mean
    }

def main():
    print("==================================================")
    print("CALIBRATING REJECTION STRATEGIES ON TRUE STREAMING MODELS")
    print("==================================================")

    npz_files = sorted(glob.glob(os.path.join(OUTPUTS_DIR, "stream_*_probs.npz")))
    if not npz_files:
        print("No streaming prob npz files found yet.")
        return

    all_calibration_results = {}
    for f in npz_files:
        model_name = os.path.basename(f).replace("_probs.npz", "")
        print(f"\nCalibrating model: {model_name}")
        res = calibrate_model_rejections(f)
        all_calibration_results[model_name] = res

        print(f"  Uncalibrated False Act: {res['uncalibrated_baseline']['false_sign_activation_rate']*100:.1f}% | Macro F1: {res['uncalibrated_baseline']['macro_f1']:.4f}")
        print(f"  Global Thresh False Act:{res['global_confidence_threshold']['false_sign_activation_rate']*100:.1f}% | Macro F1: {res['global_confidence_threshold']['macro_f1']:.4f}")
        print(f"  Margin Gating False Act:{res['top1_top2_margin']['false_sign_activation_rate']*100:.1f}% | Macro F1: {res['top1_top2_margin']['macro_f1']:.4f}")
        print(f"  Class Thresh False Act: {res['class_specific_thresholds']['false_sign_activation_rate']*100:.1f}% | Macro F1: {res['class_specific_thresholds']['macro_f1']:.4f}")
        print(f"  Combined Gating False:  {res['combined_threshold_margin']['false_sign_activation_rate']*100:.1f}% | Macro F1: {res['combined_threshold_margin']['macro_f1']:.4f}")

    out_json = os.path.join(REPORTS_DIR, "rejection_calibration_results.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_calibration_results, f, indent=2)
    print(f"\nSaved all calibration results to: {out_json}")

if __name__ == "__main__":
    main()
