# Model Selection Report

## 1. Research Overview
- **Run A**: Trained on signer-01 (243 samples), Tested on held-out signer-02 (240 samples).
- **Run B**: Trained on signer-02 (240 samples), Tested on held-out signer-01 (243 samples).

## 2. Quantitative Summary

| Architecture | Run A Test Acc | Run A Macro F1 | Run B Test Acc | Run B Macro F1 | Mean Test Acc | Mean Macro F1 | Acc Difference |
|---|---|---|---|---|---|---|---|
| **GRU** | 0.6333 | 0.5844 | 0.4774 | 0.4612 | 0.5553 | 0.5228 | 0.1560 |
| **LSTM** | 0.5583 | 0.4792 | 0.4774 | 0.4752 | 0.5178 | 0.4772 | 0.0810 |

## 3. NO_SIGN Safety Metrics

| Architecture | Run A NO_SIGN Recall | Run A False Act Rate | Run B NO_SIGN Recall | Run B False Act Rate |
|---|---|---|---|---|
| **GRU** | 0.1667 | 0.8333 | 0.7097 | 0.2903 |
| **LSTM** | 0.2000 | 0.8000 | 0.8710 | 0.1290 |
