const DEFAULT_COORDS = { lat: 44.9521, lon: 34.1024, name: "Симферополь" };
let currentCoords = null;
let globalForecastData = [];
let currentCityName = "Симферополь";
let lastEffectType = null;
let activeForecastIndex = 0;
let activeDayIndex = -1;
let bgCleanupTimer = null;

let currentEngine = localStorage.getItem('weather_engine') || 'openmeteo';
const WEATHER_API_KEY_CHUNKS = ['2692209', '634d34d4', '59b5722', '56262805'];
function getBundledWeatherApiKey() {
    return WEATHER_API_KEY_CHUNKS.join('');
}
let weatherApiKey = localStorage.getItem('weather_api_key') || getBundledWeatherApiKey();

const UI = {};
const uiKeys = [
    'gps-icon', 'location-status', 'search-input', 'weather-app', 'forecast-container',
    'city-name', 'current-date', 'temp-display', 'weather-desc', 'current-precip-value', 'humidity', 'wind-speed',
    'pressure', 'sunrise', 'sunset', 'weather-status-badge', 'weather-icon-container',
    'hourly-container', 'hourly-list', 'forecast-days', 'engine-select',
    'key-input-container', 'weatherapi-key', 'effects-container', 'bg-stack'
];
function cacheUiElements() {
    uiKeys.forEach(id => { UI[id] = document.getElementById(id); });
}
function setText(id, value) {
    const el = UI[id];
    if (el) el.innerText = value;
}

const weatherThemes = {
    Clear: { gradient: "linear-gradient(135deg, #f59e0b 0%, #f97316 45%, #0284c7 100%)", icon: '<i class="fa-solid fa-sun text-amber-200"></i>', badge: "bg-amber-500/30 text-amber-100", effect: "sun", name: "Ясно" },
    Clouds: { gradient: "linear-gradient(135deg, #0ea5e9 0%, #64748b 50%, #334155 100%)", icon: '<i class="fa-solid fa-cloud text-slate-100"></i>', badge: "bg-slate-500/30 text-slate-100", effect: "none", name: "Облачно" },
    Rain: { gradient: "linear-gradient(135deg, #334155 0%, #1e40af 45%, #1e1b4b 100%)", icon: '<i class="fa-solid fa-cloud-showers-heavy text-blue-300"></i>', badge: "bg-blue-500/30 text-blue-100", effect: "rain", name: "Дождь" },
    Snow: { gradient: "linear-gradient(135deg, #1e3a8a 0%, #312e81 50%, #1e293b 100%)", icon: '<i class="fa-solid fa-snowflake text-sky-200"></i>', badge: "bg-sky-500/30 text-sky-100", effect: "snow", name: "Снег" }
};
const hourIconsByType = {
    Clear: '<i class="fa-solid fa-sun text-amber-300"></i>',
    Rain: '<i class="fa-solid fa-cloud-rain text-blue-300"></i>',
    Snow: '<i class="fa-solid fa-snowflake text-sky-300"></i>',
    Clouds: '<i class="fa-solid fa-cloud text-slate-200"></i>'
};
function getHourIcon(iconType) {
    return hourIconsByType[iconType] || hourIconsByType.Clouds;
}

function setAnimatedBackground(gradient, immediate = false) {
    const bgStack = UI['bg-stack'];
    if (!bgStack || !gradient) return;
    if (bgStack.dataset.currentGradient === gradient) return;
    bgStack.dataset.currentGradient = gradient;

    const layer = document.createElement('div');
    layer.className = 'absolute inset-0 opacity-0';
    layer.style.background = gradient;
    if (!immediate) {
        layer.style.transition = 'opacity 700ms ease';
    }
    bgStack.appendChild(layer);

    if (immediate) {
        layer.classList.remove('opacity-0');
        layer.classList.add('opacity-100');
        const allLayers = bgStack.querySelectorAll('div');
        allLayers.forEach((oldLayer, idx) => {
            if (idx < allLayers.length - 1) oldLayer.remove();
        });
    } else {
        requestAnimationFrame(() => {
            layer.classList.remove('opacity-0');
            layer.classList.add('opacity-100');
        });
        if (bgCleanupTimer) clearTimeout(bgCleanupTimer);
        bgCleanupTimer = setTimeout(() => {
            const layers = bgStack.querySelectorAll('div');
            layers.forEach((oldLayer, idx) => {
                if (idx < layers.length - 1) oldLayer.remove();
            });
        }, 750);
    }
}

function parseWmo(code) {
    if ([0, 1].includes(code)) return { type: 'Clear', desc: 'Ясно' };
    if ([2, 3].includes(code)) return { type: 'Clouds', desc: 'Облачно' };
    if ([45, 48].includes(code)) return { type: 'Clouds', desc: 'Туман' };
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return { type: 'Rain', desc: 'Осадки' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { type: 'Snow', desc: 'Снегопад' };
    return { type: 'Clouds', desc: 'Облачно' };
}

function parseWeatherApiCode(code) {
    if (code === 1000) return { type: 'Clear', desc: 'Ясно' };
    if ([1003, 1006, 1009, 1030, 1135, 1147].includes(code)) return { type: 'Clouds', desc: 'Облачно / Туман' };
    if ([1063, 1150, 1153, 1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246].includes(code)) return { type: 'Rain', desc: 'Дождь' };
    if ([1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258].includes(code)) return { type: 'Snow', desc: 'Снег' };
    return { type: 'Clouds', desc: 'Облачно' };
}

function initEngineUI() {
    const select = UI['engine-select'];
    const keyContainer = UI['key-input-container'];
    const keyInput = UI['weatherapi-key'];

    select.value = currentEngine;
    keyInput.value = weatherApiKey;

    if (currentEngine === 'weatherapi') keyContainer.classList.remove('hidden');
    else keyContainer.classList.add('hidden');
}

function changeEngine(val) {
    currentEngine = val;
    localStorage.setItem('weather_engine', val);
    initEngineUI();
    if (currentCoords) fetchWeatherData(currentCoords.lat, currentCoords.lon);
}

function saveApiKey(val) {
    const trimmed = (val || '').trim();
    weatherApiKey = trimmed;
    if (trimmed) {
        localStorage.setItem('weather_api_key', trimmed);
    } else {
        localStorage.removeItem('weather_api_key');
    }
    if (currentCoords && currentEngine === 'weatherapi' && trimmed.length > 5) {
        fetchWeatherData(currentCoords.lat, currentCoords.lon);
    }
}

function initWeatherAutomatically() {
    initEngineUI();
    const gpsIcon = UI['gps-icon'];
    if (gpsIcon) gpsIcon.classList.add('animate-spin');
    setText('location-status', "Поиск координат...");

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async position => {
                currentCoords = { lat: position.coords.latitude, lon: position.coords.longitude };
                setText('location-status', "Координаты получены");
                if (gpsIcon) gpsIcon.classList.remove('animate-spin');
                await fetchCityNameByCoords(currentCoords.lat, currentCoords.lon);
                fetchWeatherData(currentCoords.lat, currentCoords.lon);
            },
            () => useDefaultLocation("Симферополь (По умолчанию)"),
            { timeout: 4000 }
        );
    } else {
        useDefaultLocation("GPS не поддерживается");
    }
}

function useDefaultLocation(msg) {
    const gpsIcon = UI['gps-icon'];
    if (gpsIcon) gpsIcon.classList.remove('animate-spin');
    currentCoords = { lat: DEFAULT_COORDS.lat, lon: DEFAULT_COORDS.lon };
    currentCityName = DEFAULT_COORDS.name;
    setText('location-status', msg);
    fetchWeatherData(currentCoords.lat, currentCoords.lon);
}

async function fetchCityNameByCoords(lat, lon) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru`);
        if (res.ok) {
            const data = await res.json();
            currentCityName = data.address.city || data.address.town || data.address.village || "Определенное место";
            return;
        }
    } catch (e) {
        console.error(e);
    }
    currentCityName = "Текущее местоположение";
}

async function handleSearch(e) {
    e.preventDefault();
    const query = UI['search-input'].value.trim();
    if (!query) return;

    setText('location-status', "Поиск...");
    try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ru&format=json`);
        if (!res.ok) throw new Error("Geocoding request failed");
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            currentCoords = { lat: result.latitude, lon: result.longitude };
            currentCityName = result.name;
            setText('location-status', "Город найден");
            fetchWeatherData(currentCoords.lat, currentCoords.lon);
        } else {
            setText('location-status', "Город не найден");
        }
    } catch {
        setText('location-status', "Ошибка поиска");
    }
}

async function fetchWeatherData(lat, lon) {
    setText('location-status', "Обновление данных...");
    try {
        if (currentEngine === 'weatherapi') {
            if (!weatherApiKey) {
                setText('location-status', "Введите API ключ!");
                UI['weatherapi-key']?.focus();
                return;
            }
            await fetchWeatherApiData(lat, lon);
        } else {
            await fetchOpenMeteoData(lat, lon);
        }

        if (!Array.isArray(globalForecastData) || globalForecastData.length === 0) {
            throw new Error("No forecast data received");
        }

        updateWeatherUI(0, true);
        renderForecastList();
        showAppCards();
        setText('location-status', "Данные обновлены");
    } catch (err) {
        console.error(err);
        setText('location-status', "Ошибка провайдера погоды");
    }
}

async function fetchOpenMeteoData(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,pressure_msl,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code,relative_humidity_2m,wind_speed_10m,pressure_msl&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=10`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Open-Meteo request failed");
    const data = await response.json();
    if (!data?.daily?.time || !data?.hourly?.time || !data?.current) throw new Error("Open-Meteo returned incomplete data");

    globalForecastData = data.daily.time.map((dateStr, idx) => {
        const wmoInfo = parseWmo(data.daily.weather_code[idx]);
        const dateObj = new Date(dateStr);

        const hourlyList = data.hourly.time.reduce((acc, hourIso, hIdx) => {
            if (!hourIso.startsWith(dateStr)) return acc;
            const hourWmoInfo = parseWmo(data.hourly.weather_code[hIdx]);
            acc.push({
                time: hourIso.slice(11, 16),
                hourNumber: Number(hourIso.slice(11, 13)),
                temp: Math.round(data.hourly.temperature_2m[hIdx]),
                pop: data.hourly.precipitation_probability[hIdx] || 0,
                humidity: data.hourly.relative_humidity_2m[hIdx],
                wind: Number((data.hourly.wind_speed_10m[hIdx] || 0).toFixed(1)),
                pressure: Math.round((data.hourly.pressure_msl[hIdx] || 0) * 0.750062),
                iconCode: hourWmoInfo.type,
                desc: hourWmoInfo.desc
            });
            return acc;
        }, []);

        return {
            isToday: idx === 0,
            city: currentCityName,
            dateStr: dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
            dayName: dateObj.toLocaleDateString('ru-RU', { weekday: 'long' }),
            temp: idx === 0 ? Math.round(data.current.temperature_2m) : Math.round((data.daily.temperature_2m_max[idx] + data.daily.temperature_2m_min[idx]) / 2),
            maxTemp: Math.round(data.daily.temperature_2m_max[idx]),
            minTemp: Math.round(data.daily.temperature_2m_min[idx]),
            desc: wmoInfo.desc,
            humidity: idx === 0 ? data.current.relative_humidity_2m : 65,
            wind: idx === 0 ? Number(data.current.wind_speed_10m.toFixed(1)) : 4.0,
            pressure: idx === 0 ? Math.round(data.current.pressure_msl * 0.750062) : 755,
            sunrise: data.daily.sunrise[idx] ? data.daily.sunrise[idx].slice(11, 16) : '--:--',
            sunset: data.daily.sunset[idx] ? data.daily.sunset[idx].slice(11, 16) : '--:--',
            type: wmoInfo.type,
            hourly: hourlyList,
            hourlyByHourNumber: Object.fromEntries(hourlyList.map(h => [h.hourNumber, h]))
        };
    });
}

async function fetchWeatherApiData(lat, lon) {
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${weatherApiKey}&q=${lat},${lon}&days=10&lang=ru`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("WeatherAPI Key error or limit");
    const data = await response.json();
    if (!data?.forecast?.forecastday?.length) throw new Error("WeatherAPI returned incomplete data");

    globalForecastData = data.forecast.forecastday.map((fDay, idx) => {
        const weatherInfo = parseWeatherApiCode(fDay.day.condition.code);
        const dateObj = new Date(fDay.date);
        const hourlyList = fDay.hour.map((h, hIdx) => ({
            time: h.time.slice(11, 16),
            hourNumber: hIdx,
            temp: Math.round(h.temp_c),
            pop: Number(h.chance_of_rain || h.chance_of_snow || 0),
            humidity: h.humidity,
            wind: Number((h.wind_kph / 3.6).toFixed(1)),
            pressure: Math.round(h.pressure_mb * 0.750062),
            iconCode: parseWeatherApiCode(h.condition.code).type,
            desc: h.condition.text
        }));

        return {
            isToday: idx === 0,
            city: data.location.name,
            dateStr: dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
            dayName: dateObj.toLocaleDateString('ru-RU', { weekday: 'long' }),
            temp: idx === 0 ? Math.round(data.current.temp_c) : Math.round(fDay.day.avgtemp_c),
            maxTemp: Math.round(fDay.day.maxtemp_c),
            minTemp: Math.round(fDay.day.mintemp_c),
            desc: idx === 0 ? data.current.condition.text : fDay.day.condition.text,
            humidity: idx === 0 ? data.current.humidity : fDay.day.avghumidity,
            wind: idx === 0 ? Number((data.current.wind_kph / 3.6).toFixed(1)) : Number((fDay.day.maxwind_kph / 3.6).toFixed(1)),
            pressure: idx === 0 ? Math.round(data.current.pressure_mb * 0.750062) : 755,
            sunrise: fDay.astro.sunrise ? convertAstroTime(fDay.astro.sunrise) : '--:--',
            sunset: fDay.astro.sunset ? convertAstroTime(fDay.astro.sunset) : '--:--',
            type: weatherInfo.type,
            hourly: hourlyList,
            hourlyByHourNumber: Object.fromEntries(hourlyList.map(h => [h.hourNumber, h]))
        };
    });
}

function convertAstroTime(timeStr) {
    try {
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        const normalizedModifier = (modifier || '').toUpperCase();
        if (hours === '12') hours = '00';
        if (normalizedModifier === 'PM') hours = parseInt(hours, 10) + 12;
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    } catch {
        return timeStr;
    }
}

function updateWeatherUI(index, triggerScroll = false, selectedHourNumber = null) {
    const w = globalForecastData[index];
    if (!w) return;

    const currentHourSystem = new Date().getHours();
    const selectedHourData = selectedHourNumber !== null ? w.hourlyByHourNumber?.[selectedHourNumber] : null;

    const effectiveType = selectedHourData?.iconCode || w.type;
    const theme = weatherThemes[effectiveType] || weatherThemes.Clouds;
    setAnimatedBackground(theme.gradient);

    setText('city-name', w.city);
    setText('current-date', `${w.dayName}, ${w.dateStr}`);
    setText('temp-display', selectedHourData ? selectedHourData.temp : w.temp);
    setText('weather-desc', selectedHourData?.desc || w.desc);
    const currentHourData = w.hourlyByHourNumber?.[currentHourSystem] || null;
    const precipNow = selectedHourData
        ? `${selectedHourData.pop}%`
        : (w.isToday && currentHourData ? `${currentHourData.pop}%` : '--%');
    setText('current-precip-value', precipNow);
    setText('humidity', `${selectedHourData?.humidity ?? w.humidity} %`);
    setText('wind-speed', `${selectedHourData?.wind ?? w.wind} м/с`);
    setText('pressure', `${selectedHourData?.pressure ?? w.pressure} мм рт. ст.`);
    setText('sunrise', w.sunrise);
    setText('sunset', w.sunset);

    const badge = UI['weather-status-badge'];
    badge.innerText = theme.name;
    badge.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${theme.badge}`;
    UI['weather-icon-container'].innerHTML = theme.icon;

    const hourlyContainer = UI['hourly-container'];
    const hourlyListContainer = UI['hourly-list'];
    const shouldRebuildHourlyCards = index !== activeDayIndex || hourlyListContainer.children.length === 0;

    if (w.hourly && w.hourly.length > 0) {
        hourlyContainer.classList.remove('hidden');
        if (shouldRebuildHourlyCards) {
            hourlyListContainer.innerHTML = '';
            const frag = document.createDocumentFragment();

            w.hourly.forEach(h => {
                const isPassed = w.isToday && h.hourNumber < currentHourSystem;
                const isCurrent = w.isToday && h.hourNumber === currentHourSystem;
                const isSelected = selectedHourData && h.hourNumber === selectedHourData.hourNumber;

                const item = document.createElement('button');
                item.type = 'button';
                item.id = `hour-card-${h.hourNumber}`;
                item.dataset.hourNumber = String(h.hourNumber);
                item.onclick = () => updateWeatherUI(index, false, h.hourNumber);
                item.className = `flex flex-col items-center border rounded-xl px-4 py-2.5 min-w-[76px] text-center text-xs transition-all duration-300 cursor-pointer
                    ${isSelected || (isCurrent && !selectedHourData) ? 'bg-sky-500/30 border-sky-400 shadow-md' : 'bg-white/5 border-white/5'}
                    ${isPassed ? 'opacity-40 filter grayscale-[30%]' : ''}`;
                item.innerHTML = `
                    <span class="opacity-60 block font-medium ${isCurrent ? 'text-sky-300 font-bold' : ''}">${h.time}</span>
                    <span class="text-xl my-1.5 block">${getHourIcon(h.iconCode)}</span>
                    <span class="font-bold text-sm block">${h.temp}°</span>
                    <span class="text-[10px] text-cyan-300 block font-semibold mt-0.5"><i class="fa-solid fa-droplet text-[8px]"></i> ${h.pop}%</span>
                `;
                frag.appendChild(item);
            });
            hourlyListContainer.appendChild(frag);
        } else {
            const cards = hourlyListContainer.querySelectorAll('button[data-hour-number]');
            cards.forEach((card) => {
                const cardHour = Number(card.dataset.hourNumber);
                const isCurrent = w.isToday && cardHour === currentHourSystem;
                const isSelected = selectedHourData && cardHour === selectedHourData.hourNumber;
                card.classList.remove('bg-sky-500/30', 'border-sky-400', 'shadow-md');
                card.classList.add('bg-white/5', 'border-white/5');
                if (isSelected || (isCurrent && !selectedHourData)) {
                    card.classList.remove('bg-white/5', 'border-white/5');
                    card.classList.add('bg-sky-500/30', 'border-sky-400', 'shadow-md');
                }
            });
        }

        if (w.isToday && triggerScroll && shouldRebuildHourlyCards) {
            setTimeout(() => {
                const targetHourCard = document.getElementById(`hour-card-${currentHourSystem}`);
                if (targetHourCard) {
                    hourlyListContainer.scrollTo({
                        left: targetHourCard.offsetLeft - hourlyListContainer.offsetLeft - 10,
                        behavior: 'smooth'
                    });
                }
            }, 200);
        } else if (!w.isToday) {
            hourlyListContainer.scrollLeft = 0;
        }
    } else {
        hourlyContainer.classList.add('hidden');
    }

    generateParticles(theme.effect);
    const forecastButtons = UI['forecast-days']?.children;
    if (forecastButtons && forecastButtons.length > 0) {
        if (forecastButtons[activeForecastIndex]) forecastButtons[activeForecastIndex].classList.remove('active');
        if (forecastButtons[index]) forecastButtons[index].classList.add('active');
        activeForecastIndex = index;
    }
    activeDayIndex = index;
}

function renderForecastList() {
    const container = UI['forecast-days'];
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    globalForecastData.forEach((day, index) => {
        const theme = weatherThemes[day.type] || weatherThemes.Clouds;
        const row = document.createElement('button');
        row.onclick = () => updateWeatherUI(index, false, null);
        row.className = "forecast-item w-full bg-white/5 border border-white/5 p-4 rounded-2xl flex items-center justify-between gap-4 transition text-left cursor-pointer";
        row.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="text-2xl w-10 text-center filter drop-shadow-sm">${theme.icon}</div>
                <div>
                    <span class="block text-sm font-bold capitalize">${day.dayName}</span>
                    <span class="block text-xs opacity-65">${day.dateStr} — ${day.desc}</span>
                </div>
            </div>
            <div class="text-right whitespace-nowrap">
                <span class="text-base font-black text-amber-300">${day.maxTemp}°</span>
                <span class="text-xs opacity-40 mx-1">/</span>
                <span class="text-sm font-semibold opacity-60 text-blue-200">${day.minTemp}°</span>
            </div>
        `;
        frag.appendChild(row);
    });
    container.appendChild(frag);

    activeForecastIndex = 0;
    activeDayIndex = -1;
    if (container.firstChild) container.firstChild.classList.add('active');
}

function generateParticles(effectType) {
    const container = UI['effects-container'];
    if (lastEffectType === effectType) return;
    lastEffectType = effectType;
    container.innerHTML = '';
    if (effectType === 'none') return;

    if (effectType === 'sun') {
        const rays = document.createElement('div');
        rays.className = 'sun-rays';
        container.appendChild(rays);
    }
    if (effectType === 'rain') {
        const flash = document.createElement('div');
        flash.className = 'lightning-flash';
        container.appendChild(flash);
    }
    if (effectType === 'rain' || effectType === 'snow') {
        const particleCount = effectType === 'rain' ? 60 : 30;
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = effectType === 'rain' ? 'raindrop' : 'snowflake';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * -15}%`;
            particle.style.animationDuration = effectType === 'rain' ? `${0.4 + Math.random() * 0.4}s` : `${3 + Math.random() * 4}s`;
            particle.style.animationDelay = `-${Math.random() * 5}s`;
            container.appendChild(particle);
        }
    }
}

function showAppCards() {
    const appCard = UI['weather-app'];
    const forecastCard = UI['forecast-container'];
    if (appCard) appCard.classList.remove('hidden');
    if (forecastCard) forecastCard.classList.remove('hidden');
    setTimeout(() => {
        if (appCard) appCard.classList.add('opacity-100');
        if (forecastCard) forecastCard.classList.add('opacity-100');
    }, 50);
}

function debounce(fn, delayMs) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delayMs);
    };
}

function bindEventHandlers() {
    const gpsButton = document.getElementById('gps-button');
    const searchForm = document.getElementById('search-form');
    const engineSelect = UI['engine-select'];
    const apiKeyInput = UI['weatherapi-key'];
    const debouncedSearchSubmit = debounce(() => handleSearch({ preventDefault() {} }), 250);

    if (gpsButton) gpsButton.addEventListener('click', initWeatherAutomatically);
    if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            debouncedSearchSubmit();
        });
    }
    if (engineSelect) {
        engineSelect.addEventListener('change', (event) => changeEngine(event.target.value));
    }
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', (event) => saveApiKey(event.target.value));
    }
}

window.onload = () => {
    cacheUiElements();
    bindEventHandlers();
    setAnimatedBackground(weatherThemes.Clouds.gradient, true);
    initWeatherAutomatically();
};
