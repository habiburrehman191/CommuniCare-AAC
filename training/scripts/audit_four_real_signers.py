import os
import json
import math
import hashlib
from collections import Counter, defaultdict

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

FROZEN_CLASSES = [
    "water",
    "help",
    "hungry",
    "need",
    "want",
    "hello",
    "thankyou",
    "NO_SIGN"
]

def hash_sample(sample):
    h = hashlib.sha256()
    for frame in sample['frames']:
        for val in frame:
            h.update(f"{val:.6f}".encode('utf-8'))
    return h.hexdigest()

def analyze_hand_presence(frames):
    # Left hand: 0..62 (21 landmarks * 3 coords = 63 values)
    # Right hand: 63..125 (21 landmarks * 3 coords = 63 values)
    has_left = False
    has_right = False
    for frame in frames:
        left_vals = frame[0:63]
        right_vals = frame[63:126]
        if any(abs(v) > 1e-6 for v in left_vals):
            has_left = True
        if any(abs(v) > 1e-6 for v in right_vals):
            has_right = True
    if has_left and has_right:
        return "two_hand"
    elif has_left:
        return "left_only"
    elif has_right:
        return "right_only"
    else:
        return "all_zero"

def main():
    files = sorted([f for f in os.listdir(DATA_DIR) if f.endswith(".json")])
    print(f"Discovered {len(files)} files in {DATA_DIR}:")
    for f in files:
        print(f" - {f}")

    all_samples = []
    file_reports = {}
    seen_hashes = {}
    cross_duplicates = []

    for fname in files:
        fpath = os.path.join(DATA_DIR, fname)
        with open(fpath, "r", encoding="utf-8") as fp:
            data = json.load(fp)

        samples = data.get("samples", [])
        total_samples = len(samples)
        
        signer_counts = Counter()
        class_counts = Counter()
        signer_class_counts = defaultdict(Counter)
        
        all_zero_count = 0
        malformed_count = 0
        nan_inf_count = 0
        hand_dist = Counter()
        local_seen_hashes = set()
        local_dups = 0

        for idx, s in enumerate(samples):
            signer = s.get("signerAlias", "UNKNOWN")
            label = s.get("label", "UNKNOWN")
            schema = s.get("featureSchema", "UNKNOWN")
            frames = s.get("frames", [])
            seq_len = s.get("sequenceLength", 0)

            signer_counts[signer] += 1
            class_counts[label] += 1
            signer_class_counts[signer][label] += 1

            # Verification checks
            is_malformed = False
            if seq_len != 60 or len(frames) != 60:
                is_malformed = True
            if schema != "wrist_normalized_v1":
                is_malformed = True
            if label not in FROZEN_CLASSES:
                is_malformed = True

            has_nan_inf = False
            for f in frames:
                if len(f) != 126:
                    is_malformed = True
                for val in f:
                    if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val):
                        has_nan_inf = True

            if has_nan_inf:
                nan_inf_count += 1
            if is_malformed:
                malformed_count += 1

            # Hand presence
            hand_type = analyze_hand_presence(frames)
            hand_dist[hand_type] += 1
            if hand_type == "all_zero":
                all_zero_count += 1

            # Duplicate check
            shash = hash_sample(s)
            if shash in local_seen_hashes:
                local_dups += 1
            else:
                local_seen_hashes.add(shash)

            if shash in seen_hashes:
                cross_duplicates.append({
                    "hash": shash,
                    "file1": seen_hashes[shash]["file"],
                    "idx1": seen_hashes[shash]["idx"],
                    "file2": fname,
                    "idx2": idx,
                    "signer": signer,
                    "label": label
                })
            else:
                seen_hashes[shash] = {"file": fname, "idx": idx, "signer": signer, "label": label, "sample": s}

        file_reports[fname] = {
            "filename": fname,
            "total_samples": total_samples,
            "signers": dict(signer_counts),
            "class_counts": dict(class_counts),
            "signer_class_counts": {k: dict(v) for k, v in signer_class_counts.items()},
            "hand_distribution": dict(hand_dist),
            "all_zero_count": all_zero_count,
            "malformed_count": malformed_count,
            "nan_inf_count": nan_inf_count,
            "internal_duplicates": local_dups
        }

    print("\n" + "="*60)
    print("DETAILED PER-FILE AUDIT RESULTS")
    print("="*60)
    for fname, rep in file_reports.items():
        print(f"\nFile: {fname}")
        print(f"  Total samples: {rep['total_samples']}")
        print(f"  Signers: {rep['signers']}")
        print(f"  Class counts: {rep['class_counts']}")
        if len(rep['signers']) > 1:
            print("  Signer-specific breakdown:")
            for s, sc in rep['signer_class_counts'].items():
                print(f"    {s}: {sc}")
        print(f"  Hand distribution: {rep['hand_distribution']}")
        print(f"  All-zero sequences: {rep['all_zero_count']}")
        print(f"  Malformed sequences: {rep['malformed_count']}")
        print(f"  NaN/Inf count: {rep['nan_inf_count']}")
        print(f"  Internal duplicates: {rep['internal_duplicates']}")

    print("\n" + "="*60)
    print(f"CROSS-FILE DUPLICATES: {len(cross_duplicates)}")
    print("="*60)
    if cross_duplicates:
        print(f"Found {len(cross_duplicates)} cross-file duplicates.")
        dup_signers = Counter(d['signer'] for d in cross_duplicates)
        print(f"Duplicates by signer: {dict(dup_signers)}")
        # Check files involved
        files_involved = Counter((d['file1'], d['file2']) for d in cross_duplicates)
        print(f"Files involved: {dict(files_involved)}")

    # Unique genuine human sample count
    unique_samples_by_signer = defaultdict(list)
    for shash, entry in seen_hashes.items():
        unique_samples_by_signer[entry['signer']].append(entry['sample'])

    print("\n" + "="*60)
    print("UNIQUE GENUINE HUMAN SAMPLES SUMMARY")
    print("="*60)
    total_unique = 0
    for s in ["signer-01", "signer-02", "signer-03", "signer-04"]:
        s_samples = unique_samples_by_signer[s]
        total_unique += len(s_samples)
        s_classes = Counter(x['label'] for x in s_samples)
        print(f"\n{s}:")
        print(f"  Total unique samples: {len(s_samples)}")
        print(f"  Per-class counts: {dict(s_classes)}")
    print(f"\nTOTAL GENUINE UNIQUE SAMPLES ACROSS ALL 4 SIGNERS: {total_unique}")

if __name__ == "__main__":
    main()
