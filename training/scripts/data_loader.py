import os
import glob
import json
import numpy as np
from sklearn.model_selection import StratifiedShuffleSplit

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

LABEL_TO_ID = {cls: idx for idx, cls in enumerate(FROZEN_CLASSES)}
ID_TO_LABEL = {idx: cls for idx, cls in enumerate(FROZEN_CLASSES)}

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

def load_all_dataset_samples(data_dir=DATA_DIR):
    """
    Loads all samples from JSON files in data_dir.
    Returns:
        X: np.ndarray of shape (N, 60, 126), dtype np.float32
        y: np.ndarray of shape (N,), dtype np.int64
        signers: np.ndarray of shape (N,), dtype object
        labels: np.ndarray of shape (N,), dtype object
        records: list of original sample metadata
    """
    json_files = sorted(glob.glob(os.path.join(data_dir, "*.json")))
    if not json_files:
        raise FileNotFoundError(f"No JSON dataset files found in {data_dir}")
        
    all_frames = []
    all_labels = []
    all_label_ids = []
    all_signers = []
    all_records = []
    
    for jf in json_files:
        with open(jf, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for s in data.get("samples", []):
            label = s["label"]
            if label not in LABEL_TO_ID:
                raise ValueError(f"Unknown label '{label}' not in frozen classes!")
            if s.get("featureSchema") != "wrist_normalized_v1":
                raise ValueError(f"Sample schema '{s.get('featureSchema')}' != wrist_normalized_v1")
                
            frames = s["frames"]
            if len(frames) != 60:
                raise ValueError(f"Frame length {len(frames)} != 60")
                
            all_frames.append(frames)
            all_labels.append(label)
            all_label_ids.append(LABEL_TO_ID[label])
            all_signers.append(s["signerAlias"])
            all_records.append({
                "label": label,
                "signerAlias": s["signerAlias"],
                "cameraFacing": s.get("cameraFacing", "user"),
                "capturedAt": s.get("capturedAt")
            })
            
    X = np.array(all_frames, dtype=np.float32)
    y = np.array(all_label_ids, dtype=np.int64)
    signers = np.array(all_signers, dtype=object)
    labels = np.array(all_labels, dtype=object)
    
    assert X.shape == (len(all_records), 60, 126), f"Unexpected X shape: {X.shape}"
    assert y.shape == (len(all_records),), f"Unexpected y shape: {y.shape}"
    
    return X, y, signers, labels, all_records

def get_signer_split(X, y, signers, labels, target_signer):
    """
    Filters data for a specific signer.
    """
    mask = (signers == target_signer)
    return X[mask], y[mask], signers[mask], labels[mask]

def stratified_train_val_split(X, y, val_ratio=0.2, random_state=42):
    """
    Performs deterministic stratified sequence-level train/val split.
    """
    sss = StratifiedShuffleSplit(n_splits=1, test_size=val_ratio, random_state=random_state)
    train_idx, val_idx = next(sss.split(X, y))
    return (X[train_idx], y[train_idx]), (X[val_idx], y[val_idx]), train_idx, val_idx
