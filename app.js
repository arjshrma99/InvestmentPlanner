"use strict";

const STATE_KEY = "investment-calculator-pwa-state-v2";
const LONG_TERM_YEAR_LIMIT = 80;
const SIMULATION_YEAR_LIMIT = 100;

const controls = {};
const state = {
  activeTab: "cross",
  crossInitialEnabled: true,
  crossTransferEnabled: true,
  crossExternalSipEnabled: false,
  crossWithdrawalEnabled: false,
  crossFinishPortfolioEnabled: false,
  withdrawalFinishPortfolioEnabled: false,
  values: {},
};

const controlConfigs = [
  { id: "crossInitial", group: "cross-inputs", label: "Lumpsum Investment", help: "Starting capital in the source portfolio.", min: 0, max: 100000000, value: 1000000, type: "currency", checkboxId: "cross-initial-enabled" },
  { id: "crossGrowth", group: "cross-inputs", label: "Initial Investment Growth Rate", help: "Expected annual return of the source portfolio.", min: 0, max: 50, value: 10, type: "percent" },
  { id: "crossMonthlyTransfer", group: "cross-inputs", label: "Add Monthly Transfer to SIP Portfolio", help: "Monthly amount moved from the source portfolio into the SIP portfolio.", min: 0, max: 1000000, value: 50000, type: "currency", log: true, checkboxId: "cross-transfer-enabled" },
  { id: "crossExternalMonthly", group: "cross-inputs", label: "Monthly SIP", help: "Monthly SIP added from outside the source portfolio.", min: 0, max: 1000000, value: 10000, type: "currency", log: true, checkboxId: "cross-external-sip-enabled" },
  { id: "crossExternalPeriod", group: "cross-inputs", label: "Additional SIP Investment Period", help: "Number of years additional SIP contributions continue.", min: 1, max: 100, value: 20, type: "integer", suffix: "years" },
  { id: "crossSipRate", group: "cross-inputs", label: "SIP Portfolio Growth Rate", help: "Expected annual return used for both monthly SIP transfer and monthly external SIP portfolios.", min: 0, max: 50, value: 12, type: "percent" },
  { id: "crossWithdrawalStart", group: "cross-withdrawal-inputs", label: "Start Withdrawals After", help: "Withdrawals begin after this many completed years.", min: 0, max: 100, value: 10, type: "integer", suffix: "years" },
  { id: "crossWithdrawalIncrement", group: "cross-withdrawal-inputs", label: "Annual Withdrawal Increase", help: "Annual withdrawal increase, converted to a monthly increment internally.", min: 0, max: 50, value: 0, type: "percent" },
  { id: "crossWithdrawalAmount", group: "cross-withdrawal-inputs", label: "Monthly Withdrawal", help: "First month withdrawal amount, consumed from SIP portfolio first.", min: 0, max: 10000000, value: 50000, type: "currency", log: true },
  {
    id: "crossMaxPeriod",
    group: "cross-projection-inputs",
    label: "Projection Period",
    help: "Overall projection length in years.",
    min: 1,
    max: 100,
    value: 20,
    type: "integer",
    suffix: "years",
  },

  { id: "withdrawalLumpsum", group: "withdrawal-inputs", label: "Starting Portfolio", help: "Starting corpus available for systematic withdrawals.", min: 1000000, max: 100000000, value: 1000000, type: "currency" },
  { id: "withdrawalGrowth", group: "withdrawal-inputs", label: "Expected Annual Return", help: "Expected annual return on the remaining corpus, compounded monthly.", min: 0, max: 50, value: 10, type: "percent" },
  { id: "withdrawalIncrement", group: "withdrawal-inputs", label: "Annual Withdrawal Increase", help: "Annual withdrawal increase, converted to a monthly increment internally.", min: 0, max: 50, value: 6, type: "percent" },
  { id: "withdrawalMonthly", group: "withdrawal-inputs", label: "Starting Monthly Withdrawal", help: "First month withdrawal amount before increment adjustments.", min: 0, max: 10000000, value: 50000, type: "currency", log: true },
  {
    id: "withdrawalMaxPeriod",
    group: "withdrawal-max-period-inputs",
    label: "Projection Period",
    help: "Projection length in years.",
    min: 1,
    max: 100,
    value: 20,
    type: "integer",
    suffix: "years",
  },
];

const metricHelp = {
  "Total Invested": "Total amount invested through initial investment and monthly contributions.",
  "Total Investment": "Total starting and external contribution amount invested into the plan.",
  "Estimated Profit": "Final amount plus withdrawals minus total investment.",
  "Portfolio After 80 Years": "Projected portfolio balance remaining after 80 years of withdrawals.",
  "Source Portfolio": "Projected value remaining in the original source portfolio.",
  "SIP Portfolio": "Projected value accumulated in the transferred SIP portfolio.",
  "External SIP Portfolio": "Projected value accumulated from external SIP contributions.",
  "Portfolio Lasts": "Estimated years the corpus can support the selected withdrawal settings.",
  "Sustainable Monthly Withdrawal": "Maximum starting monthly withdrawal that keeps the portfolio alive for at least 80 years.",
  "Maximum Monthly Withdrawal": "Maximum starting monthly withdrawal for the selected projection.",
  "Total Withdrawn": "Total amount actually withdrawn during the simulated period.",
  "Portfolio After": "Projected corpus left after withdrawals over the selected period.",
  "Status After": "Whether the portfolio is active or closed at the selected maximum period.",
  "Remaining Portfolio": "Projected corpus left after withdrawals over the selected period.",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function minClamp(value, min) {
  return Math.max(min, value);
}

function formatInr(value) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);

  if (absolute >= 10000000) {
    const crore = absolute / 10000000;
    let formatted;

    if (crore >= 9900000) {
      const exponent = Math.floor(Math.log10(crore));
      const mantissa = crore / (10 ** exponent);
      formatted = `${mantissa.toFixed(2).replace(/\.?0+$/, "")} x 10<sup>${exponent}</sup>`;
    } else {
      formatted = crore < 100
        ? crore.toFixed(1).replace(/\.0$/, "")
        : Math.round(crore).toLocaleString("en-IN");
    }

    return `${sign}₹ ${formatted} Cr`;
  }

  return `${sign}₹ ${absolute.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatInrFull(value) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₹ ${Math.abs(rounded).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function sliderToValue(config, sliderValue) {
  const raw = Number(sliderValue);

  if (config.log) {
    if (config.min <= 0) {
      if (raw === 0) return config.min;
      const ratio = raw / 1000;
      return Math.round(10 ** (Math.log10(1) + ratio * (Math.log10(config.max) - Math.log10(1))));
    }

    const ratio = raw / 1000;
    return Math.round(10 ** (Math.log10(config.min) + ratio * (Math.log10(config.max) - Math.log10(config.min))));
  }

  const ratio = raw / 1000;
  const value = config.min + ratio * (config.max - config.min);
  return config.type === "integer" || config.type === "currency" ? Math.round(value) : value;
}

function valueToSlider(config, value) {
  const clean = clamp(Number(value), config.min, config.max);

  if (config.max === config.min) return 0;

  if (config.log) {
    if (config.min <= 0) {
      if (clean <= config.min) return 0;
      return Math.round(((Math.log10(Math.max(clean, 1)) - Math.log10(1)) / (Math.log10(config.max) - Math.log10(1))) * 1000);
    }

    return Math.round(((Math.log10(clean) - Math.log10(config.min)) / (Math.log10(config.max) - Math.log10(config.min))) * 1000);
  }

  return Math.round(((clean - config.min) / (config.max - config.min)) * 1000);
}

function formatControlValue(config, value) {
  if (config.type === "currency") return formatInrFull(value);
  if (config.type === "percent") return `${Number(value).toFixed(2)}%`;
  if (config.type === "integer") return `${Math.round(value)} ${config.suffix || ""}`.trim();
  return String(value);
}

function parseControlValue(config, text) {
  let clean = String(text)
    .replace(/[₹,%]/g, "")
    .replace(config.suffix || "", "")
    .replace(/,/g, "")
    .trim();

  if (clean.toLowerCase().endsWith("cr")) {
    clean = clean.slice(0, -2).trim();
    return minClamp(Math.round(Number(clean) * 10000000), config.min);
  }

  let value = Number(clean);
  if (!Number.isFinite(value)) value = config.value;
  value = clamp(value, config.min, config.max);
  return config.type === "currency" || config.type === "integer" ? Math.round(value) : value;
}

function getValue(id) {
  return controls[id].value;
}

function getSipMonthlyValue() {
  return state.sipMonthlyEnabled ? getValue("sipMonthly") : 0;
}

function getCrossInitialValue() {
  return state.crossInitialEnabled ? getValue("crossInitial") : 0;
}

function getCrossTransferValue() {
  return state.crossInitialEnabled && state.crossTransferEnabled ? getValue("crossMonthlyTransfer") : 0;
}

function getCrossExternalSipValue() {
  return state.crossExternalSipEnabled ? getValue("crossExternalMonthly") : 0;
}

function updateSipMonthlyAvailability() {
  if (!controls.sipMonthly) return;

  const monthlyControl = controls.sipMonthly;
  const disabled = !state.sipMonthlyEnabled;
  monthlyControl.row.classList.toggle("control-disabled", disabled);
  monthlyControl.input.disabled = disabled;
  monthlyControl.slider.disabled = disabled;
}

function setControlDisabled(id, disabled) {
  if (!controls[id]) return;

  const control = controls[id];
  control.row.classList.toggle("control-disabled", disabled);
  control.input.disabled = disabled;
  control.slider.disabled = disabled;
}

function setControlFieldsHidden(id, hidden) {
  if (!controls[id]) return;

  controls[id].input.hidden = hidden;
  controls[id].slider.hidden = hidden;
}

function setControlRowHidden(id, hidden) {
  if (!controls[id]) return;

  controls[id].row.hidden = hidden;
}

function updateCrossWithdrawalAvailability() {
  const crossCheckbox = document.getElementById("cross-withdrawal-enabled");
  const crossInputs = document.getElementById("cross-withdrawal-inputs");
  const crossOptions = document.getElementById("cross-withdrawal-options");
  const projectionInputs = document.getElementById("cross-projection-inputs");
  const withdrawalBox = document.getElementById("cross-withdrawal-box");
  const projectionBox = document.getElementById("cross-projection-box");
  const available = Boolean(state.crossInitialEnabled || state.crossExternalSipEnabled);
  const hasSip = Boolean((state.crossInitialEnabled && state.crossTransferEnabled) || state.crossExternalSipEnabled);

  if (!crossCheckbox || !crossInputs || !crossOptions || !projectionInputs || !withdrawalBox || !projectionBox) return;

  projectionInputs.hidden = !available;
  projectionBox.hidden = !available;
  withdrawalBox.hidden = !available;
  withdrawalBox.classList.toggle("section-box-active", available && state.crossWithdrawalEnabled);
  setControlRowHidden("crossMaxPeriod", !available);
  setControlRowHidden("crossSipRate", !hasSip);
  if (!available) {
    state.crossWithdrawalEnabled = false;
    crossCheckbox.checked = false;
  }
  crossInputs.hidden = !available || !state.crossWithdrawalEnabled;
  crossOptions.hidden = !available || !state.crossWithdrawalEnabled;
}

function updateCrossInitialAvailability() {
  if (!controls.crossInitial) return;

  const initialBox = document.getElementById("cross-initial-box");
  if (initialBox) {
    initialBox.classList.toggle("section-box-active", state.crossInitialEnabled);
  }
  setControlDisabled("crossInitial", !state.crossInitialEnabled);
  setControlFieldsHidden("crossInitial", !state.crossInitialEnabled);
  setControlDisabled("crossGrowth", !state.crossInitialEnabled);
  setControlRowHidden("crossGrowth", !state.crossInitialEnabled);
  setControlRowHidden("crossMonthlyTransfer", !state.crossInitialEnabled);

  const transferCheckbox = document.getElementById("cross-transfer-enabled");
  if (!state.crossInitialEnabled) {
    state.crossTransferEnabled = false;
    if (transferCheckbox) transferCheckbox.checked = false;
  }
  if (transferCheckbox) {
    transferCheckbox.disabled = !state.crossInitialEnabled;
  }
  updateCrossExternalSipLabel();
  updateCrossTransferAvailability();
  updateCrossWithdrawalAvailability();
}

function updateCrossExternalSipLabel() {
  const externalCheckbox = document.getElementById("cross-external-sip-enabled");
  const labelText = externalCheckbox?.closest(".check-row")?.querySelector("span");
  const periodLabelText = controls.crossExternalPeriod?.row.querySelector(".input-header label span");

  if (labelText) {
    labelText.textContent = state.crossInitialEnabled ? "Additional Monthly SIP" : "Monthly SIP";
  }

  if (periodLabelText) {
    periodLabelText.textContent = state.crossInitialEnabled ? "Additional SIP Investment Period" : "SIP Investment Period";
  }
}

function updateCrossTransferAvailability() {
  if (!controls.crossMonthlyTransfer) return;

  if (!state.crossInitialEnabled) {
    setControlRowHidden("crossMonthlyTransfer", true);
    setControlRowHidden("crossSipRate", true);
    return;
  }

  const disabled = !state.crossInitialEnabled || !state.crossTransferEnabled;
  setControlDisabled("crossMonthlyTransfer", disabled);
  setControlFieldsHidden("crossMonthlyTransfer", !state.crossTransferEnabled);
  updateCrossWithdrawalAvailability();
}

function updateCrossExternalSipAvailability() {
  if (!controls.crossExternalMonthly) return;

  const externalBox = document.getElementById("cross-external-box");
  if (externalBox) {
    externalBox.hidden = controls.crossExternalMonthly.row.hidden;
    externalBox.classList.toggle("section-box-active", state.crossExternalSipEnabled);
  }
  setControlDisabled("crossExternalMonthly", !state.crossExternalSipEnabled);
  setControlFieldsHidden("crossExternalMonthly", !state.crossExternalSipEnabled);
  setControlDisabled("crossExternalPeriod", !state.crossExternalSipEnabled);
  setControlRowHidden("crossExternalPeriod", !state.crossExternalSipEnabled);
  updateCrossWithdrawalAvailability();
}

function updateCrossWithdrawalStartLimit() {
  if (!controls.crossMaxPeriod || !controls.crossWithdrawalStart) return;

  const startControl = controls.crossWithdrawalStart;
  const maxStartYear = Math.max(0, Math.round(getValue("crossMaxPeriod")) - 1);
  startControl.config.max = maxStartYear;

  if (startControl.value > maxStartYear) {
    startControl.value = maxStartYear;
    startControl.input.value = formatControlValue(startControl.config, maxStartYear);
    state.values.crossWithdrawalStart = maxStartYear;
  }

  startControl.slider.value = valueToSlider(startControl.config, startControl.value);
}

function updateCrossExternalPeriodLimit() {
  if (!controls.crossMaxPeriod || !controls.crossExternalPeriod) return;

  const externalPeriodControl = controls.crossExternalPeriod;
  const maxPeriod = Math.round(getValue("crossMaxPeriod"));
  externalPeriodControl.config.max = maxPeriod;

  if (externalPeriodControl.value > maxPeriod) {
    externalPeriodControl.value = maxPeriod;
    externalPeriodControl.input.value = formatControlValue(externalPeriodControl.config, maxPeriod);
    state.values.crossExternalPeriod = maxPeriod;
  }

  externalPeriodControl.slider.value = valueToSlider(externalPeriodControl.config, externalPeriodControl.value);
}

function updateSipPeriodAvailability() {
  if (!controls.sipMonthly || !controls.sipPeriod) return;

  const periodControl = controls.sipPeriod;
  periodControl.row.classList.remove("is-disabled");
  periodControl.input.disabled = false;
  periodControl.slider.disabled = false;
}

function setValue(id, value, shouldSave = true) {
  const control = controls[id];
  const config = control.config;
  const clean = parseControlValue(config, value);
  control.value = clean;
  control.slider.value = valueToSlider(config, clean);
  control.input.value = formatControlValue(config, clean);
  state.values[id] = clean;

  if (id === "sipMonthly") {
    updateSipMonthlyAvailability();
    updateSipPeriodAvailability();
  }

  if (id === "crossMonthlyTransfer") {
    updateCrossTransferAvailability();
  }

  if (id === "crossInitial") {
    updateCrossInitialAvailability();
  }

  if (id === "crossExternalMonthly") {
    updateCrossExternalSipAvailability();
  }

  if (id === "crossMaxPeriod") {
    updateCrossWithdrawalStartLimit();
    updateCrossExternalPeriodLimit();
  }

  if (shouldSave) {
    calculateAll();
    saveState();
  }
}

function showTooltipModal(text) {
  let modal = document.getElementById("tooltip-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "tooltip-modal";
    modal.className = "tooltip-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="tooltip-popup" role="dialog" aria-modal="true">
        <div class="tooltip-text"></div>
      </div>
    `;
    document.body.append(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.hidden = true;
      }
    });
  }

  modal.querySelector(".tooltip-text").textContent = text || "";
  modal.hidden = false;
}

function createControl(config) {
  let host = document.getElementById(config.group);
  const row = document.createElement("div");
  row.className = "input-row";

  const header = document.createElement("div");
  header.className = "input-header";

  let label;

  if (config.checkboxId) {
    label = document.createElement("label");
    label.className = "check-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = config.checkboxId;

    const text = document.createElement("span");
    text.textContent = config.label;

    label.append(checkbox, text);
  } else {
    label = document.createElement("label");

    const text = document.createElement("span");
    text.textContent = config.label;
    label.append(text);
  }

  if (config.help) {
    const help = document.createElement("button");
    help.className = "info-button";
    help.type = "button";
    help.textContent = "!";
    help.setAttribute("aria-label", `${config.label} info`);
    help.dataset.tooltip = config.help;
    help.addEventListener("pointerdown", (event) => event.stopPropagation());
    help.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showTooltipModal(help.dataset.tooltip);
    });
    label.append(help);
  }

  const input = document.createElement("input");
  input.className = "value-input";
  input.id = `${config.id}-input`;
  input.inputMode = config.type === "currency" || config.type === "integer" ? "numeric" : "decimal";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1000";
  slider.step = "1";

  header.append(label, input);
  row.append(header, slider);

  if (config.id === "crossInitial") {
    const box = document.createElement("div");
    box.className = "section-box";
    box.id = "cross-initial-box";
    host.append(box);
    host = box;
  }
  if (["crossGrowth", "crossMonthlyTransfer"].includes(config.id)) {
    const box = document.getElementById("cross-initial-box");
    if (box) host = box;
  }
  if (config.id === "crossExternalMonthly") {
    const box = document.createElement("div");
    box.className = "section-box";
    box.id = "cross-external-box";
    host.append(box);
    host = box;
  }
  if (config.id === "crossExternalPeriod") {
    const box = document.getElementById("cross-external-box");
    if (box) host = box;
  }

  host.append(row);

  controls[config.id] = { config, row, slider, input, value: config.value };

  slider.addEventListener("input", () => setValue(config.id, sliderToValue(config, slider.value)));
  input.addEventListener("focus", () => {
    input.value = String(controls[config.id].value);
    input.select();
  });
  input.addEventListener("click", () => input.select());
  input.addEventListener("change", () => setValue(config.id, input.value));
  input.addEventListener("blur", () => setValue(config.id, input.value));

  setValue(config.id, state.values[config.id] ?? config.value, false);
}

function createInfoButton(label, text) {
  const help = document.createElement("button");
  help.className = "info-button";
  help.type = "button";
  help.textContent = "!";
  help.setAttribute("aria-label", `${label} info`);
  help.dataset.tooltip = text;
  help.addEventListener("pointerdown", (event) => event.stopPropagation());
  help.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showTooltipModal(help.dataset.tooltip);
  });
  return help;
}

function metric(label, value, options = {}) {
  const helpText = options.help || metricHelp[label] || (
    label.startsWith("Status After") ? metricHelp["Status After"] :
    label.startsWith("Portfolio After") ? metricHelp["Portfolio After"] : ""
  );
  const helpButton = helpText
    ? `<button class="info-button" type="button" aria-label="${label} info" data-tooltip="${helpText}">!</button>`
    : "";

  return `
    <div class="metric${options.hidden ? " hidden" : ""}">
      <div class="metric-label">${label}${helpButton}</div>
      <div class="metric-value${options.danger ? " danger" : ""}"${options.color ? ` style="color:${options.color}"` : ""}>${value}</div>
    </div>
  `;
}

function colorForWithdrawalYears(years) {
  const cleanYears = clamp(Number(years), 1, 80);
  const red = [248, 113, 113];
  const green = [52, 211, 153];
  const ratio = cleanYears < 25 ? (cleanYears - 1) / 29 : 1;
  const rgb = red.map((start, index) => Math.round(start + (green[index] - start) * ratio));
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function simulatePortfolioWithdrawal(startBalance, annualRate, monthlyWithdrawal, monthLimit, incrementRate = 0) {
  let balance = startBalance;
  let totalWithdrawn = 0;
  let depletedMonth = null;
  const monthlyGrowthRate = (1 + annualRate) ** (1 / 12) - 1;
  const monthlyIncrementRate = (1 + incrementRate) ** (1 / 12) - 1;

  for (let month = 1; month <= monthLimit; month += 1) {
    balance *= 1 + monthlyGrowthRate;
    const adjustedWithdrawal = monthlyWithdrawal * ((1 + monthlyIncrementRate) ** (month - 1));

    if (balance >= adjustedWithdrawal) {
      balance -= adjustedWithdrawal;
      totalWithdrawn += adjustedWithdrawal;
    } else {
      totalWithdrawn += balance;
      balance = 0;
      depletedMonth = month;
      break;
    }
  }

  return { balance, totalWithdrawn, depletedMonth };
}

function maxMonthlyWithdrawalFromPortfolio(startBalance, annualRate, years, incrementRate = 0) {
  const targetMonths = years * 12;
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  let low = 0;
  let high = startBalance * (1 + monthlyRate);

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const result = simulatePortfolioWithdrawal(startBalance, annualRate, mid, targetMonths, incrementRate);
    if (result.depletedMonth) high = mid;
    else low = mid;
  }

  return low;
}

function simulateSipWithdrawalPlan(monthlyWithdrawal, withdrawalMonthsLimit) {
  const lumpsum = getValue("sipLumpsum");
  const sip = getSipMonthlyValue();
  const annualRate = getValue("sipRate") / 100;
  const incrementRate = getValue("sipWithdrawalIncrement") / 100;
  const sipMonths = Math.round(getValue("sipPeriod")) * 12;
  const withdrawalStartMonth = Math.round(getValue("sipWithdrawalStart")) * 12;
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  const monthlyIncrementRate = (1 + incrementRate) ** (1 / 12) - 1;
  const totalMonths = withdrawalStartMonth + withdrawalMonthsLimit;

  let balance = lumpsum;
  let totalWithdrawn = 0;
  let depletedMonth = null;

  for (let month = 1; month <= totalMonths; month += 1) {
    if (month <= sipMonths) {
      balance += sip;
    }

    balance *= 1 + monthlyRate;

    if (month > withdrawalStartMonth) {
      const withdrawalMonth = month - withdrawalStartMonth;
      const adjustedWithdrawal = monthlyWithdrawal * ((1 + monthlyIncrementRate) ** (withdrawalMonth - 1));

      if (balance >= adjustedWithdrawal) {
        balance -= adjustedWithdrawal;
        totalWithdrawn += adjustedWithdrawal;
      } else {
        totalWithdrawn += balance;
        balance = 0;
        depletedMonth = month - withdrawalStartMonth;
        break;
      }
    }
  }

  return { balance, totalWithdrawn, depletedMonth };
}

function maxSipMonthlyWithdrawalForYears(years) {
  const targetMonths = years * 12;
  let low = 0;
  let high = Math.max(getValue("sipLumpsum"), getSipMonthlyValue(), 1);

  while (!simulateSipWithdrawalPlan(high, targetMonths).depletedMonth && high < 1e18) {
    low = high;
    high *= 2;
  }

  for (let index = 0; index < 90; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateSipWithdrawalPlan(mid, targetMonths);
    if (result.depletedMonth) high = mid;
    else low = mid;
  }

  return low;
}

function simulateCrossInvestment(monthlyWithdrawal = 0, withdrawalMonthsLimit = 0, withdrawalIncrementRate = null) {
  const monthlyTransfer = getCrossTransferValue();
  const externalSip = getCrossExternalSipValue();
  const sourceMonthlyRate = (1 + (getValue("crossGrowth") / 100)) ** (1 / 12) - 1;
  const sipMonthlyRate = (1 + (getValue("crossSipRate") / 100)) ** (1 / 12) - 1;
  const incrementRate = withdrawalIncrementRate === null ? getValue("crossWithdrawalIncrement") / 100 : withdrawalIncrementRate;
  const incrementMonthlyRate = (1 + incrementRate) ** (1 / 12) - 1;
  const projectionMonths = Math.round(getValue("crossMaxPeriod")) * 12;
  const transferMonths = state.crossInitialEnabled && state.crossTransferEnabled ? projectionMonths : 0;
  const externalSipMonths = state.crossExternalSipEnabled ? Math.round(getValue("crossExternalPeriod")) * 12 : 0;
  const withdrawalStartMonth = Math.round(getValue("crossWithdrawalStart")) * 12;
  const totalMonths = monthlyWithdrawal > 0
    ? withdrawalStartMonth + withdrawalMonthsLimit
    : projectionMonths;

  let sourceBalance = getCrossInitialValue();
  let sipBalance = 0;
  let externalSipBalance = 0;
  let totalWithdrawn = 0;
  let totalInvestment = sourceBalance;
  let depletedMonth = null;

  for (let month = 1; month <= totalMonths; month += 1) {
    if (month <= transferMonths && sourceBalance > 0) {
      const transfer = Math.min(monthlyTransfer, sourceBalance);
      sourceBalance -= transfer;
      sipBalance += transfer;
    }

    sourceBalance *= 1 + sourceMonthlyRate;
    sipBalance *= 1 + sipMonthlyRate;

    if (month <= externalSipMonths && month <= totalMonths) {
      externalSipBalance += externalSip;
      totalInvestment += externalSip;
    }

    externalSipBalance *= 1 + sipMonthlyRate;

    if (monthlyWithdrawal > 0 && month > withdrawalStartMonth) {
      const withdrawalMonth = month - withdrawalStartMonth;
      let remainingWithdrawal = monthlyWithdrawal * ((1 + incrementMonthlyRate) ** (withdrawalMonth - 1));
      const fromSip = Math.min(sipBalance, remainingWithdrawal);
      sipBalance -= fromSip;
      remainingWithdrawal -= fromSip;

      if (remainingWithdrawal > 0) {
        const fromExternalSip = Math.min(externalSipBalance, remainingWithdrawal);
        externalSipBalance -= fromExternalSip;
        remainingWithdrawal -= fromExternalSip;
      }

      if (remainingWithdrawal > 0) {
        const fromSource = Math.min(sourceBalance, remainingWithdrawal);
        sourceBalance -= fromSource;
        remainingWithdrawal -= fromSource;
      }

      totalWithdrawn += monthlyWithdrawal * ((1 + incrementMonthlyRate) ** (withdrawalMonth - 1)) - remainingWithdrawal;

      if (remainingWithdrawal > 0) {
        sourceBalance = 0;
        sipBalance = 0;
        externalSipBalance = 0;
        depletedMonth = withdrawalMonth;
        break;
      }
    }
  }

  return {
    sourceBalance,
    sipBalance,
    externalSipBalance,
    totalBalance: sourceBalance + sipBalance + externalSipBalance,
    totalInvestment,
    totalWithdrawn,
    depletedMonth,
  };
}

function maxCrossMonthlyWithdrawalForYears(years, withdrawalIncrementRate = null) {
  const targetMonths = years * 12;
  let low = 0;
  let high = Math.max(getCrossInitialValue(), getCrossTransferValue(), getCrossExternalSipValue(), 1);

  while (!simulateCrossInvestment(high, targetMonths, withdrawalIncrementRate).depletedMonth && high < 1e18) {
    low = high;
    high *= 2;
  }

  for (let index = 0; index < 90; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateCrossInvestment(mid, targetMonths, withdrawalIncrementRate);
    if (result.depletedMonth) high = mid;
    else low = mid;
  }

  return low;
}

function maxCrossMonthlyWithdrawalPreservingInvestmentForYears(years, withdrawalIncrementRate = null) {
  const targetMonths = years * 12;
  const baseline = simulateCrossInvestment(0, targetMonths, withdrawalIncrementRate);
  if (baseline.totalBalance <= baseline.totalInvestment) return 0;

  let low = 0;
  let high = Math.max(getCrossInitialValue(), getCrossTransferValue(), getCrossExternalSipValue(), 1);

  while (high < 1e18) {
    const result = simulateCrossInvestment(high, targetMonths, withdrawalIncrementRate);
    if (result.depletedMonth || result.totalBalance < result.totalInvestment) break;
    low = high;
    high *= 2;
  }

  for (let index = 0; index < 90; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateCrossInvestment(mid, targetMonths, withdrawalIncrementRate);
    if (result.depletedMonth || result.totalBalance < result.totalInvestment) high = mid;
    else low = mid;
  }

  return low;
}

function simulateCrossInvestmentWithImmediateWithdrawal(monthlyWithdrawal, years, withdrawalIncrementRate = 0.06) {
  const monthlyTransfer = getCrossTransferValue();
  const externalSip = getCrossExternalSipValue();
  const sourceMonthlyRate = (1 + (getValue("crossGrowth") / 100)) ** (1 / 12) - 1;
  const sipMonthlyRate = (1 + (getValue("crossSipRate") / 100)) ** (1 / 12) - 1;
  const incrementMonthlyRate = (1 + withdrawalIncrementRate) ** (1 / 12) - 1;
  const projectionMonths = years * 12;
  const transferMonths = state.crossInitialEnabled && state.crossTransferEnabled ? projectionMonths : 0;
  const externalSipMonths = state.crossExternalSipEnabled ? Math.round(getValue("crossExternalPeriod")) * 12 : 0;

  let sourceBalance = getCrossInitialValue();
  let sipBalance = 0;
  let externalSipBalance = 0;
  let totalWithdrawn = 0;
  let totalInvestment = sourceBalance;
  let depletedMonth = null;

  for (let month = 1; month <= projectionMonths; month += 1) {
    if (month <= transferMonths && sourceBalance > 0) {
      const transfer = Math.min(monthlyTransfer, sourceBalance);
      sourceBalance -= transfer;
      sipBalance += transfer;
    }

    sourceBalance *= 1 + sourceMonthlyRate;
    sipBalance *= 1 + sipMonthlyRate;

    if (month <= externalSipMonths) {
      externalSipBalance += externalSip;
      totalInvestment += externalSip;
    }

    externalSipBalance *= 1 + sipMonthlyRate;

    if (monthlyWithdrawal > 0) {
      let remainingWithdrawal = monthlyWithdrawal * ((1 + incrementMonthlyRate) ** (month - 1));
      const startingWithdrawal = remainingWithdrawal;
      const fromSip = Math.min(sipBalance, remainingWithdrawal);
      sipBalance -= fromSip;
      remainingWithdrawal -= fromSip;

      if (remainingWithdrawal > 0) {
        const fromExternalSip = Math.min(externalSipBalance, remainingWithdrawal);
        externalSipBalance -= fromExternalSip;
        remainingWithdrawal -= fromExternalSip;
      }

      if (remainingWithdrawal > 0) {
        const fromSource = Math.min(sourceBalance, remainingWithdrawal);
        sourceBalance -= fromSource;
        remainingWithdrawal -= fromSource;
      }

      totalWithdrawn += startingWithdrawal - remainingWithdrawal;

      if (remainingWithdrawal > 0) {
        sourceBalance = 0;
        sipBalance = 0;
        externalSipBalance = 0;
        depletedMonth = month;
        break;
      }
    }
  }

  return {
    sourceBalance,
    sipBalance,
    externalSipBalance,
    totalBalance: sourceBalance + sipBalance + externalSipBalance,
    totalInvestment,
    totalWithdrawn,
    depletedMonth,
  };
}

function maxCrossMonthlyWithdrawalPreservingInvestmentFromToday(years, withdrawalIncrementRate = 0.06) {
  const baseline = simulateCrossInvestmentWithImmediateWithdrawal(0, years, withdrawalIncrementRate);
  if (baseline.totalBalance <= baseline.totalInvestment) return 0;

  let low = 0;
  let high = Math.max(getCrossInitialValue(), getCrossTransferValue(), getCrossExternalSipValue(), 1);

  while (high < 1e18) {
    const result = simulateCrossInvestmentWithImmediateWithdrawal(high, years, withdrawalIncrementRate);
    if (result.depletedMonth || result.totalBalance < result.totalInvestment) break;
    low = high;
    high *= 2;
  }

  for (let index = 0; index < 90; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateCrossInvestmentWithImmediateWithdrawal(mid, years, withdrawalIncrementRate);
    if (result.depletedMonth || result.totalBalance < result.totalInvestment) high = mid;
    else low = mid;
  }

  return low;
}

function maxCrossMonthlyWithdrawalFinishingFromToday(years, withdrawalIncrementRate = 0.06) {
  let low = 0;
  let high = Math.max(getCrossInitialValue(), getCrossTransferValue(), getCrossExternalSipValue(), 1);

  while (!simulateCrossInvestmentWithImmediateWithdrawal(high, years, withdrawalIncrementRate).depletedMonth && high < 1e18) {
    low = high;
    high *= 2;
  }

  for (let index = 0; index < 90; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateCrossInvestmentWithImmediateWithdrawal(mid, years, withdrawalIncrementRate);
    if (result.depletedMonth) high = mid;
    else low = mid;
  }

  return low;
}

function calculateCrossInvestment() {
  const results = document.getElementById("cross-results");
  const hasSource = state.crossInitialEnabled || state.crossExternalSipEnabled;
  results.hidden = !hasSource;
  if (!hasSource) {
    results.innerHTML = "";
    return;
  }

  let years = Math.round(getValue("crossMaxPeriod"));

  if (state.crossWithdrawalEnabled) {
    const withdrawalAmount = getValue("crossWithdrawalAmount");
    const maxPeriodControl = controls.crossMaxPeriod;
    maxPeriodControl.config.max = 100;
    maxPeriodControl.slider.value = valueToSlider(maxPeriodControl.config, getValue("crossMaxPeriod"));
    years = Math.round(getValue("crossMaxPeriod"));
    const withdrawalStartYears = Math.round(getValue("crossWithdrawalStart"));
    const withdrawalYears = Math.max(1, years - withdrawalStartYears);

    const result = simulateCrossInvestment(withdrawalAmount, withdrawalYears * 12);
    const maxMonthlyForPeriod = state.crossFinishPortfolioEnabled
      ? maxCrossMonthlyWithdrawalForYears(withdrawalYears)
      : maxCrossMonthlyWithdrawalPreservingInvestmentForYears(withdrawalYears);
    const closed = Boolean(result.depletedMonth);
    const portfolioResult = closed
      ? metric("Portfolio Lasts", `${Math.ceil(result.depletedMonth / 12)} years`, {
        color: colorForWithdrawalYears(Math.ceil(result.depletedMonth / 12)),
      })
      : metric(`Portfolio After ${years} Years`, formatInr(result.totalBalance), {
        help: `Projected corpus left after the ${years}-year projection period, using a starting monthly withdrawal of ${formatInrFull(withdrawalAmount)}, a ${formatControlValue(controls.crossWithdrawalIncrement.config, getValue("crossWithdrawalIncrement"))} annual raise, and withdrawals starting after ${withdrawalStartYears} years.`,
      });

    results.innerHTML = [
      metric("Total Investment", formatInr(result.totalInvestment)),
      state.crossFinishPortfolioEnabled
        ? metric("Maximum Monthly Withdrawal", formatInr(maxMonthlyForPeriod), {
          help: `With this starting monthly withdrawal, along with the annual withdrawal raise, the portfolio becomes 0 at the end of the ${years}-year projection period.`,
        })
        : metric("Sustainable Monthly Withdrawal", formatInr(maxMonthlyForPeriod), {
          help: `Maximum starting monthly withdrawal which, along with the annual withdrawal raise, leaves the portfolio at its total investment value at the end of the ${years}-year projection period.`,
        }),
      portfolioResult,
    ].join("");
    return;
  }

  const maxPeriodControl = controls.crossMaxPeriod;
  maxPeriodControl.config.max = 100;
  maxPeriodControl.slider.value = valueToSlider(maxPeriodControl.config, getValue("crossMaxPeriod"));

  const result = simulateCrossInvestment();
  results.innerHTML = [
    metric("Total Investment", formatInr(result.totalInvestment)),
    metric(`Portfolio After ${years} Years`, formatInr(result.totalBalance)),
  ].join("");
}

function calculateSip() {
  const lumpsum = getValue("sipLumpsum");
  const sip = getSipMonthlyValue();
  const annualRate = getValue("sipRate") / 100;
  const years = Math.round(getValue("sipPeriod"));
  const months = years * 12;
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  const withdrawalStartMonth = Math.round(getValue("sipWithdrawalStart")) * 12;
  const withdrawalAmount = getValue("sipWithdrawalAmount");

  let balance = lumpsum;
  let invested = lumpsum;
  let totalWithdrawn = 0;

  for (let month = 1; month <= months; month += 1) {
    balance += sip;
    invested += sip;
    balance *= 1 + monthlyRate;

    if (state.sipWithdrawalEnabled && month > withdrawalStartMonth && balance > 0) {
      const withdrawn = Math.min(withdrawalAmount, balance);
      balance -= withdrawn;
      totalWithdrawn += withdrawn;
    }
  }

  if (state.sipWithdrawalEnabled) {
    const longTerm = simulateSipWithdrawalPlan(withdrawalAmount, LONG_TERM_YEAR_LIMIT * 12);
    const sustainableMonthly = maxSipMonthlyWithdrawalForYears(LONG_TERM_YEAR_LIMIT);
    const lasts = longTerm.depletedMonth
      ? `${Math.ceil(longTerm.depletedMonth / 12)} years`
      : `${LONG_TERM_YEAR_LIMIT}+ years`;
    const colorYears = longTerm.depletedMonth ? Math.ceil(longTerm.depletedMonth / 12) : LONG_TERM_YEAR_LIMIT;

    document.getElementById("sip-results").innerHTML = [
      metric("Total Invested", formatInr(invested)),
      metric("Portfolio Lasts", lasts, { color: colorForWithdrawalYears(colorYears) }),
      metric("Sustainable Monthly Withdrawal", formatInr(sustainableMonthly)),
      metric("Portfolio After 80 Years", formatInr(longTerm.balance)),
    ].join("");
    return;
  }

  document.getElementById("sip-results").innerHTML = [
    metric("Total Invested", formatInr(invested)),
    metric("Estimated Profit", formatInr(balance + totalWithdrawn - invested)),
    metric("Portfolio After 80 Years", formatInr(balance)),
  ].join("");
}

function simulateWithdrawals(monthLimit, monthlyWithdrawal = null) {
  const annualRate = getValue("withdrawalGrowth") / 100;
  const incrementRate = getValue("withdrawalIncrement") / 100;
  const withdrawal = monthlyWithdrawal === null ? getValue("withdrawalMonthly") : monthlyWithdrawal;
  return simulatePortfolioWithdrawal(getValue("withdrawalLumpsum"), annualRate, withdrawal, monthLimit, incrementRate);
}

function maxMonthlyWithdrawalForYears(years) {
  const targetMonths = years * 12;
  const corpus = getValue("withdrawalLumpsum");
  const annualRate = getValue("withdrawalGrowth") / 100;
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  let low = 0;
  let high = corpus * (1 + monthlyRate);

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateWithdrawals(targetMonths, mid);
    if (result.depletedMonth) high = mid;
    else low = mid;
  }

  return low;
}

function maxMonthlyWithdrawalPreservingCorpusForYears(years) {
  const targetMonths = years * 12;
  const corpus = getValue("withdrawalLumpsum");
  let low = 0;
  let high = maxMonthlyWithdrawalForYears(years);

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const result = simulateWithdrawals(targetMonths, mid);
    if (result.depletedMonth || result.balance < corpus) high = mid;
    else low = mid;
  }

  return low;
}

function calculateWithdrawal() {
  const maxYears = Math.round(getValue("withdrawalMaxPeriod"));
  const result = simulateWithdrawals(maxYears * 12);
  const closed = Boolean(result.depletedMonth);

  if (state.withdrawalFinishPortfolioEnabled) {
    const maxMonthlyForPeriod = maxMonthlyWithdrawalForYears(maxYears);

    document.getElementById("withdrawal-results").innerHTML = [
      metric(`Status After ${maxYears} Years`, closed ? "Closed" : "Active", { danger: closed }),
      metric("Maximum Monthly Withdrawal", formatInr(maxMonthlyForPeriod), {
        help: `With this starting monthly withdrawal, along with the annual withdrawal raise, the portfolio becomes 0 after the projected ${maxYears} years.`,
      }),
      metric(`Portfolio After ${maxYears} Years`, formatInr(result.balance), { danger: closed }),
    ].join("");
    return;
  }

  const sustainableMonthly = maxMonthlyWithdrawalPreservingCorpusForYears(maxYears);
  document.getElementById("withdrawal-results").innerHTML = [
    metric(`Status After ${maxYears} Years`, closed ? "Closed" : "Active", { danger: closed }),
    metric("Sustainable Monthly Withdrawal", formatInr(sustainableMonthly), {
      help: `Maximum starting monthly withdrawal which, along with the annual withdrawal raise, leaves the portfolio at its starting investment value after ${maxYears} years.`,
    }),
    metric(`Portfolio After ${maxYears} Years`, formatInr(result.balance), { danger: closed }),
  ].join("");
}

function calculateAll() {
  calculateCrossInvestment();
  calculateWithdrawal();
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    state.activeTab = ["cross", "withdrawal"].includes(saved.activeTab) ? saved.activeTab : "cross";
    state.crossInitialEnabled = saved.crossInitialEnabled !== false;
    state.crossTransferEnabled = saved.crossTransferEnabled !== false;
    state.crossExternalSipEnabled = Boolean(saved.crossExternalSipEnabled);
    state.crossWithdrawalEnabled = Boolean(saved.crossWithdrawalEnabled);
    state.crossFinishPortfolioEnabled = Boolean(saved.crossFinishPortfolioEnabled);
    state.withdrawalFinishPortfolioEnabled = Boolean(saved.withdrawalFinishPortfolioEnabled ?? saved.withdrawalMaxPeriodEnabled);
    state.values = saved.values || {};
  } catch (_error) {
    state.values = {};
  }
}

function setActiveTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const isActive = panel.id === tabId;
    panel.hidden = !isActive;
    panel.classList.toggle("active", isActive);
  });
  document.querySelectorAll(".segment-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });
  saveState();
}

function setupTabs() {
  document.querySelectorAll(".segment-button").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
}

function setupCheckboxes() {
  const crossCheckbox = document.getElementById("cross-withdrawal-enabled");
  const crossInputs = document.getElementById("cross-withdrawal-inputs");
  const crossInitialCheckbox = document.getElementById("cross-initial-enabled");
  const crossTransferCheckbox = document.getElementById("cross-transfer-enabled");
  const crossExternalSipCheckbox = document.getElementById("cross-external-sip-enabled");
  const crossFinishCheckbox = document.getElementById("cross-finish-portfolio-enabled");

  crossInitialCheckbox.checked = state.crossInitialEnabled;
  updateCrossInitialAvailability();
  crossInitialCheckbox.addEventListener("change", () => {
    state.crossInitialEnabled = crossInitialCheckbox.checked;
    updateCrossInitialAvailability();
    calculateAll();
    saveState();
  });

  crossTransferCheckbox.checked = state.crossTransferEnabled;
  updateCrossTransferAvailability();
  crossTransferCheckbox.addEventListener("change", () => {
    state.crossTransferEnabled = crossTransferCheckbox.checked;
    updateCrossTransferAvailability();
    calculateAll();
    saveState();
  });

  crossExternalSipCheckbox.checked = state.crossExternalSipEnabled;
  updateCrossExternalSipLabel();
  updateCrossExternalSipAvailability();
  crossExternalSipCheckbox.addEventListener("change", () => {
    state.crossExternalSipEnabled = crossExternalSipCheckbox.checked;
    updateCrossExternalSipAvailability();
    calculateAll();
    saveState();
  });

  crossCheckbox.checked = state.crossWithdrawalEnabled;
  crossInputs.closest(".section-box").classList.toggle("section-box-active", state.crossWithdrawalEnabled);
  updateCrossWithdrawalAvailability();
  crossCheckbox.addEventListener("change", () => {
    state.crossWithdrawalEnabled = crossCheckbox.checked;
    crossInputs.closest(".section-box").classList.toggle("section-box-active", state.crossWithdrawalEnabled);
    updateCrossWithdrawalAvailability();
    calculateAll();
    saveState();
  });

  crossFinishCheckbox.checked = state.crossFinishPortfolioEnabled;
  crossFinishCheckbox.addEventListener("change", () => {
    state.crossFinishPortfolioEnabled = crossFinishCheckbox.checked;
    calculateAll();
    saveState();
  });

  const maxInputs = document.getElementById("withdrawal-max-period-inputs");
  const finishCheckbox = document.getElementById("withdrawal-finish-portfolio-enabled");

  maxInputs.hidden = false;
  finishCheckbox.checked = state.withdrawalFinishPortfolioEnabled;
  finishCheckbox.addEventListener("change", () => {
    state.withdrawalFinishPortfolioEnabled = finishCheckbox.checked;
    calculateAll();
    saveState();
  });
}

function setupBlurOnOutsideTap() {
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".value-input")) return;

    const active = document.activeElement;

    if (active && active.classList && active.classList.contains("value-input")) {
      active.blur();
    }
  });
}

function setupMetricTooltips() {
  document.addEventListener("click", (event) => {
    const help = event.target.closest(".metric .info-button, h1 .info-button, .check-row .info-button");
    if (!help) return;

    event.preventDefault();
    event.stopPropagation();
    showTooltipModal(help.dataset.tooltip);
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function init() {
  loadState();
  setupTabs();
  controlConfigs.forEach(createControl);
  updateSipPeriodAvailability();
  updateCrossWithdrawalStartLimit();
  updateCrossExternalPeriodLimit();
  updateCrossInitialAvailability();
  updateCrossTransferAvailability();
  updateCrossExternalSipAvailability();
  setupCheckboxes();
  setupBlurOnOutsideTap();
  setupMetricTooltips();
  setActiveTab(state.activeTab);
  calculateAll();
  registerServiceWorker();
}

document.addEventListener("DOMContentLoaded", init);
