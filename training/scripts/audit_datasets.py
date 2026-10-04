import os
import glob
import json
import math
import hashlib
from collections import Counter, defaultdict

EXPECTED_CLASSES = [
    "water",
    "help",
    "hungry",
    "need",
    "want",
    "hello",
    "thankyou",
    "NO_SIGN"
]

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

def hash_sequence(frames):
    h = hashlib.sha256()
    for frame in frames:
        for val in frame:
            h.update(f"{val:.7f}".encode('utf-8'))
    return h.hexdigest()

def audit_file(filepath):
    filename = os.path.basename(filepath)
    print(f"\n==========================================")
    print(f"AUDITING FILE: {filename}")
    print(f"==========================================")
    
    issues = []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"FATAL ERROR: Failed to parse JSON: {e}")
        return None, [f"Failed to parse JSON: {e}"]
        
    top_version = data.get("version")
    if top_version is None:
        issues.append("Missing top-level 'version'")
        
    samples = data.get("samples", [])
    total_samples = data.get("totalSamples")
    if total_samples != len(samples):
        issues.append(f"totalSamples ({total_samples}) != len(samples) ({len(samples)})")
        
    actual_class_counts = Counter()
    actual_signer_counts = Counter()
    
    all_zero_sequences = []
    partial_zero_sequences = []
    malformed_samples = []
    hashes = {}
    duplicates_within_file = []
    
    normalized_frames_equal_frames = True
    normalized_frames_present_count = 0
    raw_frames_present_count = 0
    
    for idx, sample in enumerate(samples):
        # 8. Check required fields
        required_fields = ["label", "sequenceLength", "featureSchema", "signerAlias", "cameraFacing", "frames"]
        missing_fields = [rf for rf in required_fields if rf not in sample]
        if missing_fields:
            issues.append(f"Sample {idx} missing fields: {missing_fields}")
            malformed_samples.append({"index": idx, "reason": f"Missing fields: {missing_fields}"})
            continue
            
        label = sample["label"]
        seq_len = sample["sequenceLength"]
        schema = sample["featureSchema"]
        signer = sample["signerAlias"]
        facing = sample["cameraFacing"]
        frames = sample["frames"]
        
        actual_class_counts[label] += 1
        actual_signer_counts[signer] += 1
        
        # 7. Check label
        if label not in EXPECTED_CLASSES:
            issues.append(f"Sample {idx} has unexpected label: '{label}'")
            malformed_samples.append({"index": idx, "reason": f"Unexpected label: {label}"})
            
        # 9. sequenceLength == 60
        if seq_len != 60:
            issues.append(f"Sample {idx} sequenceLength is {seq_len}, expected 60")
            malformed_samples.append({"index": idx, "reason": f"sequenceLength {seq_len} != 60"})
            
        # 10. len(frames) == 60
        if not isinstance(frames, list) or len(frames) != 60:
            issues.append(f"Sample {idx} frames length is {len(frames) if isinstance(frames, list) else type(frames)}, expected 60")
            malformed_samples.append({"index": idx, "reason": "frames length != 60"})
            continue
            
        # 14. featureSchema == 'wrist_normalized_v1'
        if schema != "wrist_normalized_v1":
            issues.append(f"Sample {idx} featureSchema is '{schema}', expected 'wrist_normalized_v1'")
            malformed_samples.append({"index": idx, "reason": f"featureSchema != wrist_normalized_v1: {schema}"})
            
        # Check normalizedFrames and rawFrames
        if "normalizedFrames" in sample:
            normalized_frames_present_count += 1
            if sample["normalizedFrames"] != frames:
                normalized_frames_equal_frames = False
                
        if "rawFrames" in sample:
            raw_frames_present_count += 1
            
        # 11, 12, 13. Frame inspection
        sample_all_zero = True
        zero_frames_count = 0
        has_numeric_error = False
        
        for f_idx, frame in enumerate(frames):
            if not isinstance(frame, list) or len(frame) != 126:
                issues.append(f"Sample {idx} frame {f_idx} length is {len(frame) if isinstance(frame, list) else type(frame)}, expected 126")
                malformed_samples.append({"index": idx, "reason": f"frame {f_idx} length != 126"})
                has_numeric_error = True
                break
                
            frame_all_zero = True
            for feat_idx, val in enumerate(frame):
                if val is None or isinstance(val, (str, bool)) or math.isnan(val) or math.isinf(val):
                    issues.append(f"Sample {idx} frame {f_idx} feat {feat_idx} has invalid value: {val}")
                    malformed_samples.append({"index": idx, "reason": f"invalid feat val at frame {f_idx} feat {feat_idx}: {val}"})
                    has_numeric_error = True
                    break
                if val != 0.0:
                    frame_all_zero = False
                    sample_all_zero = False
            if has_numeric_error:
                break
            if frame_all_zero:
                zero_frames_count += 1
                
        if has_numeric_error:
            continue
            
        if sample_all_zero:
            all_zero_sequences.append({"index": idx, "label": label, "signer": signer})
        elif zero_frames_count > 0:
            partial_zero_sequences.append({
                "index": idx, 
                "label": label, 
                "signer": signer, 
                "zero_frame_count": zero_frames_count
            })
            
        # Duplicate detection within file
        seq_hash = hash_sequence(frames)
        if seq_hash in hashes:
            orig_idx = hashes[seq_hash]
            duplicates_within_file.append({
                "sample1": orig_idx,
                "sample2": idx,
                "label1": samples[orig_idx]["label"],
                "label2": label,
                "signer1": samples[orig_idx]["signerAlias"],
                "signer2": signer,
                "hash": seq_hash
            })
        else:
            hashes[seq_hash] = idx

    # Check top-level classCounts
    meta_class_counts = data.get("classCounts", {})
    for cls in EXPECTED_CLASSES:
        if meta_class_counts.get(cls, 0) != actual_class_counts[cls]:
            issues.append(f"Metadata classCounts[{cls}] ({meta_class_counts.get(cls)}) != actual count ({actual_class_counts[cls]})")
            
    # Check top-level signerCounts
    meta_signer_counts = data.get("signerCounts", {})
    if meta_signer_counts:
        for sgn, cnt in actual_signer_counts.items():
            if meta_signer_counts.get(sgn) != cnt:
                issues.append(f"Metadata signerCounts[{sgn}] ({meta_signer_counts.get(sgn)}) != actual count ({cnt})")
                
    meta_signers = data.get("signers", [])
    if set(meta_signers) != set(actual_signer_counts.keys()):
        issues.append(f"Metadata signers {meta_signers} != actual signers {list(actual_signer_counts.keys())}")
        
    file_summary = {
        "filename": filename,
        "filepath": filepath,
        "top_version": top_version,
        "total_samples": len(samples),
        "actual_class_counts": dict(actual_class_counts),
        "actual_signer_counts": dict(actual_signer_counts),
        "issues": issues,
        "malformed_samples": malformed_samples,
        "all_zero_sequences": all_zero_sequences,
        "partial_zero_sequences": partial_zero_sequences,
        "duplicates_within_file": duplicates_within_file,
        "normalized_frames_equal_frames": normalized_frames_equal_frames,
        "normalized_frames_present_count": normalized_frames_present_count,
        "raw_frames_present_count": raw_frames_present_count,
        "hashes": hashes, # map hash -> idx
        "samples": samples
    }
    
    print(f"Total samples: {len(samples)}")
    print(f"Signers: {dict(actual_signer_counts)}")
    print(f"Class counts: {dict(actual_class_counts)}")
    print(f"All-zero sequences: {len(all_zero_sequences)}")
    print(f"Sequences with some zero frames: {len(partial_zero_sequences)}")
    print(f"Duplicates within file: {len(duplicates_within_file)}")
    print(f"Malformed samples: {len(malformed_samples)}")
    print(f"Issues found: {len(issues)}")
    if issues:
        for iss in issues[:10]:
            print(f"  - {iss}")
        if len(issues) > 10:
            print(f"  ... and {len(issues) - 10} more")
            
    return file_summary, issues

def run_audit():
    json_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    print(f"Discovered {len(json_files)} JSON dataset files in {DATA_DIR}:")
    for f in json_files:
        print(f" - {os.path.basename(f)}")
        
    if len(json_files) != 2:
        print(f"WARNING: Expected 2 dataset files, found {len(json_files)}")
        
    summaries = []
    all_issues = []
    
    for jf in json_files:
        summ, issues = audit_file(jf)
        if summ:
            summaries.append(summ)
        all_issues.extend(issues)
        
    # Check cross-file duplicates and relationships
    cross_file_duplicates = []
    if len(summaries) >= 2:
        file1 = summaries[0]
        file2 = summaries[1]
        
        for h, idx1 in file1["hashes"].items():
            if h in file2["hashes"]:
                idx2 = file2["hashes"][h]
                cross_file_duplicates.append({
                    "file1": file1["filename"],
                    "sample1_idx": idx1,
                    "label1": file1["samples"][idx1]["label"],
                    "signer1": file1["samples"][idx1]["signerAlias"],
                    "file2": file2["filename"],
                    "sample2_idx": idx2,
                    "label2": file2["samples"][idx2]["label"],
                    "signer2": file2["samples"][idx2]["signerAlias"],
                    "hash": h
                })
                
    print(f"\n==========================================")
    print(f"CROSS-DATASET AUDIT SUMMARY")
    print(f"==========================================")
    print(f"Total files audited: {len(summaries)}")
    total_seqs = sum(s["total_samples"] for s in summaries)
    print(f"Combined total sequences: {total_seqs}")
    
    combined_class_counts = Counter()
    combined_signer_counts = Counter()
    for s in summaries:
        for k, v in s["actual_class_counts"].items():
            combined_class_counts[k] += v
        for k, v in s["actual_signer_counts"].items():
            combined_signer_counts[k] += v
            
    print(f"Combined signer counts: {dict(combined_signer_counts)}")
    print(f"Combined class counts:")
    for cls in EXPECTED_CLASSES:
        print(f"  {cls:12s}: {combined_class_counts[cls]}")
        
    print(f"Cross-file exact duplicates: {len(cross_file_duplicates)}")
    if cross_file_duplicates:
        for d in cross_file_duplicates:
            print(f"  Duplicate: {d['file1']}[{d['sample1_idx']}] ({d['signer1']}/{d['label1']}) == {d['file2']}[{d['sample2_idx']}] ({d['signer2']}/{d['label2']})")
            
    # Check signer-01 file actually contains signer-01 and signer-02 actually contains signer-02
    for s in summaries:
        fname = s["filename"].lower()
        if "signer-01" in fname or "signer_01" in fname:
            if list(s["actual_signer_counts"].keys()) != ["signer-01"]:
                all_issues.append(f"{s['filename']} signers {list(s['actual_signer_counts'].keys())} does not match expected ['signer-01']")
        elif "signer-02" in fname or "signer_02" in fname:
            if list(s["actual_signer_counts"].keys()) != ["signer-02"]:
                all_issues.append(f"{s['filename']} signers {list(s['actual_signer_counts'].keys())} does not match expected ['signer-02']")

    # Save dataset-audit.json
    audit_output = {
        "status": "PASSED" if len(all_issues) == 0 else "FAILED",
        "total_files": len(summaries),
        "total_valid_sequences": total_seqs if len(all_issues) == 0 else 0,
        "combined_signer_counts": dict(combined_signer_counts),
        "combined_class_counts": dict(combined_class_counts),
        "cross_file_duplicates_count": len(cross_file_duplicates),
        "cross_file_duplicates": cross_file_duplicates,
        "issues": all_issues,
        "file_audits": [
            {
                "filename": s["filename"],
                "total_samples": s["total_samples"],
                "signer_counts": s["actual_signer_counts"],
                "class_counts": s["actual_class_counts"],
                "all_zero_sequences_count": len(s["all_zero_sequences"]),
                "partial_zero_sequences_count": len(s["partial_zero_sequences"]),
                "duplicates_within_file_count": len(s["duplicates_within_file"]),
                "malformed_samples_count": len(s["malformed_samples"]),
                "normalized_frames_equal_frames": s["normalized_frames_equal_frames"],
                "normalized_frames_present_count": s["normalized_frames_present_count"],
                "raw_frames_present_count": s["raw_frames_present_count"],
                "issues": s["issues"]
            }
            for s in summaries
        ]
    }
    
    audit_json_path = os.path.join(REPORTS_DIR, "dataset-audit.json")
    with open(audit_json_path, 'w', encoding='utf-8') as f:
        json.dump(audit_output, f, indent=2)
    print(f"\nSaved audit report to: {audit_json_path}")
    
    # Save class-distribution.json
    class_dist_output = {
        "expected_classes": EXPECTED_CLASSES,
        "total_samples": total_seqs,
        "by_signer": {
            s["filename"]: {
                "signer": list(s["actual_signer_counts"].keys())[0] if s["actual_signer_counts"] else "unknown",
                "counts": s["actual_class_counts"]
            }
            for s in summaries
        },
        "combined": dict(combined_class_counts)
    }
    class_dist_json_path = os.path.join(REPORTS_DIR, "class-distribution.json")
    with open(class_dist_json_path, 'w', encoding='utf-8') as f:
        json.dump(class_dist_output, f, indent=2)
    print(f"Saved class distribution report to: {class_dist_json_path}")
    
    print(f"\nFINAL AUDIT STATUS: {'PASSED' if len(all_issues) == 0 else 'FAILED'}")
    return len(all_issues) == 0

if __name__ == "__main__":
    success = run_audit()
    exit(0 if success else 1)
