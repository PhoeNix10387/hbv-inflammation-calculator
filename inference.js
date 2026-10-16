// Prediction-only runtime. Float32 feature conversion matches both tree libraries.
export function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const exp = Math.exp(z);
  return exp / (1 + exp);
}

export function predictModel(model, values) {
  const x = model.columns.map((column, i) => Math.fround(values[column] ?? model.imputation[i]));
  let raw;
  if (model.family === "xgboost") {
    let margin = Math.fround(model.base_margin);
    for (const tree of model.trees) {
      let node = 0;
      while (tree.left[node] !== -1) {
        node = x[tree.feature[node]] < Math.fround(tree.value[node]) ? tree.left[node] : tree.right[node];
      }
      margin = Math.fround(margin + Math.fround(tree.value[node]));
    }
    // Match XGBoost's single-precision logistic transform before calibration.
    const exp = Math.fround(Math.exp(-margin));
    raw = Math.fround(1 / Math.fround(1 + exp));
  } else if (model.family === "extra_trees") {
    let sum = 0;
    for (const tree of model.trees) {
      let node = 0;
      while (tree.left[node] !== -1) {
        node = x[tree.feature[node]] <= tree.value[node] ? tree.left[node] : tree.right[node];
      }
      sum += tree.probability[node];
    }
    raw = sum / model.trees.length;
  } else throw new Error("Unsupported frozen model.");
  raw = Math.max(model.epsilon, Math.min(1 - model.epsilon, raw));
  const score = Math.log(raw / (1 - raw));
  const probability = sigmoid(model.calibration.intercept + model.calibration.slope * score);
  if (!Number.isFinite(probability)) throw new Error("The model returned a non-finite probability.");
  return {probability, threshold: model.threshold, positive: probability >= model.threshold};
}

export function validateInput(data, fields) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Enter one sample's predictor values.");
  const keys = new Set(fields.map(f => f.key));
  if (Object.keys(data).some(key => !keys.has(key))) throw new Error("An unrecognised predictor was supplied.");
  const values = {};
  const missing = [];
  for (const field of fields) {
    const value = data[field.key];
    if (value === null || value === undefined || value === "") {
      values[field.key] = null; missing.push(field.label); continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field.label} must be a finite, non-negative number.`);
    if (field.key === "sex" && value !== 0 && value !== 1) throw new Error("Select female or male for sex.");
    if (field.key === "NEU%" && value > 100) throw new Error("Neutrophil percentage must be between 0 and 100.");
    if (field.key === "BMI" && value <= 0) throw new Error("BMI must be greater than zero.");
    values[field.key] = value;
  }
  if (missing.length === fields.length) throw new Error("Enter predictor values or load the synthetic example.");
  return {values, missing};
}
