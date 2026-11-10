// MICROCLIMATE ENVIRONMENTAL MONITORING SYSTEM
// NO RANDOM NUMBERS. NO SIMULATED SENSOR READINGS.
// Displays actual readings only when received from ESP32/API.

const $ = id => document.getElementById(id);

const SITE = {
    lat: 13.90,
    lon: 121.05
};

const state = {
    temperature: null,
    humidity: null,
    rainfallIntensity: null,
    rainfallAccumulation: null,
    rainfallTips: null,
    solarRadiation: null,
    heatIndex: null,

    source: "WAITING",
    apiConnected: false,
    lastReceived: null,

    endpoint: "",
    live: false,
    pollTimer: null,

    history: [],
    alerts: [],

    thresholds: {
        yellow: 7.5,
        orange: 15,
        red: 30
    }
};

const pages = [
    "dashboard",
    "humidity",
    "rainfall",
    "radiation",
    "heat",
    "records",
    "settings"
];

const titles = {
    dashboard: "Overview",
    humidity: "Humidity Monitoring",
    rainfall: "Rain Gauge Monitoring",
    radiation: "Solar Radiation",
    heat: "Temperature & Heat Index",
    records: "Sensor Records",
    settings: "Settings & Connection"
};


// ==================================================
// NAVIGATION
// ==================================================

function setPage(page) {

    if (!pages.includes(page)) return;

    document.querySelectorAll(".page").forEach(element => {
        element.classList.toggle(
            "active",
            element.id === "page-" + page
        );
    });

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === page
        );
    });

    $("pageTitle").textContent = titles[page];

    $("sidebar").classList.remove("open");

    setTimeout(drawAllCharts, 100);
}

document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => {
        setPage(button.dataset.page);
    });
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", event => {
        event.preventDefault();
        setPage(button.dataset.go);
    });
});

$("mobileMenu").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
});

$("currentDate").textContent = new Date().toLocaleDateString(
    "en-PH",
    {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    }
);


// ==================================================
// GENERAL HELPERS
// ==================================================

function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function showNumber(value, decimals = 1) {

    return isNumber(value)
        ? value.toFixed(decimals)
        : "--";
}

function escapeHTML(value) {

    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[character]));
}

function toast(message) {

    const element = $("toast");

    element.textContent = message;
    element.classList.add("show");

    setTimeout(() => {
        element.classList.remove("show");
    }, 2500);
}

function hasAnySensorReading() {

    return [
        state.temperature,
        state.humidity,
        state.rainfallIntensity,
        state.rainfallAccumulation,
        state.rainfallTips,
        state.solarRadiation
    ].some(isNumber);
}


// ==================================================
// HEAT INDEX CALCULATION
// ==================================================

function heatIndexC(temperature, humidity) {

    if (!isNumber(temperature) || !isNumber(humidity)) {
        return null;
    }

    const fahrenheit = temperature * 9 / 5 + 32;

    let heatIndex = 0.5 * (
        fahrenheit +
        61 +
        ((fahrenheit - 68) * 1.2) +
        (humidity * 0.094)
    );

    if (heatIndex >= 80) {

        heatIndex =
            -42.379 +
            2.04901523 * fahrenheit +
            10.14333127 * humidity -
            0.22475541 * fahrenheit * humidity -
            0.00683783 * fahrenheit * fahrenheit -
            0.05481717 * humidity * humidity +
            0.00122874 * fahrenheit * fahrenheit * humidity +
            0.00085282 * fahrenheit * humidity * humidity -
            0.00000199 * fahrenheit * fahrenheit * humidity * humidity;

        if (
            humidity < 13 &&
            fahrenheit >= 80 &&
            fahrenheit <= 112
        ) {
            heatIndex -=
                ((13 - humidity) / 4) *
                Math.sqrt(
                    (17 - Math.abs(fahrenheit - 95)) / 17
                );
        }

        else if (
            humidity > 85 &&
            fahrenheit >= 80 &&
            fahrenheit <= 87
        ) {
            heatIndex +=
                ((humidity - 85) / 10) *
                ((87 - fahrenheit) / 5);
        }
    }

    return (heatIndex - 32) * 5 / 9;
}


function heatBand(value) {

    if (!isNumber(value)) {
        return ["Waiting for sensor data", "neutral"];
    }

    if (value < 27) return ["Lower heat-index range", "good"];

    if (value < 33) return ["Caution", "warning"];

    if (value < 42) return ["Extreme caution", "warning"];

    if (value < 52) return ["Danger", "danger"];

    return ["Extreme danger", "danger"];
}


// ==================================================
// RAINFALL WARNING CLASSIFICATION
// ==================================================

function rainBand(value) {

    if (!isNumber(value)) {

        return [
            "WAITING",
            "neutral",
            "Waiting for actual rain gauge readings."
        ];
    }

    const t = state.thresholds;

    if (value >= t.red) {

        return [
            "RED",
            "red",
            "Local rainfall reading reached the configured Red threshold. Follow official emergency instructions."
        ];
    }

    if (value >= t.orange) {

        return [
            "ORANGE",
            "orange",
            "Local rainfall reading reached the configured Orange threshold. Be prepared and monitor official advisories."
        ];
    }

    if (value >= t.yellow) {

        return [
            "YELLOW",
            "yellow",
            "Local rainfall reading reached the configured Yellow threshold. Stay alert."
        ];
    }

    return [
        "NORMAL",
        "neutral",
        "Local rainfall reading is below the configured Yellow threshold."
    ];
}


// ==================================================
// SENSOR HISTORY
// ==================================================

function addHistory(timestamp = new Date()) {

    // Never save a record when there are no actual readings.
    if (!hasAnySensorReading()) return;

    const row = {

        time: new Date(timestamp),

        temperature: state.temperature,

        humidity: state.humidity,

        heatIndex: state.heatIndex,

        rainfallIntensity: state.rainfallIntensity,

        rainfallAccumulation: state.rainfallAccumulation,

        rainfallTips: state.rainfallTips,

        solarRadiation: state.solarRadiation,

        source: "LIVE"
    };

    state.history.unshift(row);

    state.history = state.history.slice(0, 500);

    try {

        localStorage.setItem(
            "microclimateHistory",
            JSON.stringify(state.history)
        );

    } catch (error) {

        console.error("History storage error:", error);
    }
}


function valuesForToday(field) {

    const today = new Date().toDateString();

    return state.history
        .filter(row =>
            new Date(row.time).toDateString() === today
        )
        .map(row => row[field])
        .filter(isNumber);
}


function average(values) {

    if (!values.length) return null;

    return values.reduce(
        (total, value) => total + value,
        0
    ) / values.length;
}


function minValue(values) {

    return values.length
        ? Math.min(...values)
        : null;
}


function maxValue(values) {

    return values.length
        ? Math.max(...values)
        : null;
}


// ==================================================
// ALERT HISTORY
// ==================================================

function addAlert(title, detail, level) {

    const previous = state.alerts[0];

    if (
        previous &&
        previous.title === title &&
        Date.now() - previous.ms < 60000
    ) {
        return;
    }

    state.alerts.unshift({

        title,
        detail,
        level,

        ms: Date.now(),

        time: new Date().toLocaleString("en-PH", {
            dateStyle: "medium",
            timeStyle: "short"
        })
    });

    state.alerts = state.alerts.slice(0, 20);
}


function renderRecent() {

    const html = state.alerts.length

        ? state.alerts.slice(0, 4).map(alert => `

            <div class="recent-item">

                <span class="recent-mark ${
                    alert.level === "red"
                        ? "danger"
                        : alert.level === "yellow" ||
                          alert.level === "orange"
                            ? "warn"
                            : ""
                }"></span>

                <div>
                    <b>${escapeHTML(alert.title)}</b>

                    <small>
                        ${escapeHTML(alert.detail)}
                        ·
                        ${escapeHTML(alert.time)}
                    </small>
                </div>

            </div>

        `).join("")

        : `
            <div class="recent-item">

                <span class="recent-mark"></span>

                <div>
                    <b>No sensor alerts yet</b>

                    <small>
                        Alerts will appear when actual sensor readings
                        reach configured thresholds.
                    </small>
                </div>

            </div>
        `;

    $("recentAlerts").innerHTML = html;

    $("rainLog").innerHTML = html;
}


// ==================================================
// SENSOR RECORDS TABLE
// ==================================================

function renderRecords() {

    $("recordCount").textContent =
        state.history.length +
        " actual sensor readings · newest first";

    $("recordsBody").innerHTML = state.history
        .slice(0, 50)
        .map(row => `

            <tr>

                <td>
                    ${new Date(row.time).toLocaleString("en-PH")}
                </td>

                <td>
                    ${showNumber(row.temperature)} °C
                </td>

                <td>
                    ${showNumber(row.humidity, 0)}%
                </td>

                <td>
                    ${showNumber(row.heatIndex)} °C
                </td>

                <td>
                    ${showNumber(row.rainfallIntensity)} mm/hr
                </td>

                <td>
                    ${showNumber(row.solarRadiation, 0)} W/m²
                </td>

                <td>
                    <span class="source-pill">LIVE</span>
                </td>

            </tr>

        `).join("");
}


// ==================================================
// UPDATE ALL SENSOR INTERFACES
// ==================================================

function updateUI() {

    state.heatIndex = heatIndexC(
        state.temperature,
        state.humidity
    );

    const rain = rainBand(state.rainfallIntensity);

    const heat = heatBand(state.heatIndex);

    const connected = state.apiConnected;


    // MAIN DASHBOARD

    $("dashTemp").textContent =
        showNumber(state.temperature);

    $("dashHumidity").textContent =
        showNumber(state.humidity, 0);

    $("dashHeat").textContent =
        showNumber(state.heatIndex);

    $("dashRain").textContent =
        showNumber(state.rainfallIntensity);

    $("dashSolar").textContent =
        showNumber(state.solarRadiation, 0);

    $("dashHeatStatus").textContent =
        heat[0];

    $("dashRainStatus").textContent =
        rain[0] === "WAITING"
            ? "Waiting for rain gauge"
            : rain[0] === "NORMAL"
                ? "Below warning level"
                : rain[0] + " warning";


    // HUMIDITY PAGE

    const humidityValues = valuesForToday("humidity");

    $("humValue").textContent =
        showNumber(state.humidity, 0);

    $("humGaugeValue").textContent =
        isNumber(state.humidity)
            ? Math.round(state.humidity) + "%"
            : "--";

    const humidityPercent = isNumber(state.humidity)
        ? Math.max(0, Math.min(100, state.humidity))
        : 0;

    $("humidityGauge").style.background =
        isNumber(state.humidity)

            ? `conic-gradient(
                #438ee0 0 ${humidityPercent}%,
                #d7e7f8 ${humidityPercent}% 100%
              )`

            : "conic-gradient(#d7e7f8 0 100%)";

    $("humStatus").textContent =
        !isNumber(state.humidity)

            ? "Waiting for humidity sensor"

            : state.humidity > 60

                ? "High humidity"

                : state.humidity < 30

                    ? "Dry air"

                    : "Moderate humidity";

    $("humMin").textContent =
        showNumber(minValue(humidityValues), 0);

    $("humMax").textContent =
        showNumber(maxValue(humidityValues), 0);

    $("humAvg").textContent =
        showNumber(average(humidityValues), 0);


    // RAIN GAUGE PAGE

    $("rainIntensity").textContent =
        showNumber(state.rainfallIntensity);

    $("rainAccum").textContent =
        showNumber(state.rainfallAccumulation);

    $("rainTips").textContent =
        showNumber(state.rainfallTips, 0);


    // SOLAR RADIATION PAGE

    const solarValues = valuesForToday("solarRadiation");

    $("solarValue").textContent =
        showNumber(state.solarRadiation, 0);

    $("solarPeak").textContent =
        showNumber(maxValue(solarValues), 0);

    $("solarAvg").textContent =
        showNumber(average(solarValues), 0);

    // Daily irradiation is not estimated without integrated readings.
    $("solarDaily").textContent = "--";


    // HEAT INDEX PAGE

    const heatValues = valuesForToday("heatIndex");

    $("heatValue").textContent =
        showNumber(state.heatIndex);

    $("heatStatus").textContent =
        heat[0];

    $("heatTemp").textContent =
        showNumber(state.temperature);

    $("heatHumidity").textContent =
        showNumber(state.humidity, 0);

    $("heatMax").textContent =
        showNumber(maxValue(heatValues));

    $("thermoFill").style.height =
        isNumber(state.heatIndex)

            ? Math.min(
                100,
                Math.max(10, (state.heatIndex / 55) * 100)
            ) + "%"

            : "0%";


    // MAIN ALERT

    $("mainAlert").className =
        "alert-banner " + rain[1];

    $("mainAlertTitle").textContent =
        rain[0] === "WAITING"

            ? "Waiting for rain gauge data"

            : rain[0] === "NORMAL"

                ? "Monitoring is active"

                : rain[0] + " RAINFALL ALERT";

    $("mainAlertText").textContent =
        rain[2];

    $("alertUpdated").textContent =
        state.lastReceived

            ? "UPDATED " +
              new Date(state.lastReceived).toLocaleTimeString(
                  "en-PH",
                  {
                      hour: "2-digit",
                      minute: "2-digit"
                  }
              )

            : "NO SENSOR DATA";


    // RAINFALL ALERT

    $("rainAlert").className =
        "alert-banner " + rain[1];

    $("rainAlertTitle").textContent =
        rain[0] === "WAITING"

            ? "Waiting for rain gauge data"

            : rain[0] === "NORMAL"

                ? "Below rainfall warning threshold"

                : rain[0] + " RAINFALL WARNING";

    $("rainAlertText").textContent =
        rain[2];

    $("rainAlertLevel").textContent =
        rain[0];


    // SYSTEM CONNECTION STATUS

    $("modeLabel").textContent =
        connected
            ? "LIVE SENSOR DATA"
            : "WAITING FOR SENSORS";

    $("sideStatus").textContent =
        connected
            ? "Backend connected"
            : "Waiting for sensors";

    $("sideStatusText").textContent =
        connected
            ? "Actual sensor readings received"
            : "No prototype readings received";

    $("sideStatusDot").classList.toggle(
        "connected",
        connected
    );

    $("healthTH").textContent =
        isNumber(state.temperature) &&
        isNumber(state.humidity)
            ? "Live"
            : "No data";

    $("healthRain").textContent =
        isNumber(state.rainfallIntensity)
            ? "Live"
            : "No data";

    $("healthSolar").textContent =
        isNumber(state.solarRadiation)
            ? "Live"
            : "No data";

    $("healthESP").textContent =
        connected
            ? "Connected"
            : "Waiting";


    // REMOVE OLD DEMO LABELS FROM ORIGINAL HTML

    const refreshLabel =
        document.querySelector(".subtle-label");

    if (refreshLabel) {
        refreshLabel.textContent = connected
            ? "LIVE API DATA · 10 SEC REFRESH"
            : "WAITING FOR ACTUAL SENSOR DATA";
    }

    const recordsNote =
        document.querySelector("#page-records .info-callout");

    if (recordsNote) {
        recordsNote.textContent =
            "Only actual readings received from the ESP32/backend API are stored. No simulated sensor records are generated.";
    }

    const dashboardChartNote =
        document.querySelector(".lower-grid .panel-heading p");

    if (dashboardChartNote) {
        dashboardChartNote.textContent =
            "Historical readings from connected sensors only";
    }

    const rainTipsNote =
        document.querySelector("#page-rainfall .metric-foot:last-child");

    if (rainTipsNote) {
        rainTipsNote.textContent =
            "Pulse count from connected rain gauge";
    }

    const healthFooter =
        document.querySelector(".health-footer");

    if (healthFooter) {
        healthFooter.textContent = connected
            ? "Actual sensor data is being received from your configured endpoint."
            : "Sensor information will appear after the ESP32/backend sends actual readings.";
    }

    renderRecent();

    renderRecords();

    drawAllCharts();
}


// ==================================================
// CONNECT TO ESP32 / BACKEND API
// ==================================================

async function pollEndpoint() {

    if (!state.live || !state.endpoint) return;

    try {

        const response = await fetch(state.endpoint, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const responseData = await response.json();

        // Supports either direct JSON or nested { data: {...} } format.
        const data =
            responseData.data ||
            responseData.sensors ||
            responseData;

        const fields = [
            "temperature",
            "humidity",
            "rainfallIntensity",
            "rainfallAccumulation",
            "rainfallTips",
            "solarRadiation"
        ];

        let receivedAtLeastOneValue = false;

        fields.forEach(field => {

            const value = data[field];

            if (
                value !== null &&
                value !== undefined &&
                value !== "" &&
                Number.isFinite(Number(value))
            ) {

                state[field] = Number(value);

                receivedAtLeastOneValue = true;
            }
        });

        // API connection alone does not mean sensors are connected.
        if (!receivedAtLeastOneValue) {

            state.apiConnected = false;

            throw new Error(
                "API responded, but no valid sensor readings were received."
            );
        }

        state.source = "LIVE";

        state.apiConnected = true;

        state.lastReceived =
            data.timestamp || new Date().toISOString();

        state.heatIndex = heatIndexC(
            state.temperature,
            state.humidity
        );

        // Create warning only when actual rainfall data exists.
        const rain = rainBand(state.rainfallIntensity);

        if (
            rain[0] !== "WAITING" &&
            rain[0] !== "NORMAL"
        ) {

            addAlert(
                rain[0] + " local rainfall threshold reached",

                state.rainfallIntensity.toFixed(1) +
                " mm/hr from connected sensor data",

                rain[1]
            );
        }

        addHistory(state.lastReceived);

        updateUI();

        $("connectionMessage").textContent =
            "Connected. Actual sensor readings received.";

    }

    catch (error) {

        state.apiConnected = false;

        $("connectionMessage").textContent =
            "Connection/data error: " + error.message;

        $("sideStatusText").textContent =
            "No new sensor data received";

        updateUI();
    }
}


// ==================================================
// CHART GENERATOR
// ==================================================

function chart(canvasId, values, color) {

    const canvas = $(canvasId);

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (rect.width < 10) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;

    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;

    const height = rect.height;

    // No actual readings means no chart values.
    if (!values.length) {

        ctx.clearRect(0, 0, width, height);

        ctx.font = "11px DM Sans";

        ctx.fillStyle = "#98a5b5";

        ctx.textAlign = "center";

        ctx.fillText(
            "Waiting for actual sensor data",
            width / 2,
            height / 2
        );

        return;
    }

    const padding = {
        left: 35,
        right: 12,
        top: 15,
        bottom: 27
    };

    let min = Math.min(...values);

    let max = Math.max(...values);

    if (min === max) {
        min -= 1;
        max += 1;
    }

    const extra = (max - min) * 0.2;

    min -= extra;

    max += extra;

    ctx.font = "9px DM Sans";

    ctx.strokeStyle = "#edf1f6";

    ctx.fillStyle = "#96a3b3";

    ctx.lineWidth = 1;

    // Grid lines

    for (let i = 0; i < 4; i++) {

        const y =
            padding.top +
            (height - padding.top - padding.bottom) * i / 3;

        ctx.beginPath();

        ctx.moveTo(padding.left, y);

        ctx.lineTo(width - padding.right, y);

        ctx.stroke();

        ctx.fillText(
            (max - (max - min) * i / 3).toFixed(0),
            2,
            y + 3
        );
    }

    // Actual sensor points

    const points = values.map((value, index) => ({

        x:
            padding.left +
            (width - padding.left - padding.right) *
            index / Math.max(1, values.length - 1),

        y:
            padding.top +
            (height - padding.top - padding.bottom) *
            (1 - (value - min) / (max - min))

    }));

    const gradient = ctx.createLinearGradient(
        0,
        padding.top,
        0,
        height - padding.bottom
    );

    gradient.addColorStop(0, color + "35");

    gradient.addColorStop(1, color + "00");

    // Area

    ctx.beginPath();

    points.forEach((point, index) => {

        if (index === 0) {
            ctx.moveTo(point.x, point.y);
        } else {
            ctx.lineTo(point.x, point.y);
        }

    });

    ctx.lineTo(
        points[points.length - 1].x,
        height - padding.bottom
    );

    ctx.lineTo(
        points[0].x,
        height - padding.bottom
    );

    ctx.closePath();

    ctx.fillStyle = gradient;

    ctx.fill();

    // Line

    ctx.beginPath();

    points.forEach((point, index) => {

        if (index === 0) {
            ctx.moveTo(point.x, point.y);
        } else {
            ctx.lineTo(point.x, point.y);
        }

    });

    ctx.strokeStyle = color;

    ctx.lineWidth = 2.2;

    ctx.stroke();

    // Latest value

    const last = points[points.length - 1];

    ctx.beginPath();

    ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);

    ctx.fillStyle = color;

    ctx.fill();

    ctx.fillStyle = "#9aa6b5";

    ctx.textAlign = "center";

    ctx.fillText("Oldest", points[0].x, height - 7);

    ctx.fillText("Latest", last.x, height - 7);
}


// ==================================================
// CHART DATA
// ==================================================

function series(field) {

    return state.history
        .slice(0, 24)
        .reverse()
        .map(row => row[field])
        .filter(isNumber);
}


function drawAllCharts() {

    const selected =
        $("dashChartSelect")?.value || "temperature";

    const settings = {

        temperature: [
            "temperature",
            "#e99a43"
        ],

        humidity: [
            "humidity",
            "#438ee0"
        ],

        rain: [
            "rainfallIntensity",
            "#1ca7bf"
        ],

        solar: [
            "solarRadiation",
            "#d5a832"
        ],

        heat: [
            "heatIndex",
            "#df655e"
        ]
    };

    const [field, color] = settings[selected];

    chart(
        "dashChart",
        series(field),
        color
    );

    chart(
        "humidityChart",
        series("humidity"),
        "#438ee0"
    );

    chart(
        "rainChart",
        series("rainfallIntensity"),
        "#1ca7bf"
    );

    chart(
        "solarChart",
        series("solarRadiation"),
        "#d5a832"
    );

    chart(
        "heatChart",
        series("heatIndex"),
        "#df655e"
    );
}

$("dashChartSelect").addEventListener(
    "change",
    drawAllCharts
);

window.addEventListener(
    "resize",
    drawAllCharts
);


// ==================================================
// 7-DAY EXTERNAL WEATHER FORECAST
// ==================================================

// This forecast comes from Open-Meteo.
// It is NOT a local sensor reading or prototype measurement.

async function loadForecast() {

    const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_max,precipitation_probability_max,precipitation_sum,sunrise,sunset&timezone=Asia%2FManila&forecast_days=7`;

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Forecast unavailable");
        }

        const data = await response.json();

        const daily = data.daily;

        const icons = {

            0: "☀",
            1: "🌤",
            2: "⛅",
            3: "☁",
            45: "🌫",
            48: "🌫",
            51: "🌦",
            53: "🌦",
            55: "🌧",
            61: "🌧",
            63: "🌧",
            65: "🌧",
            71: "🌨",
            80: "🌦",
            81: "🌧",
            82: "⛈",
            95: "⛈",
            96: "⛈",
            99: "⛈"
        };

        $("forecastList").innerHTML =
            daily.time.map((date, index) => {

                const dateObject =
                    new Date(date + "T12:00:00");

                const day =
                    index === 0
                        ? "Today"
                        : dateObject.toLocaleDateString(
                            "en-US",
                            { weekday: "short" }
                        );

                const forecastHeat = heatIndexC(
                    daily.temperature_2m_max[index],
                    daily.relative_humidity_2m_max[index]
                );

                const icon =
                    icons[daily.weather_code[index]] || "🌤";

                const rainChance =
                    daily.precipitation_probability_max[index] ?? "--";

                return `

                    <div class="forecast-day">

                        <div class="day">${day}</div>

                        <div class="weather-symbol">
                            ${icon}
                        </div>

                        <div class="temp">
                            ${Math.round(daily.temperature_2m_max[index])}°
                        </div>

                        <div class="low">
                            ${Math.round(daily.temperature_2m_min[index])}° low
                        </div>

                        <div class="rain-chance">
                            ☂ ${rainChance}%
                        </div>

                        <div class="hi">
                            Forecast HI ~${forecastHeat.toFixed(0)}°C
                        </div>

                    </div>

                `;

            }).join("");

    }

    catch (error) {

        $("forecastList").innerHTML = `

            <div class="loading">
                Weather forecast unavailable.
                Check your internet connection.
            </div>

        `;
    }
}


// ==================================================
// SETTINGS: ESP32 CONNECTION
// ==================================================

$("saveConnection").addEventListener("click", () => {

    state.endpoint = $("endpoint").value.trim();

    state.live = $("liveToggle").checked;

    localStorage.setItem(
        "microEndpoint",
        state.endpoint
    );

    localStorage.setItem(
        "microLive",
        String(state.live)
    );

    // Stop previous polling timer.
    if (state.pollTimer) {

        clearInterval(state.pollTimer);

        state.pollTimer = null;
    }

    if (state.live && !state.endpoint) {

        $("connectionMessage").textContent =
            "Please enter your ESP32/backend API URL first.";

        $("liveToggle").checked = false;

        state.live = false;

        localStorage.setItem("microLive", "false");

        return;
    }

    if (state.live) {

        $("connectionMessage").textContent =
            "Connecting to ESP32/backend endpoint...";

        pollEndpoint();

        // Refresh actual sensor readings every 10 seconds.
        state.pollTimer = setInterval(
            pollEndpoint,
            10000
        );

    } else {

        // Clear current sensor values when live mode is disabled.
        state.temperature = null;

        state.humidity = null;

        state.rainfallIntensity = null;

        state.rainfallAccumulation = null;

        state.rainfallTips = null;

        state.solarRadiation = null;

        state.heatIndex = null;

        state.source = "WAITING";

        state.apiConnected = false;

        state.lastReceived = null;

        state.history = [];

        state.alerts = [];

        localStorage.removeItem("microclimateHistory");

        $("connectionMessage").textContent =
            "Connection disabled. Waiting for actual sensor readings.";

        updateUI();
    }

    toast("Connection settings saved.");
});


// ==================================================
// SETTINGS: RAINFALL THRESHOLDS
// ==================================================

$("saveThresholds").addEventListener("click", () => {

    const yellow = Number($("yellowThreshold").value);

    const orange = Number($("orangeThreshold").value);

    const red = Number($("redThreshold").value);

    if (!(yellow > 0 && orange > yellow && red > orange)) {

        $("thresholdMessage").textContent =
            "Enter valid thresholds: Yellow < Orange < Red.";

        return;
    }

    state.thresholds = {
        yellow,
        orange,
        red
    };

    localStorage.setItem(
        "microThresholds",
        JSON.stringify(state.thresholds)
    );

    $("thresholdMessage").textContent =
        "Rainfall thresholds saved successfully.";

    updateUI();

    toast("Rainfall thresholds updated.");
});


// ==================================================
// EXPORT ACTUAL SENSOR RECORDS
// ==================================================

$("exportCsv").addEventListener("click", () => {

    if (!state.history.length) {

        toast("No actual sensor records available.");

        return;
    }

    const rows = [

        [
            "timestamp",
            "temperature_C",
            "humidity_percent",
            "heat_index_C",
            "rainfall_intensity_mm_hr",
            "solar_radiation_W_m2",
            "source"
        ],

        ...state.history.map(row => [

            new Date(row.time).toISOString(),

            row.temperature ?? "",

            row.humidity ?? "",

            row.heatIndex ?? "",

            row.rainfallIntensity ?? "",

            row.solarRadiation ?? "",

            "LIVE"

        ])
    ];

    const csv = rows
        .map(row => row.join(","))
        .join("\n");

    const objectURL = URL.createObjectURL(
        new Blob(
            [csv],
            { type: "text/csv" }
        )
    );

    const link = document.createElement("a");

    link.href = objectURL;

    link.download = "microclimate-sensor-records.csv";

    link.click();

    URL.revokeObjectURL(objectURL);

    toast("CSV export created.");
});


// ==================================================
// CLEAR SENSOR RECORDS
// ==================================================

$("clearRecords").addEventListener("click", () => {

    if (!confirm("Clear all locally saved sensor records?")) {
        return;
    }

    state.history = [];

    localStorage.removeItem("microclimateHistory");

    renderRecords();

    drawAllCharts();

    updateUI();

    toast("Sensor records cleared.");
});


// ==================================================
// INITIALIZE WEBSITE
// ==================================================

function init() {

    // Discard old demo/sample history from previous versions.

    try {

        const savedHistory = JSON.parse(
            localStorage.getItem("microclimateHistory") || "[]"
        );

        state.history = savedHistory

            .filter(row => row.source === "LIVE")

            .map(row => ({
                ...row,
                time: new Date(row.time)
            }));

    } catch (error) {

        state.history = [];
    }

    localStorage.setItem(
        "microclimateHistory",
        JSON.stringify(state.history)
    );


    // Restore API connection settings.

    state.endpoint =
        localStorage.getItem("microEndpoint") || "";

    state.live =
        localStorage.getItem("microLive") === "true";

    $("endpoint").value = state.endpoint;

    $("liveToggle").checked = state.live;


    // Restore rainfall thresholds.

    try {

        const savedThresholds = JSON.parse(
            localStorage.getItem("microThresholds") || "null"
        );

        if (savedThresholds) {

            state.thresholds = savedThresholds;

            $("yellowThreshold").value =
                savedThresholds.yellow;

            $("orangeThreshold").value =
                savedThresholds.orange;

            $("redThreshold").value =
                savedThresholds.red;
        }

    } catch (error) {

        console.warn("Using default rainfall thresholds.");
    }


    // Remove outdated sample/demo labels.

    const recordsNote =
        document.querySelector("#page-records .info-callout");

    if (recordsNote) {

        recordsNote.textContent =
            "Only actual readings received from the ESP32/backend API are stored. No simulated sensor records are generated.";
    }


    // IMPORTANT:
    // All sensor readings start as null.
    // No random or sample values are generated.

    updateUI();

    // Forecast is independent from prototype sensor readings.

    loadForecast();


    // Connect only if the user previously enabled live mode.

    if (state.live && state.endpoint) {

        pollEndpoint();

        state.pollTimer = setInterval(
            pollEndpoint,
            10000
        );
    }
}


// START WEBSITE

init();