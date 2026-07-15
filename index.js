import { extension_settings, getContext } from '../../../extensions.js';
import { background_settings } from '../../../backgrounds.js';

const MODULE_NAME = 'location-background';
const MODULE_LABEL = 'Location Background Manager';
const LOCATIONS_URL = new URL('./locations.json', import.meta.url);
const SETTINGS_URL = new URL('./settings.html', import.meta.url);
const LOCATION_CHANGED_EVENT = 'location-background:changed';
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    matchEntryTitle: true,
    matchKeysFallback: true,
    showToasts: false,
});

let initialized = false;
let eventsRegistered = false;
let settingsRendered = false;
let locationsLoaded = false;
let loadPromise = null;
let locationsByName = new Map();
let locationsByLowerName = new Map();
let lastAppliedSignature = '';
let lastLocationDetail = null;
let lastStatusMessage = 'Starting...';

function getSillyTavernContext() {
    return getContext?.() ?? globalThis.SillyTavern?.getContext?.();
}

function getSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object' || Array.isArray(extension_settings[MODULE_NAME])) {
        extension_settings[MODULE_NAME] = {};
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in extension_settings[MODULE_NAME])) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }

    return extension_settings[MODULE_NAME];
}

function saveSettings() {
    getSillyTavernContext()?.saveSettingsDebounced?.();
}

function log(...args) {
    console.info(`[${MODULE_LABEL}]`, ...args);
}

function warn(message, ...args) {
    console.warn(`[${MODULE_LABEL}] ${message}`, ...args);
}

function showWarning(message) {
    if (globalThis.toastr?.warning) {
        globalThis.toastr.warning(message, MODULE_LABEL);
    } else {
        warn(message);
    }
}

function setStatus(message, isError = false) {
    lastStatusMessage = message;
    const statusElement = $('#location_background_status');
    statusElement.text(message);
    statusElement.toggleClass('redWarning', isError);
}

function updateLocationSelect() {
    const select = $('#location_background_test_location');
    if (!select.length) {
        return;
    }

    const selectedValue = String(select.val() || '');
    select.empty();

    if (!locationsByName.size) {
        select.append($('<option>').val('').text('No locations loaded'));
        select.prop('disabled', true);
        return;
    }

    select.prop('disabled', false);

    for (const [locationName, record] of locationsByName) {
        const background = record.config.background || 'no background';
        select.append($('<option>').val(locationName).text(`${locationName} -> ${background}`));
    }

    if (selectedValue && locationsByName.has(selectedValue)) {
        select.val(selectedValue);
    }
}

function updateLocationsTable() {
    const body = $('#location_background_locations_body');
    if (!body.length) {
        return;
    }

    body.empty();

    for (const [locationName, record] of locationsByName) {
        const row = $('<tr>');
        row.append($('<td>').text(locationName));
        row.append($('<td>').text(record.config.background || '-'));
        row.append($('<td>').text(record.config.music || '-'));
        row.append($('<td>').text(record.config.weather || '-'));
        body.append(row);
    }
}

function refreshSettingsUI() {
    const settings = getSettings();

    $('#location_background_enabled').prop('checked', !!settings.enabled);
    $('#location_background_match_title').prop('checked', !!settings.matchEntryTitle);
    $('#location_background_match_keys').prop('checked', !!settings.matchKeysFallback);
    $('#location_background_show_toasts').prop('checked', !!settings.showToasts);
    $('#location_background_count').text(String(locationsByName.size));
    $('#location_background_last').text(lastLocationDetail
        ? `${lastLocationDetail.location} -> ${lastLocationDetail.background || 'no background'}`
        : 'None yet');
    $('#location_background_status').text(lastStatusMessage);

    updateLocationSelect();
    updateLocationsTable();
}

async function renderSettingsPanel() {
    if (settingsRendered || document.getElementById('location_background_settings')) {
        settingsRendered = true;
        refreshSettingsUI();
        return;
    }

    const container = $('#extensions_settings');
    if (!container.length) {
        warn('Could not find #extensions_settings. Settings UI will be retried later.');
        return;
    }

    const response = await fetch(SETTINGS_URL, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Could not load ${SETTINGS_URL.pathname}: ${response.status} ${response.statusText}`);
    }

    container.append(await response.text());
    settingsRendered = true;
    bindSettingsEvents();
    refreshSettingsUI();
}

function getLocationByName(locationName) {
    const normalizedName = normalizeName(locationName);
    return locationsByName.get(normalizedName)
        ?? locationsByLowerName.get(normalizedName.toLocaleLowerCase())
        ?? null;
}

async function reloadLocationsFromUi() {
    setStatus('Reloading locations.json...');

    try {
        await loadLocations(true);
        setStatus(`Loaded ${locationsByName.size} location mapping(s).`);
        globalThis.toastr?.success?.('locations.json reloaded.', MODULE_LABEL);
    } catch (error) {
        setStatus(`Failed to load locations.json: ${error.message}`, true);
    }
}

async function applySelectedLocationFromUi() {
    const locationName = String($('#location_background_test_location').val() || '');
    const record = getLocationByName(locationName);

    if (!record) {
        showWarning('Select a valid location first.');
        return;
    }

    await applyLocation({ ...record, entry: null, matchedName: locationName }, { force: true });
}

function bindSettingsEvents() {
    $('#location_background_enabled').on('change', function () {
        getSettings().enabled = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_match_title').on('change', function () {
        getSettings().matchEntryTitle = !!$(this).prop('checked');
        saveSettings();
    });

    $('#location_background_match_keys').on('change', function () {
        getSettings().matchKeysFallback = !!$(this).prop('checked');
        saveSettings();
    });

    $('#location_background_show_toasts').on('change', function () {
        getSettings().showToasts = !!$(this).prop('checked');
        saveSettings();
    });

    $('#location_background_reload').on('click', reloadLocationsFromUi);
    $('#location_background_apply').on('click', applySelectedLocationFromUi);
}

function normalizeName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value === undefined || value === null || value === '') {
        return [];
    }
    return [value];
}

function readEntryNames(entry) {
    const settings = getSettings();
    const names = [];

    if (settings.matchEntryTitle) {
        names.push(entry?.comment, entry?.title, entry?.name, entry?.memo);
    }

    if (settings.matchKeysFallback) {
        names.push(...toArray(entry?.key), ...toArray(entry?.keys));
    }

    return [...new Set(names.map(normalizeName).filter(Boolean))];
}

function parseLocationConfig(locationName, rawConfig) {
    if (typeof rawConfig === 'string') {
        return { background: normalizeName(rawConfig) };
    }

    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
        warn(`Ignored "${locationName}" because its value is not a string or object.`);
        return null;
    }

    const config = { ...rawConfig };
    if (config.background !== undefined) {
        config.background = normalizeName(config.background);
    }

    if (!config.background) {
        warn(`"${locationName}" has no background field. It can still emit a custom event, but will not change the background.`);
    }

    return config;
}

async function loadLocations(force = false) {
    if (loadPromise && !force) {
        return loadPromise;
    }

    loadPromise = (async () => {
        const url = new URL(LOCATIONS_URL.href);
        url.searchParams.set('_', Date.now().toString());

        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Could not load ${LOCATIONS_URL.pathname}: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('locations.json must be a JSON object.');
        }

        const nextByName = new Map();
        const nextByLowerName = new Map();

        for (const [rawLocationName, rawConfig] of Object.entries(data)) {
            const locationName = normalizeName(rawLocationName);
            const config = parseLocationConfig(locationName, rawConfig);
            if (!locationName || !config) {
                continue;
            }

            const record = { location: locationName, config };
            nextByName.set(locationName, record);
            nextByLowerName.set(locationName.toLocaleLowerCase(), record);
        }

        locationsByName = nextByName;
        locationsByLowerName = nextByLowerName;
        locationsLoaded = true;

        setStatus(`Loaded ${locationsByName.size} location mapping(s).`);
        refreshSettingsUI();
        log(`Loaded ${locationsByName.size} location mapping(s).`);
        return locationsByName;
    })().catch((error) => {
        locationsLoaded = false;
        setStatus(`Failed to load locations.json: ${error.message}`, true);
        refreshSettingsUI();
        showWarning(`Failed to load locations.json: ${error.message}`);
        throw error;
    }).finally(() => {
        loadPromise = null;
    });

    return loadPromise;
}

function findLocationForEntry(entry) {
    for (const entryName of readEntryNames(entry)) {
        const exactMatch = locationsByName.get(entryName);
        if (exactMatch) {
            return { ...exactMatch, entry, matchedName: entryName };
        }

        const lowerMatch = locationsByLowerName.get(entryName.toLocaleLowerCase());
        if (lowerMatch) {
            return { ...lowerMatch, entry, matchedName: entryName };
        }
    }

    return null;
}

function quoteSlashArgument(value) {
    return JSON.stringify(String(value));
}

async function runBackgroundSlashCommand(background) {
    const context = getSillyTavernContext();
    const command = `/bg ${quoteSlashArgument(background)}`;

    if (context?.executeSlashCommandsWithOptions) {
        const result = await context.executeSlashCommandsWithOptions(command, {
            handleParserErrors: false,
            handleExecutionErrors: true,
            source: MODULE_NAME,
        });

        if (result?.isError) {
            throw new Error(result.errorMessage || `Slash command failed: ${command}`);
        }
        return true;
    }

    const bgCommand = context?.SlashCommandParser?.commands?.bg;
    if (bgCommand?.callback) {
        await bgCommand.callback({}, background);
        return true;
    }

    return false;
}

function findBackgroundElement(background) {
    const normalizedBackground = normalizeName(background);
    const elements = Array.from(document.querySelectorAll('.bg_example'));

    return elements.find((element) => normalizeName(element.getAttribute('bgfile')) === normalizedBackground)
        ?? elements.find((element) => normalizeName(element.getAttribute('bgfile')).toLocaleLowerCase() === normalizedBackground.toLocaleLowerCase());
}

function clickBackgroundElement(background) {
    const element = findBackgroundElement(background);
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    element.click();
    return true;
}

async function backgroundFileExists(background) {
    try {
        const response = await fetch(`backgrounds/${encodeURIComponent(background)}`, {
            method: 'HEAD',
            cache: 'no-store',
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function setBackgroundDirectly(background) {
    if (!await backgroundFileExists(background)) {
        showWarning(`No background found with name "${background}".`);
        return false;
    }

    const url = `url("backgrounds/${encodeURIComponent(background)}")`;
    const backgroundElement = document.getElementById('bg1');

    if (backgroundElement) {
        backgroundElement.style.backgroundImage = url;
    }

    background_settings.name = background;
    background_settings.url = url;
    getSillyTavernContext()?.saveSettingsDebounced?.();

    return true;
}

async function applyBackground(background) {
    if (!background) {
        return false;
    }

    try {
        if (await runBackgroundSlashCommand(background)) {
            return true;
        }
    } catch (error) {
        warn(`Slash command /bg failed for "${background}". Trying fallback.`, error);
    }

    if (clickBackgroundElement(background)) {
        return true;
    }

    return setBackgroundDirectly(background);
}

function emitLocationChanged(match) {
    const detail = {
        location: match.location,
        matchedName: match.matchedName,
        entry: match.entry,
        config: { ...match.config },
        background: match.config.background || null,
        music: match.config.music || null,
        weather: match.config.weather || null,
    };

    window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT, { detail }));
    return detail;
}

async function applyLocation(match, { force = false } = {}) {
    const signature = JSON.stringify({
        location: match.location,
        background: match.config.background || '',
        music: match.config.music || '',
        weather: match.config.weather || '',
    });

    if (!force && signature === lastAppliedSignature) {
        return;
    }

    if (match.config.background) {
        const applied = await applyBackground(match.config.background);
        if (!applied) {
            setStatus(`Could not apply background "${match.config.background}".`, true);
            return;
        }
    }

    lastAppliedSignature = signature;
    lastLocationDetail = emitLocationChanged(match);
    setStatus(`Active location: ${match.location}`);
    refreshSettingsUI();

    if (getSettings().showToasts) {
        globalThis.toastr?.info?.(`${match.location} -> ${match.config.background || 'no background'}`, MODULE_LABEL);
    }

    log(`Activated "${match.location}"`, match.config);
}

async function onWorldInfoActivated(entries) {
    if (!getSettings().enabled) {
        return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    try {
        if (!locationsLoaded) {
            await loadLocations();
        }
    } catch {
        return;
    }

    let selectedMatch = null;

    for (const entry of entries) {
        const match = findLocationForEntry(entry);
        if (match) {
            selectedMatch = match;
        }
    }

    if (selectedMatch) {
        await applyLocation(selectedMatch);
    }
}

function registerDebugApi() {
    globalThis.locationBackgroundManager = {
        reload: () => loadLocations(true),
        getLocations: () => Object.fromEntries([...locationsByName].map(([name, record]) => [name, record.config])),
        getSettings,
        apply: async (locationName) => {
            const record = getLocationByName(locationName);
            if (!record) {
                throw new Error(`Unknown location: ${locationName}`);
            }
            await applyLocation({ ...record, entry: null, matchedName: normalizeName(locationName) }, { force: true });
        },
        eventName: LOCATION_CHANGED_EVENT,
    };
}

async function initialize() {
    if (initialized) {
        refreshSettingsUI();
        return;
    }

    getSettings();
    registerDebugApi();

    try {
        await renderSettingsPanel();
    } catch (error) {
        warn(`Could not render settings UI: ${error.message}`);
    }

    const context = getSillyTavernContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.eventTypes ?? context?.event_types;

    if (eventsRegistered) {
        initialized = true;
        return;
    }

    if (!eventSource || !eventTypes?.WORLD_INFO_ACTIVATED) {
        setStatus('SillyTavern World Info events are not available.', true);
        showWarning('SillyTavern World Info events are not available.');
        return;
    }

    initialized = true;
    eventsRegistered = true;
    eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, onWorldInfoActivated);

    try {
        await loadLocations();
    } catch {
        warn('Waiting for a valid locations.json before applying locations.');
    }

    log('Ready.');
}

jQuery(() => {
    const context = getSillyTavernContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.eventTypes ?? context?.event_types;

    initialize();

    if (eventSource && eventTypes?.APP_READY) {
        eventSource.on(eventTypes.APP_READY, initialize);
    }
});
