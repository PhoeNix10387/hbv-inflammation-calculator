import {predictModel, validateInput} from "./inference.js";
let manifest;
let models;
self.addEventListener("message", async ({data}) => {
  try {
    if (data.type === "init") {
      const response = await fetch("./manifest.json", {cache: "no-cache"});
      if (!response.ok) throw new Error("Model information could not be loaded.");
      manifest = await response.json();
      models = await Promise.all(manifest.models.map(async spec => {
        const response = await fetch(`./${spec.file}`, {cache: "no-cache"});
        if (!response.ok) throw new Error("A frozen model could not be loaded.");
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
        if (sha !== spec.sha256) throw new Error("A model file failed its integrity check. Please reload the page.");
        const model = JSON.parse(new TextDecoder().decode(bytes));
        if (model.family !== spec.family || model.threshold !== spec.threshold) throw new Error("Model information is inconsistent.");
        return model;
      }));
      self.postMessage({type: "ready", manifest});
    } else if (data.type === "predict") {
      if (!models) throw new Error("Models are still loading.");
      const {values, missing} = validateInput(data.predictors, manifest.fields);
      const results = models.map((model, i) => ({...predictModel(model, values), label: manifest.models[i].label,
                                                 family: manifest.models[i].family}));
      self.postMessage({type: "prediction", id: data.id, results, imputed_fields: missing});
    }
  } catch (exc) {
    self.postMessage({type: "error", id: data.id, error: exc.message});
  }
});
