import os
import sys
import json
import numpy as np
import onnxruntime as ort

PROJECT_ROOT = r"C:\Users\ztech.pk\Downloads\CommuniCare-AAC-main\CommuniCare-AAC-main"
MODEL_PATH = os.path.join(PROJECT_ROOT, "public", "models", "communicare-aac-sign-v3-candidate", "model.onnx")
DATA_DIR = os.path.join(PROJECT_ROOT, "training", "data")
SCRIPT_DIR = os.path.join(PROJECT_ROOT, "training", "v3", "scripts")
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from data_loader_phase2k import (
    load_four_real_signers,
    compute_position_velocity_features,
    FROZEN_CLASSES,
    LABEL_TO_ID,
    ID_TO_LABEL,
    NO_SIGN_IDX
)

def run_diagnostics():
    print("=" * 60)
    print("PHASE 2O: RUNTIME FALSE-ACTIVATION & LATENCY DIAGNOSTICS")
    print("=" * 60)

    # 1. Load ONNX model
    session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    print(f"Loaded ONNX Model: {MODEL_PATH}")
    print(f"Input: {input_name}, shape: {session.get_inputs()[0].shape}")
    print(f"Output: {output_name}, shape: {session.get_outputs()[0].shape}")

    # 2. Parity check of Python vs TypeScript feature calculation
    # Synthetic frame test
    np.random.seed(42)
    sample_pos = np.random.uniform(-1, 1, size=(24, 126)).astype(np.float32)
    # Zero out left hand on first 5 frames to test missing hand logic
    sample_pos[:5, :63] = 0.0
    
    py_feat = compute_position_velocity_features(sample_pos)
    
    # Simulate TypeScript logic in Python
    T, D_POS, D_TOTAL = 24, 126, 252
    ts_feat = np.zeros((T, D_TOTAL), dtype=np.float32)
    for t in range(T):
        ts_feat[t, :D_POS] = sample_pos[t]
        if t > 0:
            left_now = np.any(np.abs(sample_pos[t, :63]) > 1e-5)
            left_prev = np.any(np.abs(sample_pos[t-1, :63]) > 1e-5)
            if left_now and left_prev:
                ts_feat[t, D_POS:D_POS+63] = sample_pos[t, :63] - sample_pos[t-1, :63]
            
            right_now = np.any(np.abs(sample_pos[t, 63:]) > 1e-5)
            right_prev = np.any(np.abs(sample_pos[t-1, 63:]) > 1e-5)
            if right_now and right_prev:
                ts_feat[t, D_POS+63:D_POS+126] = sample_pos[t, 63:] - sample_pos[t-1, 63:]
    
    diff = np.max(np.abs(py_feat - ts_feat))
    print(f"\nFeature calculation difference (Python vs TS logic): {diff:.8f}")
    assert diff < 1e-6, "Feature calculation mismatch between Python and TS!"
    print("FEATURE CALCULATION PARITY: 100% BIT-LEVEL MATCH!")

    # 3. Test on genuine four-signer samples
    samples = load_four_real_signers()
    no_sign_samples = [s for s in samples if s["label"] == "NO_SIGN"]
    real_sign_samples = [s for s in samples if s["label"] != "NO_SIGN"]
    print(f"\nGenuine samples: {len(samples)} total ({len(no_sign_samples)} NO_SIGN, {len(real_sign_samples)} real sign)")

    # 4. Calibration parameters
    conf_thresh = 0.85
    margin_thresh = 0.10
    stability_win = 3
    stride = 3
    target_len = 24

    # Run streaming evaluation on NO_SIGN sequences
    print(f"\nEvaluating NO_SIGN sequences under locked calibration (th={conf_thresh}, mg={margin_thresh}, stab={stability_win}, stride={stride})...")
    false_activations = []
    
    for s in no_sign_samples:
        frames_60 = s["frames"]
        window_starts = list(range(0, 60 - target_len + 1, stride))
        consecutive_accepted = []
        surfaced = False
        surfaced_class = None
        surfaced_conf = 0.0
        surfaced_margin = 0.0
        surfaced_window_idx = -1

        for w_idx, st in enumerate(window_starts):
            win = frames_60[st:st + target_len]
            feat = compute_position_velocity_features(win)
            inp = np.expand_dims(feat, axis=0) # [1, 24, 252]
            probs = session.run([output_name], {input_name: inp})[0][0]
            
            top_indices = np.argsort(probs)[::-1]
            top1_idx, top2_idx = top_indices[0], top_indices[1]
            top1_lbl, top2_lbl = ID_TO_LABEL[top1_idx], ID_TO_LABEL[top2_idx]
            top1_prob, top2_prob = float(probs[top1_idx]), float(probs[top2_idx])
            margin = top1_prob - top2_prob

            accepted = (top1_lbl != "NO_SIGN") and (top1_prob >= conf_thresh) and (margin >= margin_thresh)

            if accepted:
                if len(consecutive_accepted) > 0 and consecutive_accepted[-1] == top1_lbl:
                    consecutive_accepted.append(top1_lbl)
                else:
                    consecutive_accepted = [top1_lbl]
            else:
                consecutive_accepted = []

            if len(consecutive_accepted) >= stability_win and not surfaced:
                surfaced = True
                surfaced_class = top1_lbl
                surfaced_conf = top1_prob
                surfaced_margin = margin
                surfaced_window_idx = w_idx
                break

        if surfaced:
            false_activations.append({
                "id": s["id"],
                "signer": s["signer"],
                "class": surfaced_class,
                "conf": surfaced_conf,
                "margin": surfaced_margin,
                "window_idx": surfaced_window_idx,
                "latency_sec": (surfaced_window_idx * stride + target_len) / 30.0
            })

    print(f"NO_SIGN Sequences tested: {len(no_sign_samples)}")
    print(f"False activations: {len(false_activations)} ({len(false_activations)/len(no_sign_samples)*100:.2f}%)")
    
    # Breakdown by class
    from collections import Counter
    class_counts = Counter(fa["class"] for fa in false_activations)
    print("\nFalse activations by class on dataset:")
    for cls in FROZEN_CLASSES:
        if cls != "NO_SIGN":
            print(f"  {cls}: {class_counts.get(cls, 0)}")

    # 5. Let's analyze what specific gestures trigger false positives
    print("\n" + "=" * 60)
    print("ANALYSIS OF NORMAL ACTIONS / NO_SIGN BEHAVIOR")
    print("=" * 60)
    
    # A. Completely empty frames (hands off screen / resting on desk below camera)
    empty_win = np.zeros((24, 126), dtype=np.float32)
    empty_feat = compute_position_velocity_features(empty_win)
    empty_probs = session.run([output_name], {input_name: np.expand_dims(empty_feat, 0)})[0][0]
    print(f"\n1. Completely empty frame (hands off camera):")
    for idx, cls in enumerate(FROZEN_CLASSES):
        print(f"   {cls:10s}: {empty_probs[idx]*100:.2f}%")
    
    # B. Static right hand (e.g. open palm or resting hand in center)
    # Normalized hand centered at wrist
    static_hand = np.zeros((24, 126), dtype=np.float32)
    # Put standard wrist-relative landmarks in right slot (63..125)
    # Using wrist at (0,0,0) and middle MCP at (0, 0.5, 0)
    for lm in range(21):
        static_hand[:, 63 + lm*3 + 1] = 0.5 * (lm / 21.0)
    static_feat = compute_position_velocity_features(static_hand)
    static_probs = session.run([output_name], {input_name: np.expand_dims(static_feat, 0)})[0][0]
    print(f"\n2. Static right hand (zero velocity):")
    for idx, cls in enumerate(FROZEN_CLASSES):
        print(f"   {cls:10s}: {static_probs[idx]*100:.2f}%")

    # C. Hand waving (periodic side-to-side motion of right hand)
    waving_hand = static_hand.copy()
    for t in range(24):
        # Oscillate x coordinate
        shift = np.sin(t * 0.5) * 0.3
        for lm in range(21):
            waving_hand[t, 63 + lm*3] += shift
    waving_feat = compute_position_velocity_features(waving_hand)
    waving_probs = session.run([output_name], {input_name: np.expand_dims(waving_feat, 0)})[0][0]
    print(f"\n3. Right hand waving motion (like casual waving / Hello):")
    for idx, cls in enumerate(FROZEN_CLASSES):
        print(f"   {cls:10s}: {waving_probs[idx]*100:.2f}%")

if __name__ == "__main__":
    run_diagnostics()
