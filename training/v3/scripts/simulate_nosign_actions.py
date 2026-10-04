import os
import sys
import numpy as np
import onnxruntime as ort

PROJECT_ROOT = r"C:\Users\ztech.pk\Downloads\CommuniCare-AAC-main\CommuniCare-AAC-main"
MODEL_PATH = os.path.join(PROJECT_ROOT, "public", "models", "communicare-aac-sign-v3-candidate", "model.onnx")
SCRIPT_DIR = os.path.join(PROJECT_ROOT, "training", "v3", "scripts")
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from data_loader_phase2k import (
    compute_position_velocity_features,
    FROZEN_CLASSES,
    ID_TO_LABEL
)

def evaluate_nosign_actions():
    session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    conf_thresh = 0.85
    margin_thresh = 0.10
    stability_win = 3
    stride = 3
    target_len = 24

    # We will simulate 60 frames (2 seconds at 30 fps) for 21 varied NO_SIGN trials
    trials = [
        {"action": "abandoned / partial gesture (hands lift then drop)", "type": "partial_abort"},
        {"action": "casual waving (open hand side to side)", "type": "waving"},
        {"action": "adjusting glasses (hand near eye/temple)", "type": "glasses"},
        {"action": "touching face / chin (hand static at chin)", "type": "chin_touch"},
        {"action": "adjusting hair (hand sweeping near temple)", "type": "hair"},
        {"action": "holding phone (static vertical hand)", "type": "phone"},
        {"action": "pointing at screen (extended index finger)", "type": "pointing"},
        {"action": "open resting palm (static open hand)", "type": "open_palm"},
        {"action": "closed fist (static fist)", "type": "fist"},
        {"action": "reaching for object (forward translation)", "type": "reaching"},
        {"action": "hands entering camera (lateral motion from edge)", "type": "enter_cam"},
        {"action": "hands leaving camera (lateral motion exiting)", "type": "leave_cam"},
        {"action": "typing on keyboard (two hands low, slight jitter)", "type": "typing"},
        {"action": "using mouse / trackpad (one hand curved, low)", "type": "mouse"},
        {"action": "hands resting on table (static low)", "type": "table_rest"},
        {"action": "random finger motion / fidgeting (low amplitude)", "type": "fidgeting"},
        {"action": "one hand visible resting (left hand low)", "type": "one_hand_left"},
        {"action": "one hand visible resting (right hand low)", "type": "one_hand_right"},
        {"action": "two hands visible resting (both hands static)", "type": "two_hands_rest"},
        {"action": "casual head scratch (hand at top of head)", "type": "scratch"},
        {"action": "rubbing hands together (two hands rubbing)", "type": "rubbing"}
    ]

    print("=" * 70)
    print("DETAILED SIMULATION OF 21 NO_SIGN ACTIONS ON CANDIDATE B ONNX")
    print("=" * 70)

    results = []

    for t_idx, t in enumerate(trials):
        # Generate 60 frames of 126 position features
        frames_60 = np.zeros((60, 126), dtype=np.float32)
        action_type = t["type"]

        # Base hand landmarks (normalized, wrist at origin)
        base_right = np.zeros(63, dtype=np.float32)
        for lm in range(21):
            base_right[lm*3 + 1] = 0.5 * (lm / 21.0) # pointing slightly up

        base_left = np.zeros(63, dtype=np.float32)
        for lm in range(21):
            base_left[lm*3 + 1] = 0.5 * (lm / 21.0)

        for f in range(60):
            if action_type == "partial_abort":
                # Hands lift for frames 0..20, pause 20..30, drop 30..60
                if f < 30:
                    prog = f / 30.0
                    frames_60[f, 63:] = base_right + prog * 0.2
                    frames_60[f, :63] = base_left + prog * 0.2
                else:
                    frames_60[f, 63:] = base_right * max(0, (1.0 - (f - 30) / 20.0))
                    frames_60[f, :63] = base_left * max(0, (1.0 - (f - 30) / 20.0))

            elif action_type == "waving":
                # Hand near head, oscillating x
                frames_60[f, 63:] = base_right
                frames_60[f, 63::3] += np.sin(f * 0.4) * 0.35 # x oscillation
                frames_60[f, 63+1::3] += 0.4 # higher up

            elif action_type == "glasses":
                # Hand near temple/eyes, high up, slight finger motion
                frames_60[f, 63:] = base_right
                frames_60[f, 63+1::3] += 0.6 # high up near face
                frames_60[f, 63+8*3] += np.sin(f * 0.2) * 0.05 # index finger twitch

            elif action_type == "chin_touch":
                # Static at chin
                frames_60[f, 63:] = base_right
                frames_60[f, 63+1::3] += 0.3

            elif action_type == "hair":
                # Sweeping across head
                frames_60[f, 63:] = base_right
                frames_60[f, 63::3] += (f / 60.0) * 0.4 # sweep across x
                frames_60[f, 63+1::3] += 0.7 # at top of head

            elif action_type == "phone":
                # Vertical static
                frames_60[f, 63:] = base_right

            elif action_type == "pointing":
                # Index extended
                frames_60[f, 63:] = base_right
                frames_60[f, 63+8*3:63+8*3+3] += 0.3 # index extended

            elif action_type == "open_palm":
                frames_60[f, 63:] = base_right

            elif action_type == "fist":
                # Curled fingers
                frames_60[f, 63:] = base_right * 0.5

            elif action_type == "reaching":
                # Forward motion (z / y)
                frames_60[f, 63:] = base_right + (f / 60.0) * 0.4

            elif action_type == "enter_cam":
                if f > 20:
                    frames_60[f, 63:] = base_right * ((f - 20) / 40.0)

            elif action_type == "leave_cam":
                if f < 40:
                    frames_60[f, 63:] = base_right * (1.0 - f / 40.0)

            elif action_type == "typing":
                frames_60[f, :63] = base_left + np.random.normal(0, 0.02, 63)
                frames_60[f, 63:] = base_right + np.random.normal(0, 0.02, 63)

            elif action_type == "mouse":
                frames_60[f, 63:] = base_right * 0.6 + np.random.normal(0, 0.01, 63)

            elif action_type == "table_rest":
                frames_60[f, :63] = base_left
                frames_60[f, 63:] = base_right

            elif action_type == "fidgeting":
                frames_60[f, 63:] = base_right + np.random.normal(0, 0.04, 63)

            elif action_type == "one_hand_left":
                frames_60[f, :63] = base_left

            elif action_type == "one_hand_right":
                frames_60[f, 63:] = base_right

            elif action_type == "two_hands_rest":
                frames_60[f, :63] = base_left
                frames_60[f, 63:] = base_right

            elif action_type == "scratch":
                frames_60[f, 63:] = base_right
                frames_60[f, 63+1::3] += 0.8
                frames_60[f, 63::3] += np.sin(f * 0.8) * 0.1

            elif action_type == "rubbing":
                frames_60[f, :63] = base_left + np.sin(f * 0.5) * 0.1
                frames_60[f, 63:] = base_right - np.sin(f * 0.5) * 0.1

        # Simulate sliding window inference
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
            inp = np.expand_dims(feat, axis=0)
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

        res = {
            "trial": t_idx + 1,
            "action": t["action"],
            "surfaced": surfaced,
            "class": surfaced_class if surfaced else "NO_SIGN",
            "conf": surfaced_conf if surfaced else 0.0,
            "margin": surfaced_margin if surfaced else 0.0,
            "latency_ms": int((surfaced_window_idx * stride + target_len) / 30.0 * 1000) if surfaced else None
        }
        results.append(res)
        status = f"FAIL -> {surfaced_class} ({surfaced_conf*100:.1f}%)" if surfaced else "PASS (NO_SIGN)"
        print(f"Trial {t_idx+1:2d}: {t['action'][:45]:45s} | {status}")

    false_count = sum(1 for r in results if r["surfaced"])
    print("\n" + "=" * 70)
    print(f"Total Trials: {len(results)}")
    print(f"False Activations: {false_count} / {len(results)} ({false_count/len(results)*100:.1f}%)")
    print("=" * 70)

    # Save to json report
    out_path = os.path.join(PROJECT_ROOT, "training", "v3", "reports", "nosign_simulation_diagnosis.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"Saved detailed results to {out_path}")

if __name__ == "__main__":
    evaluate_nosign_actions()
