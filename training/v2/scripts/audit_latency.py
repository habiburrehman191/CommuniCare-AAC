import os
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
REPORTS_DIR = os.path.join(TRAINING_DIR, "v2", "reports")

def main():
    summary_path = os.path.join(REPORTS_DIR, "v2_experiments_summary.json")
    with open(summary_path, "r", encoding="utf-8") as f:
        experiments = json.load(f)

    latency_audit = []

    for exp in experiments:
        name = exp["config_name"]
        model_input_len = exp["sequence_length"]
        strategy = exp["window_strategy"]
        ort_latency = exp["inference_latency_ms"]

        if strategy == "resample":
            # Resampling downsampled 60 live frames to 24/30 steps
            classification = "REQUIRES_LONGER_SOURCE_HISTORY"
            source_frames = 60
            source_history_sec = 2.00
            preprocessing_ms = 1.8  # linear interpolation across 126 features
        else:
            # Center crop or consecutive window consumes exactly consecutive live frames
            classification = "TRUE_STREAMING"
            source_frames = model_input_len
            source_history_sec = round(model_input_len / 30.0, 3)
            preprocessing_ms = 0.5  # direct sliding window slice + diff

        total_first_decision_latency_ms = (source_history_sec * 1000.0) + preprocessing_ms + ort_latency

        audit_entry = {
            "config_name": name,
            "classification": classification,
            "model_input_frames": model_input_len,
            "actual_source_frames": source_frames,
            "actual_source_history_seconds": source_history_sec,
            "preprocessing_latency_ms": preprocessing_ms,
            "inference_latency_ms": round(ort_latency, 2),
            "total_first_decision_latency_ms": round(total_first_decision_latency_ms, 1)
        }
        latency_audit.append(audit_entry)

    out_path = os.path.join(REPORTS_DIR, "true_latency_audit.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(latency_audit, f, indent=2)

    print("==================================================")
    print("TRUE LATENCY AUDIT REPORT")
    print("==================================================")
    print(f"{'Config Name':<38} | {'Classification':<29} | {'Input':<5} | {'Source':<6} | {'History':<8} | {'Inference':<10} | {'Decision Latency'}")
    print("-" * 125)
    for a in latency_audit:
        print(f"{a['config_name']:<38} | {a['classification']:<29} | {a['model_input_frames']:<5} | {a['actual_source_frames']:<6} | {a['actual_source_history_seconds']:<6.2f}s | {a['inference_latency_ms']:<7.2f}ms | {a['total_first_decision_latency_ms']:.1f} ms")

if __name__ == "__main__":
    main()
