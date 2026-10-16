const form = document.querySelector('#predict-form');
const fields = document.querySelector('#fields');
const results = document.querySelector('#results');
const errorBox = document.querySelector('#error');
const submit = document.querySelector('#submit');
const status = document.querySelector('#status');
let schema;
let revision = 0;
let lastPredictions = null;
const selections = [];
const cardViews = [];
const worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});

function error(message) { errorBox.textContent = message; errorBox.hidden = !message; }
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function inputs() { return [...fields.querySelectorAll('[data-predictor]')]; }
function completion() {
  document.querySelector('#completion').textContent = `${inputs().filter(x => x.value !== '').length} / 26 values entered`;
}
function thresholdText(threshold) {
  return threshold > 1 ? '>100%' : `${(threshold * 100).toFixed(2)}%`;
}
function selectedPoint(i) {
  const selection = selections[i], table = schema.models[i].operating_points;
  return selection.mode === 'youden' ? table.youden : table[selection.mode][selection.target];
}
function updateCard(i) {
  const view = cardViews[i], selection = selections[i], point = selectedPoint(i);
  const prediction = lastPredictions?.[i];
  const name = selection.mode === 'youden' ? 'Youden' : selection.mode === 'sensitivity' ? 'Sensitivity' : 'Specificity';
  view.number.textContent = prediction ? (prediction.probability * 100).toFixed(1) : '—';
  if (prediction) view.number.append(el('small', '', '%'));
  view.fill.setAttribute('width', prediction ? String(prediction.probability * 100) : '0');
  const x = Math.min(100, Math.max(0, point.threshold * 100));
  view.mark.setAttribute('x1', String(x)); view.mark.setAttribute('x2', String(x));
  view.threshold.textContent = `${name} threshold ${thresholdText(point.threshold)}`;
  view.threshold.title = `Full-precision probability threshold: ${point.threshold}`;
  view.decision.textContent = prediction
    ? (prediction.probability >= point.threshold ? 'Model Decision: Positive' : 'Model Decision: Negative')
    : 'Model Decision: —';
  for (const [mode, button] of Object.entries(view.buttons)) {
    button.setAttribute('aria-pressed', String(selection.mode === mode));
  }
  view.targetControls.hidden = selection.mode === 'youden';
  view.targetLabel.textContent = `Target ${selection.mode} (%)`;
  view.range.setAttribute('aria-label', `${schema.models[i].label} target ${selection.mode} slider`);
  view.reference.textContent = `Development reference: sensitivity ${(point.sensitivity * 100).toFixed(1)}%; specificity ${(point.specificity * 100).toFixed(1)}%.`;
}
function buildCards() {
  results.replaceChildren();
  schema.models.forEach((spec, i) => {
    selections.push({mode: 'youden', target: 90});
    const card = el('article', 'result-card');
    card.dataset.outcome = spec.outcome;
    const header = el('header');
    header.append(el('span', 'grade', spec.label), el('span', 'model-tag', spec.family === 'xgboost' ? 'XGBoost' : 'Extra Trees'));
    const number = el('div', 'probability', '—');
    const meter = el('div', 'meter');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 6'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '6'); svg.setAttribute('aria-hidden', 'true');
    const fill = document.createElementNS(ns, 'rect');
    fill.setAttribute('width', '0'); fill.setAttribute('height', '6'); fill.setAttribute('fill', '#116c63');
    const mark = document.createElementNS(ns, 'line');
    for (const [key, value] of Object.entries({x1: spec.threshold * 100, x2: spec.threshold * 100,
      y1: -4, y2: 10, stroke: '#b76b26', 'stroke-width': 2.5, 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke', class: 'threshold-tick'})) mark.setAttribute(key, String(value));
    svg.append(fill, mark); meter.append(svg);
    const bottom = el('div', 'result-bottom');
    const threshold = el('span', 'threshold-text');
    const decision = el('span', 'decision', 'Model Decision: —');
    bottom.append(threshold, decision);
    const controls = el('div', 'operating-controls');
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', `${spec.label} operating point`);
    const modes = el('div', 'threshold-modes'), buttons = {};
    const targetControls = el('div', 'target-controls');
    const targetLabel = el('label', 'target-label'); targetLabel.htmlFor = `target-${spec.outcome}`;
    const sliderRow = el('div', 'target-row');
    const range = el('input', 'target-slider');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.value = '90';
    const numeric = el('input', 'target-number');
    numeric.id = `target-${spec.outcome}`; numeric.type = 'number'; numeric.inputMode = 'numeric';
    numeric.min = '0'; numeric.max = '100'; numeric.step = '1'; numeric.value = '90';
    const targetError = el('p', 'target-error', 'Enter a whole percentage from 0 to 100. Current threshold unchanged.');
    targetError.id = `target-error-${spec.outcome}`; targetError.hidden = true;
    targetError.setAttribute('role', 'alert'); numeric.setAttribute('aria-describedby', targetError.id);
    function targetChanged(value) {
      const target = Number(value);
      if (value === '' || !Number.isInteger(target) || target < 0 || target > 100) {
        numeric.setAttribute('aria-invalid', 'true'); targetError.hidden = false; return;
      }
      selections[i].target = target; range.value = String(target); numeric.value = String(target);
      numeric.removeAttribute('aria-invalid'); targetError.hidden = true; updateCard(i);
    }
    range.addEventListener('input', () => targetChanged(range.value));
    numeric.addEventListener('input', () => targetChanged(numeric.value));
    for (const [mode, label] of [['youden', 'Youden'], ['sensitivity', 'Sensitivity'], ['specificity', 'Specificity']]) {
      const button = el('button', 'threshold-mode', label); button.type = 'button'; button.dataset.mode = mode;
      button.addEventListener('click', () => {
        selections[i].mode = mode; numeric.value = range.value = String(selections[i].target);
        numeric.removeAttribute('aria-invalid'); targetError.hidden = true; updateCard(i);
      });
      buttons[mode] = button; modes.append(button);
    }
    sliderRow.append(range, numeric); targetControls.append(targetLabel, sliderRow, targetError);
    const reference = el('p', 'operating-reference');
    controls.append(modes, targetControls, reference);
    card.append(header, number, meter, bottom, controls); results.append(card);
    cardViews.push({number, fill, mark, threshold, decision, buttons,
                    targetControls, targetLabel, range, reference});
  });
}
function cards(predictions) {
  lastPredictions = predictions ?? null;
  if (!cardViews.length) buildCards();
  schema.models.forEach((_, i) => updateCard(i));
}
function changed() {
  revision += 1; completion(); error(''); cards(null);
  status.textContent = 'Ready'; document.querySelector('#imputation').hidden = true;
}
function buildForm() {
  fields.replaceChildren();
  let currentGroup, grid;
  for (const f of schema.fields) {
    if (f.group !== currentGroup) {
      currentGroup = f.group;
      const set = el('fieldset'); set.append(el('legend', '', f.group));
      grid = el('div', 'field-grid'); set.append(grid); fields.append(set);
    }
    const box = el('div', 'field');
    const label = el('label', '', f.label); label.htmlFor = `field-${f.key}`; label.title = f.description;
    if (f.unit) label.append(el('small', '', f.unit));
    const input = el(f.key === 'sex' ? 'select' : 'input');
    input.id = `field-${f.key}`; input.dataset.predictor = f.key;
    if (f.key === 'sex') {
      for (const [value, text] of [['', 'Not entered'], ['0', 'Female'], ['1', 'Male']]) {
        const option = el('option', '', text); option.value = value; input.append(option);
      }
    } else {
      input.type = 'number'; input.step = 'any'; input.min = f.key === 'BMI' ? '0.01' : '0';
      if (f.key === 'NEU%') input.max = '100';
      input.placeholder = 'Not entered'; input.inputMode = 'decimal';
    }
    input.addEventListener('input', changed); box.append(label, input); grid.append(box);
  }
  const helper = el('details', 'bmi-helper'); helper.append(el('summary', '', 'Calculate BMI from height and weight'));
  const row = el('div', 'bmi-grid');
  for (const [key, text] of [['height', 'Height (cm)'], ['weight', 'Weight (kg)']]) {
    const box = el('div', 'field'); const label = el('label', '', text); label.htmlFor = key;
    const input = el('input'); input.id = key; input.type = 'number'; input.min = '0.01'; input.step = 'any';
    box.append(label, input); row.append(box);
  }
  const button = el('button', '', 'Use BMI'); button.type = 'button';
  button.addEventListener('click', () => {
    const h = Number(document.querySelector('#height').value), w = Number(document.querySelector('#weight').value);
    if (!(h > 0 && w > 0)) return error('Enter positive height and weight values.');
    const bmi = w / ((h / 100) ** 2);
    if (!Number.isFinite(bmi)) return error('Height and weight do not produce a finite BMI.');
    document.querySelector('#field-BMI').value = String(bmi); changed();
  });
  row.append(button); helper.append(row); fields.querySelector('fieldset').append(helper);
}
document.querySelector('#example').addEventListener('click', () => {
  inputs().forEach(input => { input.value = schema.example[input.dataset.predictor]; }); changed();
});
document.querySelector('#clear').addEventListener('click', () => { form.reset(); changed(); });
form.addEventListener('submit', event => {
  event.preventDefault(); error(''); submit.disabled = true; status.textContent = 'Calculating';
  const predictors = Object.fromEntries(inputs().map(input => [input.dataset.predictor, input.value === '' ? null : Number(input.value)]));
  worker.postMessage({type: 'predict', id: revision, predictors});
});
worker.addEventListener('message', ({data}) => {
  if (data.type === 'ready') {
    schema = data.manifest; buildForm(); cards(null); completion(); status.textContent = 'Ready';
    submit.disabled = false;
    document.querySelector('#example').disabled = false; document.querySelector('#clear').disabled = false;
  } else if (data.type === 'prediction') {
    submit.disabled = false;
    if (data.id !== revision) return;
    cards(data.results); status.textContent = 'Calculated';
    const note = document.querySelector('#imputation'); note.hidden = !data.imputed_fields.length;
    note.textContent = `Imputed fields: ${data.imputed_fields.join(', ')}.`;
  } else if (data.type === 'error') {
    error(data.error); status.textContent = 'Unable to calculate'; submit.disabled = !schema;
  }
});
worker.addEventListener('error', () => {
  error('The model worker could not start. Use a current browser and an HTTPS or localhost address.');
  status.textContent = 'Unavailable'; submit.disabled = true;
});
worker.postMessage({type: 'init'});
