import tensorflow as tf
from tensorflow.keras import layers, models

def build_candidate_model(candidate_key):
    """
    Builds one of the 6 bounded model candidates:
    A: 24-frame Conv1D 32, GRU 64
    B: 24-frame Conv1D 48, GRU 64
    C: 24-frame Conv1D 32, GRU 48
    D: 24-frame 2 Conv1D (32 + 32), GRU 64
    E: 30-frame Conv1D 32, GRU 64
    F: 24-frame pure GRU 64
    """
    num_classes = 8
    
    if candidate_key == "A":
        # Candidate A: 24-frame pos_vel Conv1D 32, GRU 64
        inp = layers.Input(shape=(24, 252), name="input_frames")
        x = layers.Conv1D(32, kernel_size=3, padding="same", activation="relu")(inp)
        x = layers.Dropout(0.2)(x)
        x = layers.GRU(64, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_A_conv32_gru64_w24"

    elif candidate_key == "B":
        # Candidate B: 24-frame pos_vel Conv1D 48, GRU 64
        inp = layers.Input(shape=(24, 252), name="input_frames")
        x = layers.Conv1D(48, kernel_size=3, padding="same", activation="relu")(inp)
        x = layers.Dropout(0.2)(x)
        x = layers.GRU(64, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_B_conv48_gru64_w24"

    elif candidate_key == "C":
        # Candidate C: 24-frame pos_vel Conv1D 32, GRU 48
        inp = layers.Input(shape=(24, 252), name="input_frames")
        x = layers.Conv1D(32, kernel_size=3, padding="same", activation="relu")(inp)
        x = layers.Dropout(0.2)(x)
        x = layers.GRU(48, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_C_conv32_gru48_w24"

    elif candidate_key == "D":
        # Candidate D: 24-frame pos_vel 2 lightweight Conv1D layers (32, 32), GRU 64
        inp = layers.Input(shape=(24, 252), name="input_frames")
        x = layers.Conv1D(32, kernel_size=3, padding="same", activation="relu")(inp)
        x = layers.Dropout(0.2)(x)
        x = layers.Conv1D(32, kernel_size=3, padding="same", activation="relu")(x)
        x = layers.Dropout(0.2)(x)
        x = layers.GRU(64, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_D_2conv32_gru64_w24"

    elif candidate_key == "E":
        # Candidate E: 30-frame pos_vel Conv1D 32, GRU 64
        inp = layers.Input(shape=(30, 252), name="input_frames")
        x = layers.Conv1D(32, kernel_size=3, padding="same", activation="relu")(inp)
        x = layers.Dropout(0.2)(x)
        x = layers.GRU(64, return_sequences=False)(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_E_conv32_gru64_w30"

    elif candidate_key == "F":
        # Candidate F: 24-frame pos_vel pure GRU 64 baseline
        inp = layers.Input(shape=(24, 252), name="input_frames")
        x = layers.GRU(64, return_sequences=False)(inp)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(32, activation="relu")(x)
        out = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
        name = "candidate_F_pure_gru64_w24"

    else:
        raise ValueError(f"Unknown candidate key: {candidate_key}")

    model = models.Model(inputs=inp, outputs=out, name=name)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def get_candidate_specs(candidate_key):
    specs = {
        "A": {"name": "Conv1D(32) + GRU(64)", "window": 24, "features": 252, "desc": "24-frame pos_vel, Conv1D 32, GRU 64"},
        "B": {"name": "Conv1D(48) + GRU(64)", "window": 24, "features": 252, "desc": "24-frame pos_vel, Conv1D 48, GRU 64"},
        "C": {"name": "Conv1D(32) + GRU(48)", "window": 24, "features": 252, "desc": "24-frame pos_vel, Conv1D 32, GRU 48"},
        "D": {"name": "2x Conv1D(32) + GRU(64)", "window": 24, "features": 252, "desc": "24-frame pos_vel, 2 lightweight Conv1D layers, GRU 64"},
        "E": {"name": "Conv1D(32) + GRU(64) [30-frame]", "window": 30, "features": 252, "desc": "30-frame pos_vel, Conv1D 32, GRU 64"},
        "F": {"name": "Pure GRU(64) Baseline", "window": 24, "features": 252, "desc": "24-frame pos_vel, pure GRU 64 baseline"}
    }
    return specs[candidate_key]
