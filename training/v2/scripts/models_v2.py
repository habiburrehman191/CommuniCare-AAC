import keras
from keras import layers

def build_gru_v2(input_shape=(24, 252), num_classes=8, lr=0.001):
    inputs = keras.Input(shape=input_shape, name="input_frames")
    x = layers.GRU(64, dropout=0.2, recurrent_dropout=0.0, name="gru_layer")(inputs)
    x = layers.Dense(32, activation="relu", name="dense_intermediate")(x)
    x = layers.Dropout(0.2, name="dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
    
    model = keras.Model(inputs=inputs, outputs=outputs, name=f"V2_GRU_{input_shape[0]}x{input_shape[1]}")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=lr),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def build_conv1d_gru_v2(input_shape=(24, 252), num_classes=8, lr=0.001):
    inputs = keras.Input(shape=input_shape, name="input_frames")
    x = layers.Conv1D(filters=32, kernel_size=3, padding="same", activation="relu", name="conv1d_layer")(inputs)
    x = layers.Dropout(0.2, name="conv_dropout")(x)
    x = layers.GRU(64, dropout=0.2, recurrent_dropout=0.0, name="gru_layer")(x)
    x = layers.Dense(32, activation="relu", name="dense_intermediate")(x)
    x = layers.Dropout(0.2, name="dense_dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="probabilities")(x)
    
    model = keras.Model(inputs=inputs, outputs=outputs, name=f"V2_Conv1D_GRU_{input_shape[0]}x{input_shape[1]}")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=lr),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model
