"use strict";

/*
 * ORGANIZACIÓN MVC EN UN ÚNICO ARCHIVO:
 * Modelo: lectura y transformación de la planificación (parseCSV,
 * detectMonths, getMonthData y calculateStats).
 * Vista: renderizado de paneles y calendarios.
 * Controlador: eventos de interfaz y coordinación de acciones.
 * El flujo de informes queda separado en ReportModel, ReportView
 * y ReportController.
 */

/* =========================================
   CONFIGURACIÓN
========================================= */

const STORAGE_KEY = "turnos_operaciones_csv_v1";
const OPERATOR_KEY = "turnos_operaciones_operator_v1";
const YEAR_KEY = "turnos_operaciones_year_v1";

const MONTHS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

const SHIFTS = {
  MA: { name: "Mañana Arteixo", time: "07:00 - 15:00" },
  ML: { name: "Mañana Laracha", time: "07:00 - 15:00" },
  TA: { name: "Tarde Arteixo", time: "15:00 - 23:00" },
  TL: { name: "Tarde Laracha", time: "15:00 - 23:00" },
  NA: { name: "Noche Arteixo", time: "23:00 - 07:00" },
  NL: { name: "Noche Laracha", time: "23:00 - 07:00" },
};

const WEEKDAYS = ["D", "L", "M", "X", "J", "V", "S"];

let rows = [];
let months = [];
let operators = [];
let currentOperator = null;

let csvContent = "";
let restoredFromStorage = false;
let selectedMonthFilter = "all";
let statsStartDate = "";
let statsEndDate = "";

const $ = (id) => document.getElementById(id);

/* =========================================
   UTILIDADES
========================================= */

function normalize(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function getYear() {
  const year = Number($("year").value);

  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : new Date().getFullYear();
}

function getToday() {
  return new Date();
}

function selectCurrentMonthByDefault() {
  const today = new Date();

  const current = months.find(
    (month) =>
      month.index === today.getMonth() && month.year === today.getFullYear(),
  );

  selectedMonthFilter = current ? `${current.year}-${current.index}` : "all";

  updateMonthFilterOptions();
}

function scrollToTodayAfterRender() {
  requestAnimationFrame(() => {
    const today = new Date();

    const monthElement = $(`month-${today.getFullYear()}-${today.getMonth()}`);

    const todayElement = $("today");

    const target = todayElement || monthElement;

    if (target) {
      target.scrollIntoView({
        behavior: "auto",
        block: todayElement ? "center" : "start",
      });
    }
  });
}

function formatDate(date, options = {}) {
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
  });
}

function shiftClass(code) {
  return SHIFTS[code] ? code.toLowerCase() : "";
}

/* =========================================
   GUARDADO AUTOMÁTICO
========================================= */

function saveCSV(content) {
  try {
    localStorage.setItem(STORAGE_KEY, content);
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
    localStorage.setItem(YEAR_KEY, String(getYear()));

    $("fileStatus").textContent = "✓ CSV guardado automáticamente";
    updateStorageStatus(true);

    return true;
  } catch (error) {
    console.error("Error guardando CSV:", error);

    $("fileStatus").textContent = "⚠ No se pudo guardar";

    alert(
      "La planificación se ha cargado, pero no se pudo guardar automáticamente. " +
        "Comprueba el almacenamiento disponible del navegador.",
    );

    return false;
  }
}

function restoreCSV() {
  try {
    const savedCSV = localStorage.getItem(STORAGE_KEY);

    if (!savedCSV) {
      updateStorageStatus(false);
      return;
    }

    csvContent = savedCSV;
    rows = parseCSV(savedCSV);

    if (rows.length < 4) {
      throw new Error("CSV guardado no válido.");
    }

    const savedYear = localStorage.getItem(YEAR_KEY);
    if (savedYear && Number(savedYear) >= 2000 && Number(savedYear) <= 2100) {
      $("year").value = savedYear;
    }

    // Al abrir el calendario, tomar el año actual como referencia
    // para que el filtro pueda seleccionar el mes en curso.
    $("year").value = getToday().getFullYear();
    detectMonths();
    selectCurrentMonthByDefault();
    fillOperators();

    $("todayBtn").disabled = false;
    $("printBtn").disabled = false;
    $("exportBtn").disabled = false;
    $("monthFilter").disabled = false;

    const savedOperator = localStorage.getItem(OPERATOR_KEY);

    if (savedOperator) {
      const found = operators.find((op) => op.name === savedOperator);
      currentOperator = found || null;
      $("operator").value = currentOperator ? currentOperator.name : "";
    } else {
      currentOperator = null;
      $("operator").value = "";
    }

    render();
    scrollToTodayAfterRender();
    restoredFromStorage = true;

    $("fileStatus").textContent = "✓ Planificación recuperada automáticamente";
    updateStorageStatus(true);
  } catch (error) {
    console.error("Error recuperando CSV:", error);
    $("fileStatus").textContent = " ";
    updateStorageStatus(false);
  }
}
/*
function updateStorageStatus(saved) {
  $("storageStatus").innerHTML = saved
    ? '<span class="storage-status">● Planificación guardada en este dispositivo</span>'
    : '<span class="storage-status" style="background:#f1f5f9;color:#64748b">○ Sin planificación guardada</span>';
}*/

/* =========================================
   LECTOR CSV
========================================= */

function parseCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";

  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;

  const separator = semicolons >= commas ? ";" : ",";

  const result = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;

      row.push(field.trim());

      if (row.some((value) => value !== "")) {
        result.push(row);
      }

      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());

  if (row.some((value) => value !== "")) {
    result.push(row);
  }

  return result;
}

/* =========================================
   CARGAR ARCHIVO
========================================= */

$("csvFile").addEventListener("change", function (event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    alert("Selecciona un archivo CSV válido.");
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const content = e.target.result.replace(/^\uFEFF/, "");

      const parsed = parseCSV(content);

      if (parsed.length < 4) {
        throw new Error("El archivo no contiene suficientes filas.");
      }

      const previousOperator =
        currentOperator?.name || localStorage.getItem(OPERATOR_KEY);

      // Validar antes de sustituir los datos anteriores.
      rows = parsed;
      $("year").value = getToday().getFullYear();
      detectMonths();
      selectCurrentMonthByDefault();
      fillOperators();

      csvContent = content;

      // Mantener el operador si había uno seleccionado; si no, vista general.
      if (previousOperator) {
        const found = operators.find((op) => op.name === previousOperator);
        currentOperator = found || null;
      } else {
        currentOperator = null;
      }
      $("operator").value = currentOperator ? currentOperator.name : "";

      saveCSV(content);

      restoredFromStorage = false;

      $("fileStatus").textContent = "✓ Archivo cargado: " + file.name;

      $("todayBtn").disabled = false;
      $("printBtn").disabled = false;
      $("exportBtn").disabled = false;
      $("monthFilter").disabled = false;
      updateMonthFilterOptions();
      render();
      scrollToTodayAfterRender();
    } catch (error) {
      console.error(error);
      alert("Error al cargar el CSV:\n" + error.message);
    }
  };

  reader.onerror = function () {
    alert("No se pudo leer el archivo.");
  };

  reader.readAsText(file, "ISO-8859-1");
});

/* =========================================
   DETECTAR MESES
========================================= */

function detectMonths() {
  months = [];

  const monthRow = rows[0] || [];
  const baseYear = getYear();

  let currentYear = baseYear;
  let previousMonth = -1;

  monthRow.forEach((value, index) => {
    const monthName = normalize(value);
    const monthIndex = MONTHS.indexOf(monthName);

    if (monthIndex !== -1) {
      // Al pasar de diciembre a enero comienza el año siguiente.
      if (previousMonth !== -1 && monthIndex < previousMonth) {
        currentYear++;
      }

      months.push({
        name: MONTHS[monthIndex],
        index: monthIndex,
        start: index,
        end: monthRow.length,
        year: currentYear,
      });

      previousMonth = monthIndex;
    }
  });

  if (months.length === 0) {
    throw new Error("No se han detectado los meses en la primera fila.");
  }

  months.forEach((month, index) => {
    if (index < months.length - 1) {
      month.end = months[index + 1].start;
    }
  });
}

/* =========================================
   OPERADORES
========================================= */

function fillOperators() {
  operators = [];

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] || "").trim();

    if (!name || name.length < 2) continue;

    if (name.includes("Tal como lo conversamos") || name.includes("19 de oct"))
      continue;

    const hasShifts = row.some((value) =>
      Object.hasOwn(SHIFTS, normalize(value)),
    );

    if (!hasShifts) continue;

    operators.push({ name, row });
  }

  if (operators.length === 0) {
    throw new Error("No se han encontrado operadores con turnos.");
  }

  operators.sort((a, b) => a.name.localeCompare(b.name, "es"));

  $("operator").innerHTML = '<option value="">Todos los operadores</option>';

  operators.forEach((operator) => {
    const option = document.createElement("option");
    option.value = operator.name;
    option.textContent = operator.name;
    $("operator").appendChild(option);
  });

  $("operator").disabled = false;

  // Por defecto se muestra el cuadrante conjunto de todos los operadores.
  currentOperator = null;
  $("operator").value = "";
}

$("operator").addEventListener("change", function () {
  currentOperator = this.value
    ? operators.find((op) => op.name === this.value) || null
    : null;

  try {
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
  } catch (error) {
    console.warn("No se pudo guardar la selección.", error);
  }

  render();
});

/* =========================================
   TURNOS DEL MES
========================================= */

function getMonthData(month, row) {
  const result = new Map();
  const daysRow = rows[2];

  for (let col = month.start; col < month.end; col++) {
    const day = Number((daysRow[col] || "").trim());

    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const code = normalize(row[col]);

    result.set(day, SHIFTS[code] ? code : "");
  }

  return result;
}

function getShiftForDate(date, row) {
  const month = months.find(
    (m) => m.index === date.getMonth() && m.year === date.getFullYear(),
  );

  if (!month) return null;

  const data = getMonthData(month, row);

  if (!data.has(date.getDate())) return null;

  return data.get(date.getDate());
}

/* =========================================
   ESTADÍSTICAS
========================================= */

function calculateStats(row, startDate = "", endDate = "") {
  const stats = {
    MA: 0,
    ML: 0,
    TA: 0,
    TL: 0,
    NA: 0,
    NL: 0,

    ARTEIXO: 0,
    LARACHA: 0,

    LIBRE: 0,
  };

  let totalDays = 0;
  const selectedYear = getYear();
  const start = startDate ? new Date(startDate + "T00:00:00") : null;
  const end = endDate ? new Date(endDate + "T23:59:59") : null;

  months.forEach((month) => {
    // Sin fechas seleccionadas, el resumen corresponde al año elegido.
    if (!start && !end && month.year !== selectedYear) return;

    const data = getMonthData(month, row);

    data.forEach((code, day) => {
      const date = new Date(month.year, month.index, day);

      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (date > today) {
        return;
      }

      if (start && date < start) return;
      if (end && date > end) return;

      totalDays++;

      if (code && SHIFTS[code]) {
        stats[code]++;
        if (code.endsWith("A")) {
          stats.ARTEIXO++;
        }

        if (code.endsWith("L")) {
          stats.LARACHA++;
        }
      } else {
        stats.LIBRE++;
      }
    });
  });

  return { stats, totalDays };
}
function renderStats(row) {
  const result = calculateStats(row, statsStartDate, statsEndDate);
  const stats = result.stats;

  const cards = [
    ["MA", "Mañana Arteixo", "var(--ma)"],
    ["ML", "Mañana Laracha", "var(--ml)"],

    ["TA", "Tarde Arteixo", "var(--ta)"],
    ["TL", "Tarde Laracha", "var(--tl)"],

    ["NA", "Noche Arteixo", "var(--na)"],
    ["NL", "Noche Laracha", "var(--nl)"],

    ["ARTEIXO", "Días Arteixo", "#0284c7"],
    ["LARACHA", "Días Laracha", "#059669"],

    ["LIBRE", "Días libres", "#cbd5e1"],
  ];

  const periodLabel =
    statsStartDate || statsEndDate
      ? `Periodo: ${statsStartDate || "inicio"} — ${statsEndDate || "actualidad"}`
      : `Año completo · ${getYear()}`;

  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen de turnos</h3>

        <div class="stats-filter">
            <div class="control">
                <label for="statsStartDate">Desde el día</label>
                <input type="date" id="statsStartDate" value="${statsStartDate}">
            </div>
            <div class="control">
                <label for="statsEndDate">Hasta el día</label>
                <input type="date" id="statsEndDate" value="${statsEndDate}">
            </div>
            <button type="button" id="applyStatsFilter">Aplicar fechas</button>
            <button type="button" id="clearStatsFilter" class="secondary">Ver año completo</button>
        </div>

        <p class="stats-period">${escapeHTML(periodLabel)}</p>

        <div class="summary">
            ${cards
              .map(
                ([code, name, color]) => `
                <div class="summary-card" style="--accent:${color}">
                    <small>${name}</small>
                    <strong>${stats[code]}</strong>
                    <small>${code}</small>
                </div>
            `,
              )
              .join("")}
        </div>

        <p style="font-size:12px;color:var(--muted);margin-bottom:0">
            Total de días incluidos: ${result.totalDays}
        </p>
    `;

  $("applyStatsFilter").addEventListener("click", () => {
    const from = $("statsStartDate").value;
    const to = $("statsEndDate").value;

    if (from && to && from > to) {
      alert("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }

    statsStartDate = from;
    statsEndDate = to;
    renderStats(row);
  });

  $("clearStatsFilter").addEventListener("click", () => {
    statsStartDate = "";
    statsEndDate = "";
    renderStats(row);
  });
}

/* =========================================
   PANEL DE HOY
========================================= */

function renderToday(row) {
  const today = getToday();
  const code = getShiftForDate(today, row);
  const shift = code ? SHIFTS[code] : null;

  $("todayPanel").innerHTML = `
        <div class="today-info">
            <div>
                <div class="today-name">
                    👤 ${escapeHTML(currentOperator.name)}
                </div>
                <div class="today-date">
                    📅 ${escapeHTML(formatDate(today))}
                </div>
            </div>

            <div style="text-align:right">
                <div style="font-size:12px;color:#64748b">TURNO DE HOY</div>

                ${
                  shift
                    ? `
                    <div class="next-shift ${shiftClass(code)}"
                         style="display:inline-block;font-size:17px;
                         padding:10px 18px;margin-top:5px">
                        ${code}
                    </div>
                    <div style="font-size:12px;margin-top:5px">
                        ${shift.name} · ${shift.time}
                    </div>
                `
                    : `
                    <div style="font-size:20px;font-weight:800;
                         color:#64748b;margin-top:5px">
                        ${code === "" ? "LIBRE" : "SIN DATOS"}
                    </div>
                `
                }
            </div>
        </div>
    `;
}

/* =========================================
   PRÓXIMOS SIETE DÍAS
========================================= */

function renderNextTurns(row) {
  const today = getToday();

  let html = `
        <h3 class="panel-title">📅 Próximos 7 días</h3>
        <div class="next-list">
    `;

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const code = getShiftForDate(date, row);
    const shift = code ? SHIFTS[code] : null;

    const label = shift ? code : code === "" ? "LIBRE" : "SIN DATOS";

    html += `
            <div class="next-item ${i === 0 ? "today-next" : ""}">
                <div>
                    <div class="next-date">
                        ${
                          i === 0
                            ? "HOY"
                            : escapeHTML(
                                formatDate(date, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                }),
                              )
                        }
                    </div>
                    <small style="color:#64748b">
                        ${shift ? shift.name : ""}
                    </small>
                </div>

                <span class="next-shift ${shift ? shiftClass(code) : ""}"
                      style="${shift ? "" : "background:#94a3b8"}">
                    ${label}
                </span>
            </div>
        `;
  }

  html += "</div>";

  $("nextPanel").innerHTML = html;
}

/* =========================================
   CALENDARIO
========================================= */

function getAvailableCalendarMonths() {
  // Mostrar todos los meses detectados en el CSV, también los anteriores
  // al año seleccionado. El año sirve para asignar el año base al CSV,
  // pero no debe ocultar meses ya planificados.
  return [...months];
}

function updateMonthFilterOptions() {
  const select = $("monthFilter");
  if (!select) return;

  const available = getAvailableCalendarMonths();

  select.innerHTML = '<option value="all">Todos los meses disponibles</option>';

  available.forEach((month) => {
    const option = document.createElement("option");

    option.value = `${month.year}-${month.index}`;
    option.textContent = `${month.name} ${month.year}`;

    select.appendChild(option);
  });

  const exists = available.some(
    (month) => `${month.year}-${month.index}` === selectedMonthFilter,
  );

  if (!exists && selectedMonthFilter !== "all") {
    selectedMonthFilter = "all";
  }

  select.value = selectedMonthFilter;
}

function renderCalendar(row) {
  $("container").innerHTML = "";
  updateMonthFilterOptions();

  let visibleMonths = getAvailableCalendarMonths();

  if (selectedMonthFilter !== "all") {
    visibleMonths = visibleMonths.filter(
      (month) => `${month.year}-${month.index}` === selectedMonthFilter,
    );
  }

  if (visibleMonths.length === 0) {
    $("container").innerHTML = `
            <div class="panel empty-state">
                <div class="emoji">🗓️</div>
                No hay planificación disponible para los meses seleccionados.
            </div>
        `;
    return;
  }

  visibleMonths.forEach((month) => {
    const monthData = getMonthData(month, row);
    const year = month.year;
    const totalDays = new Date(year, month.index + 1, 0).getDate();
    const firstDay = new Date(year, month.index, 1).getDay();

    const block = document.createElement("section");
    block.className = "month";
    block.id = `month-${year}-${month.index}`;

    block.innerHTML = `
            <h2>
                <span>${month.name}</span>
                <small>${year} · ${monthData.size} días registrados</small>
            </h2>
        `;

    const calendar = document.createElement("div");
    calendar.className = "calendar";

    WEEKDAYS.forEach((day) => {
      const cell = document.createElement("div");
      cell.className = "dow";
      cell.textContent = day;
      calendar.appendChild(cell);
    });

    // La cabecera empieza en domingo, igual que Date.getDay().
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "day empty";
      calendar.appendChild(empty);
    }

    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement("div");
      cell.className = "day";

      const code = monthData.has(day) ? monthData.get(day) : null;

      const today = getToday();
      const isToday =
        today.getDate() === day &&
        today.getMonth() === month.index &&
        today.getFullYear() === year;

      if (isToday) {
        cell.classList.add("today");
        cell.id = "today";
      }

      /*cell.innerHTML = `<div class="daynum">${day}</div>`;*/
      const date = new Date(year, month.index, day);

      const weekday = date.toLocaleDateString("es-ES", { weekday: "short" });

      cell.innerHTML = `
    <div class="daynum">${day}</div>
    <div class="weekday">${weekday}</div>
`;

      if (code === null) {
        cell.innerHTML += `<div class="free-label">Sin datos</div>`;
      } else if (code) {
        const shift = SHIFTS[code];
        cell.innerHTML += `<div class="turno ${shiftClass(code)}">${code}</div>`;
        cell.title = `${shift.name} (${shift.time})`;
      } else {
        cell.innerHTML += `<div class="free-label">LIBRE</div>`;
        cell.title = "Día libre";
      }

      calendar.appendChild(cell);
    }

    const remainder = calendar.children.length % 7;
    if (remainder !== 0) {
      for (let i = remainder; i < 7; i++) {
        const empty = document.createElement("div");
        empty.className = "day empty";
        calendar.appendChild(empty);
      }
    }

    block.appendChild(calendar);
    $("container").appendChild(block);
  });
}

function renderTodayAll() {
  const today = getToday();
  const entries = operators
    .map((operator) => {
      const code = getShiftForDate(today, operator.row);
      const label = code === null ? "SIN DATOS" : code || "LIBRE";
      const shift = code ? SHIFTS[code] : null;
      return `
            <div class="next-item">
                <span class="next-date">${escapeHTML(operator.name)}</span>
                <span class="next-shift ${shiftClass(code)}"
                      style="${shift ? "" : "background:#94a3b8"}"
                      title="${shift ? `${shift.name} · ${shift.time}` : label}">
                    ${label}
                </span>
            </div>`;
    })
    .join("");

  $("todayPanel").innerHTML = `
        <h3 class="panel-title">📍 Turnos de hoy · ${escapeHTML(formatDate(today))}</h3>
        <div class="next-list">${entries}</div>
    `;
}

function renderNextAll() {
  $("nextPanel").innerHTML = `
        <h3 class="panel-title">👥 Vista conjunta de operadores</h3>
        <p style="color:var(--muted);margin:0">
            Estás viendo el cuadrante mensual de todos los operadores. 
            Selecciona un nombre en el desplegable para consultar su calendario individual,
            sus próximos turnos y sus estadísticas.
        </p>
    `;
}

function renderStatsAll() {
  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen</h3>

        <p style="color:var(--muted)">
            Selecciona un operador para ver estadísticas.
        </p>
    `;
}

function normalizeShiftPattern(code) {
  code = String(code || "")
    .trim()
    .toUpperCase();

  if (code.startsWith("M")) return "M";
  if (code.startsWith("T")) return "T";
  if (code.startsWith("N")) return "N";

  return "_";
}

function buildPatternKey(operator) {
  const days = [...operator.shifts.keys()].sort((a, b) => a - b).slice(0, 14);

  return days
    .map((day) => normalizeShiftPattern(operator.shifts.get(day)))
    .join("");
}

function renderAllOperatorsCalendar() {
  $("container").innerHTML = "";
  updateMonthFilterOptions();

  let visibleMonths = getAvailableCalendarMonths();
  if (selectedMonthFilter !== "all") {
    visibleMonths = visibleMonths.filter(
      (month) => `${month.year}-${month.index}` === selectedMonthFilter,
    );
  }

  if (visibleMonths.length === 0) {
    $("container").innerHTML = `
            <div class="panel empty-state">
                <div class="emoji">🗓️</div>
                No hay planificación disponible para los meses seleccionados.
            </div>`;
    return;
  }

  visibleMonths.forEach((month) => {
    const monthData = operators.map((operator) => ({
      name: operator.name,
      shifts: getMonthData(month, operator.row),
    }));
    monthData.sort((a, b) => {
      const keyA = buildPatternKey(a);
      const keyB = buildPatternKey(b);

      const cmp = keyA.localeCompare(keyB);

      if (cmp !== 0) return cmp;

      return a.name.localeCompare(b.name, "es");
    });

    const totalDays = new Date(month.year, month.index + 1, 0).getDate();

    const section = document.createElement("section");
    section.className = "month";
    section.id = `month-${month.year}-${month.index}`;

    let table = `
            <h2>
                <span>${month.name} · Cuadrante general</span>
                <small>${month.year} · ${operators.length} operadores</small>
            </h2>
            <p class="all-view-note">Cada fila representa un operador. Desliza horizontalmente para consultar todos los días del mes.</p>
            <div class="all-operators-wrap">
                <table class="all-operators-table">
                    <thead><tr>
                        <th class="operator-name">Operador</th>
                         ${Array.from({ length: totalDays }, (_, i) => {
                           const day = i + 1;

                           const isToday =
                             day === getToday().getDate() &&
                             month.index === getToday().getMonth() &&
                             month.year === getToday().getFullYear();

                           const weekday =
                             WEEKDAYS[
                               new Date(month.year, month.index, day).getDay()
                             ];

                           return `
    <th class="${isToday ? "today-column" : ""}">
      <div class="header-weekday">${weekday}</div>
      <div class="header-day">${day}</div>
    </th>
  `;
                         }).join("")}
                    </tr></thead>
                    <tbody>
        `;

    monthData.forEach((operator) => {
      table += `<tr><th class="operator-name">${escapeHTML(operator.name)}</th>`;
      for (let day = 1; day <= totalDays; day++) {
        const isToday =
          day === getToday().getDate() &&
          month.index === getToday().getMonth() &&
          month.year === getToday().getFullYear();
        const todayClass = isToday ? " today-column" : "";
        const todayId = isToday ? ' id="today"' : "";
        const code = operator.shifts.has(day) ? operator.shifts.get(day) : null;
        if (code === null) {
          table += `<td${todayId} class="no-data-cell${todayClass}" title="Sin datos">—</td>`;
        } else if (code) {
          const shift = SHIFTS[code];
          table += `<td${todayId} class="shift-cell ${shiftClass(code)}${todayClass}" title="${escapeHTML(shift.name)} · ${escapeHTML(shift.time)}">${code}</td>`;
        } else {
          table += `<td${todayId} class="free-cell${todayClass}" title="Día libre">L</td>`;
        }
      }
      table += `</tr>`;
    });

    table += `</tbody></table></div>`;
    section.innerHTML = table;
    $("container").appendChild(section);
  });
}

function render() {
  if (!operators.length) return;

  if (currentOperator) {
    const row = currentOperator.row;
    renderToday(row);
    renderNextTurns(row);
    renderStats(row);
    renderCalendar(row);
  } else {
    renderTodayAll();
    renderNextAll();
    renderStatsAll();
    renderAllOperatorsCalendar();
  }

  try {
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
    localStorage.setItem(YEAR_KEY, String(getYear()));
  } catch (error) {
    console.warn("No se pudo guardar la selección.", error);
  }
}

/* =========================================
   IR A HOY
========================================= */

$("todayBtn").addEventListener("click", goToday);

function goToday() {
  const today = getToday();

  $("year").value = today.getFullYear();
  detectMonths();
  selectCurrentMonthByDefault();
  render();

  requestAnimationFrame(() => {
    const dayElement = $("today");
    const monthElement = $(`month-${today.getFullYear()}-${today.getMonth()}`);
    const target = dayElement || monthElement;

    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: dayElement ? "center" : "start",
        inline: "center",
      });
    } else {
      alert(
        "No hay planificación del mes actual en el CSV. " +
          "Comprueba que el archivo incluya ese mes.",
      );
    }
  });
}

$("monthFilter").addEventListener("change", function () {
  selectedMonthFilter = this.value || "all";
  if (operators.length) render();
});

$("printBtn").addEventListener("click", function () {
  window.print();
});

const THEME_KEY = "turnos_operaciones_theme_v1";

function applyTheme(dark) {
  document.body.classList.toggle("dark-mode", dark);
  $("themeBtn").textContent = dark ? "☀️ Modo claro" : "🌙 Modo oscuro";
  $("themeBtn").setAttribute("aria-pressed", String(dark));
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch (error) {
    console.warn("No se pudo guardar el tema.", error);
  }
}

$("themeBtn").addEventListener("click", function () {
  applyTheme(!document.body.classList.contains("dark-mode"));
});

/* =========================================
         MVC: MODELO DE INFORMES
         Construye los datos del informe sin manipular el DOM.
      ========================================= */

const ReportModel = {
  getSelection() {
    const selectedMonths =
      selectedMonthFilter === "all"
        ? [...months]
        : months.filter(
            (month) => `${month.year}-${month.index}` === selectedMonthFilter,
          );

    const selectedOperators = currentOperator
      ? [currentOperator]
      : [...operators];

    return { selectedMonths, selectedOperators };
  },

  buildRows() {
    const { selectedMonths, selectedOperators } = this.getSelection();
    const output = [];
    const totals = this.createTotals();

    const headers = [
      "TIPO",
      "FECHA",
      "DIA",
      "MES",
      "AÑO",
      "OPERADOR",
      "CODIGO TURNO",
      "TURNO",
      "HORARIO",
      "CENTRO",
      "HORAS",
      "ESTADO",
      "MA",
      "ML",
      "TA",
      "TL",
      "NA",
      "NL",
      "ARTEIXO",
      "LARACHA",
      "LIBRES",
      "TOTAL DIAS",
    ];

    output.push(headers);

    selectedMonths.forEach((month) => {
      selectedOperators.forEach((operator) => {
        const monthData = getMonthData(month, operator.row);
        const operatorTotals = this.createTotals();

        [...monthData.entries()]
          .sort((a, b) => a[0] - b[0])
          .forEach(([day, code]) => {
            const date = new Date(month.year, month.index, day);
            const shift = code ? SHIFTS[code] : null;
            const worked = Boolean(shift);

            operatorTotals.totalDays++;
            if (worked) {
              operatorTotals[code]++;
              operatorTotals.hours += 8;
              if (code.endsWith("A")) operatorTotals.arteixo++;
              if (code.endsWith("L")) operatorTotals.laracha++;
            } else {
              operatorTotals.free++;
            }

            output.push([
              "DETALLE",
              date.toLocaleDateString("es-ES"),
              date.toLocaleDateString("es-ES", { weekday: "long" }),
              month.name,
              month.year,
              operator.name,
              code || "",
              shift?.name || "Día libre",
              shift?.time || "",
              shift ? (code.endsWith("A") ? "Arteixo" : "Laracha") : "",
              worked ? 8 : 0,
              worked ? "TRABAJADO" : "LIBRE",
              code === "MA" ? 1 : 0,
              code === "ML" ? 1 : 0,
              code === "TA" ? 1 : 0,
              code === "TL" ? 1 : 0,
              code === "NA" ? 1 : 0,
              code === "NL" ? 1 : 0,
              worked && code.endsWith("A") ? 1 : 0,
              worked && code.endsWith("L") ? 1 : 0,
              worked ? 0 : 1,
              1,
            ]);
          });

        this.addTotals(totals, operatorTotals);
        output.push([
          "RESUMEN",
          "",
          "",
          month.name,
          month.year,
          operator.name,
          "",
          "",
          "",
          "",
          operatorTotals.hours,
          "",
          operatorTotals.MA,
          operatorTotals.ML,
          operatorTotals.TA,
          operatorTotals.TL,
          operatorTotals.NA,
          operatorTotals.NL,
          operatorTotals.arteixo,
          operatorTotals.laracha,
          operatorTotals.free,
          operatorTotals.totalDays,
        ]);
      });
    });

    output.push([]);
    output.push(["RESUMEN ESTADISTICO"]);
    output.push(headers);

    selectedOperators.forEach((operator) => {
      const operatorTotals = this.createTotals();

      selectedMonths.forEach((month) => {
        const monthData = getMonthData(month, operator.row);
        monthData.forEach((code) => {
          operatorTotals.totalDays++;
          if (code && SHIFTS[code]) {
            operatorTotals[code]++;
            operatorTotals.hours += 8;
            if (code.endsWith("A")) operatorTotals.arteixo++;
            if (code.endsWith("L")) operatorTotals.laracha++;
          } else {
            operatorTotals.free++;
          }
        });
      });

      output.push([
        "RESUMEN",
        "",
        "",
        "",
        "",
        operator.name,
        "",
        "",
        "",
        "",
        operatorTotals.hours,
        "",
        operatorTotals.MA,
        operatorTotals.ML,
        operatorTotals.TA,
        operatorTotals.TL,
        operatorTotals.NA,
        operatorTotals.NL,
        operatorTotals.arteixo,
        operatorTotals.laracha,
        operatorTotals.free,
        operatorTotals.totalDays,
      ]);
    });

    output.push([
      "TOTAL GENERAL",
      "",
      "",
      "",
      "",
      "TODOS",
      "",
      "",
      "",
      "",
      totals.hours,
      "",
      totals.MA,
      totals.ML,
      totals.TA,
      totals.TL,
      totals.NA,
      totals.NL,
      totals.arteixo,
      totals.laracha,
      totals.free,
      totals.totalDays,
    ]);

    return { rows: output, selectedMonths, selectedOperators };
  },

  createTotals() {
    return {
      MA: 0,
      ML: 0,
      TA: 0,
      TL: 0,
      NA: 0,
      NL: 0,
      arteixo: 0,
      laracha: 0,
      free: 0,
      hours: 0,
      totalDays: 0,
    };
  },

  addTotals(target, source) {
    Object.keys(target).forEach((key) => {
      target[key] += source[key] || 0;
    });
  },

  toCSV(rows) {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return "\uFEFF" + rows.map((row) => row.map(escape).join(";")).join("\r\n");
  },
};

/* =========================================
         MVC: VISTA DE INFORMES
         Se ocupa exclusivamente de presentar/descargar.
      ========================================= */

const ReportView = {
  downloadWorkbook(monthSheets, summaryRows, filename) {
    if (!window.XLSX) {
      alert(
        "No se ha podido cargar el generador de Excel. Comprueba tu conexión e inténtalo de nuevo.",
      );
      return;
    }

    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    const uniqueSheetName = (rawName) => {
      const base =
        String(rawName || "Hoja")
          .replace(/[\\/?*\[\]:]/g, " ")
          .trim()
          .slice(0, 31) || "Hoja";
      let name = base;
      let suffix = 2;
      while (usedNames.has(name.toLowerCase())) {
        const ending = ` (${suffix++})`;
        name = base.slice(0, 31 - ending.length) + ending;
      }
      usedNames.add(name.toLowerCase());
      return name;
    };

    monthSheets.forEach(({ name, rows }) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 9 },
        { wch: 22 },
        { wch: 14 },
        { wch: 24 },
        { wch: 18 },
        { wch: 14 },
        { wch: 10 },
        { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(name));
    });

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = Array.from({ length: 22 }, (_, index) => ({
      wch: index === 5 ? 24 : index === 7 ? 24 : 15,
    }));
    XLSX.utils.book_append_sheet(
      workbook,
      summarySheet,
      uniqueSheetName("Resumen general"),
    );
    XLSX.writeFile(workbook, filename);
  },
};

/* =========================================
         MVC: CONTROLADOR DE INFORMES
         Coordina modelo y vista ante la acción del usuario.
      ========================================= */

const ReportController = {
  export() {
    if (!operators.length) {
      alert("Primero debes cargar una planificación.");
      return;
    }

    const report = ReportModel.buildRows();
    const monthSheets = [];
    const previousMonthFilter = selectedMonthFilter;

    // Genera una hoja independiente por cada mes que entra en el filtro.
    try {
      report.selectedMonths.forEach((month) => {
        selectedMonthFilter = `${month.year}-${month.index}`;
        const monthlyReport = ReportModel.buildRows();
        monthSheets.push({
          name: `${month.name} ${month.year}`,
          rows: monthlyReport.rows,
        });
      });
    } finally {
      selectedMonthFilter = previousMonthFilter;
    }

    const monthLabel =
      selectedMonthFilter === "all"
        ? "TODOS_LOS_MESES"
        : (report.selectedMonths[0]?.name || "MES") +
          "_" +
          (report.selectedMonths[0]?.year || "");
    const operatorLabel = currentOperator
      ? currentOperator.name
      : "TODOS_LOS_OPERADORES";
    const safe = (value) =>
      String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

    ReportView.downloadWorkbook(
      monthSheets,
      report.rows,
      `INFORME_${safe(monthLabel)}_${safe(operatorLabel)}.xlsx`,
    );
  },
};

$("exportBtn").addEventListener("click", () => ReportController.export());

/* =========================================
   CAMBIAR AÑO
========================================= */

$("year").value = new Date().getFullYear();

$("year").addEventListener("change", function () {
  if (!currentOperator) return;

  if (getYear() < 2000 || getYear() > 2100) {
    alert("Introduce un año válido entre 2000 y 2100.");
    $("year").value = new Date().getFullYear();
  }

  detectMonths();
  selectedMonthFilter = "all";
  statsStartDate = "";
  statsEndDate = "";
  render();
});

/* =========================================
   BORRAR PLANIFICACIÓN
========================================= */

$("resetBtn").addEventListener("click", function () {
  const confirmDelete = confirm(
    "¿Quieres borrar la planificación guardada?\n\n" +
      "Tendrás que volver a cargar el CSV.",
  );

  if (!confirmDelete) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OPERATOR_KEY);
    localStorage.removeItem(YEAR_KEY);
  } catch (error) {
    console.error(error);
  }

  rows = [];
  months = [];
  operators = [];
  currentOperator = null;
  csvContent = "";

  $("csvFile").value = "";

  $("operator").innerHTML = '<option value="">Carga un CSV primero</option>';

  $("operator").disabled = true;
  $("todayBtn").disabled = true;
  $("printBtn").disabled = true;
  $("exportBtn").disabled = true;
  $("monthFilter").disabled = true;
  $("monthFilter").innerHTML =
    '<option value="all">Todos los meses disponibles</option>';
  selectedMonthFilter = "all";
  statsStartDate = "";
  statsEndDate = "";

  $("fileStatus").textContent = "Planificación borrada";

  updateStorageStatus(false);

  $("todayPanel").innerHTML = `
        <div class="empty-state">
            <div class="emoji">📂</div>
            <strong>Cargue un archivo CSV</strong>
            <p>Seleccione la planificación para consultar los turnos.</p>
        </div>
    `;

  $("nextPanel").innerHTML = `
        <h3 class="panel-title">📅 Próximos turnos</h3>
        <p>Esperando planificación...</p>
    `;

  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen anual</h3>
        <p>Sin datos disponibles.</p>
    `;

  $("container").innerHTML = `
        <div class="panel empty-state">
            <div class="emoji">🗓️</div>
            El calendario aparecerá aquí.
        </div>
    `;
});

/* =========================================
   INICIO AUTOMÁTICO
========================================= */

(function init() {
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(savedTheme === "dark");

    // Siempre utilizar el año actual al abrir la página.
    $("year").value = new Date().getFullYear();
  } catch (error) {
    console.warn(error);
  }

  fetch("horarios2026.csv")
    .then((r) => {
      if (!r.ok) {
        throw new Error("No existe CSV remoto");
      }

      return r.text();
    })
    .then((csv) => {
      csvContent = csv;

      rows = parseCSV(csv);

      $("year").value = new Date().getFullYear();

      detectMonths();

      fillOperators();

      // Seleccionar automáticamente el mes actual.
      selectCurrentMonthByDefault();

      // Activar controles.
      $("todayBtn").disabled = false;
      $("printBtn").disabled = false;
      $("exportBtn").disabled = false;
      $("monthFilter").disabled = false;

      // Dibujar el calendario.
      render();

      // Ir visualmente al mes y día actual.
      scrollToTodayAfterRender();

      $("fileStatus").textContent = "✓ CSV cargado automáticamente";

      updateStorageStatus(false);
    })
    .catch((error) => {
      console.error("Error cargando CSV remoto:", error);

      // Si falla GitHub, intentar recuperar la planificación local.
      restoreCSV();
    });
})();
