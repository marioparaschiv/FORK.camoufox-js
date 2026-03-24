import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import tags from "language-tags";
import maxmind from "maxmind";
import xml2js from "xml2js";
import { InvalidLocale, MissingRelease, NotInstalledGeoIPExtra, UnknownIPLocation, UnknownLanguage, UnknownTerritory, } from "./exceptions.js";
import { validateIP } from "./ip.js";
import { GitHubDownloader, INSTALL_DIR, webdl } from "./pkgman.js";
import { getAsBooleanFromENV } from "./utils.js";
import { LeakWarning } from "./warnings.js";
const currentDir = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
export const ALLOW_GEOIP = true;
class Locale {
    language;
    region;
    script;
    constructor(language, region, script) {
        this.language = language;
        this.region = region;
        this.script = script;
    }
    asString() {
        if (this.region) {
            return `${this.language}-${this.region}`;
        }
        return this.language;
    }
    asConfig() {
        if (!this.region) {
            throw new Error("Region is required for config");
        }
        const data = {
            "locale:region": this.region,
            "locale:language": this.language,
        };
        if (this.script) {
            data["locale:script"] = this.script;
        }
        return data;
    }
}
class Geolocation {
    locale;
    longitude;
    latitude;
    timezone;
    accuracy;
    constructor(locale, longitude, latitude, timezone, accuracy) {
        this.locale = locale;
        this.longitude = longitude;
        this.latitude = latitude;
        this.timezone = timezone;
        this.accuracy = accuracy;
    }
    asConfig() {
        const data = {
            "geolocation:longitude": this.longitude,
            "geolocation:latitude": this.latitude,
            timezone: this.timezone,
            ...this.locale.asConfig(),
        };
        if (this.accuracy !== undefined) {
            data["geolocation:accuracy"] = this.accuracy;
        }
        return data;
    }
}
function verifyLocale(loc) {
    if (tags.check(loc)) {
        return;
    }
    throw InvalidLocale.invalidInput(loc);
}
export function normalizeLocale(locale) {
    verifyLocale(locale);
    const parser = tags(locale);
    if (!parser.region) {
        throw InvalidLocale.invalidInput(locale);
    }
    return new Locale(parser.language()?.format() ?? "en", parser.region()?.format(), parser.language()?.script()?.format());
}
export function handleLocale(locale, ignoreRegion = false) {
    if (locale.length > 3) {
        return normalizeLocale(locale);
    }
    try {
        return SELECTOR.fromRegion(locale);
    }
    catch (e) {
        if (e instanceof UnknownTerritory) {
        }
        else {
            throw e;
        }
    }
    if (ignoreRegion) {
        verifyLocale(locale);
        return new Locale(locale);
    }
    try {
        const language = SELECTOR.fromLanguage(locale);
        LeakWarning.warn("no_region");
        return language;
    }
    catch (e) {
        if (e instanceof UnknownLanguage) {
        }
        else {
            throw e;
        }
    }
    throw InvalidLocale.invalidInput(locale);
}
export function handleLocales(locales, config) {
    if (typeof locales === "string") {
        locales = locales.split(",").map((loc) => loc.trim());
    }
    const intlLocale = handleLocale(locales[0]).asConfig();
    for (const key in intlLocale) {
        config[key] = intlLocale[key];
    }
    if (locales.length < 2) {
        return;
    }
    config["locale:all"] = joinUnique(locales.map((locale) => handleLocale(locale, true).asString()));
}
function joinUnique(seq) {
    const seen = new Set();
    return seq.filter((x) => !seen.has(x) && seen.add(x)).join(", ");
}
const GEOIP_SOURCES = {
    geolite2: {
        name: "MaxMind GeoLite2",
        urls: {
            ipv4: [
                "https://cdn.jsdelivr.net/npm/@ip-location-db/geolite2-city-mmdb/geolite2-city-ipv4.mmdb",
                "https://raw.githubusercontent.com/sapics/ip-location-db/refs/heads/main/geolite2-city-mmdb/geolite2-city-ipv4.mmdb",
            ],
            ipv6: [
                "https://cdn.jsdelivr.net/npm/@ip-location-db/geolite2-city-mmdb/geolite2-city-ipv6.mmdb",
                "https://raw.githubusercontent.com/sapics/ip-location-db/refs/heads/main/geolite2-city-mmdb/geolite2-city-ipv6.mmdb",
            ],
        },
        paths: {
            iso_code: "country_code",
            longitude: "longitude",
            latitude: "latitude",
            timezone: "timezone",
        },
    },
    "geoip-aio": {
        name: "GeoIP AIO by daijro",
        urls: {
            combined: [
                "https://github.com/daijro/geoip-all-in-one/releases/latest/download/geoip-aio-all.mmdb.zip",
            ],
        },
        paths: {
            iso_code: "country.iso_code",
            longitude: "location.longitude",
            latitude: "location.latitude",
            timezone: "location.time_zone",
        },
    },
};
const DEFAULT_GEOIP_SOURCE = "geolite2";
const MMDB_DIR = path.join(INSTALL_DIR.toString(), "geoip");
function getGeoIPSource(name) {
    const sourceName = name ?? DEFAULT_GEOIP_SOURCE;
    const source = GEOIP_SOURCES[sourceName.toLowerCase()];
    if (!source) {
        const available = Object.keys(GEOIP_SOURCES).join(", ");
        throw new Error(`GeoIP database '${sourceName}' not found. Available: ${available}`);
    }
    return source;
}
function getMmdbPath(ipVersion = "ipv4", source) {
    const src = source ?? getGeoIPSource();
    const name = src.name.toLowerCase().replace(/\s+/g, "-");
    if ("combined" in src.urls) {
        return path.join(MMDB_DIR, `${name}-combined.mmdb`);
    }
    return path.join(MMDB_DIR, `${name}-${ipVersion}.mmdb`);
}
/** Resolve a dotted path in a nested object (e.g. "country.iso_code") */
function findIn(data, key) {
    for (const part of key.split(".")) {
        if (data == null || typeof data !== "object")
            return undefined;
        data = data[part];
    }
    return data;
}
/** Check if the GeoIP database needs an update (older than 30 days) */
function needsUpdate(mmdbPath) {
    if (!fs.existsSync(mmdbPath))
        return true;
    const stats = fs.statSync(mmdbPath);
    const ageMs = Date.now() - stats.mtimeMs;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    return ageMs > thirtyDaysMs;
}
// Legacy path for backwards compatibility
const LEGACY_MMDB_FILE = path.join(INSTALL_DIR.toString(), "GeoLite2-City.mmdb");
class MaxMindDownloader extends GitHubDownloader {
    checkAsset(asset) {
        if (asset.name.endsWith("-City.mmdb")) {
            return asset.browser_download_url;
        }
        return null;
    }
    missingAssetError() {
        throw new MissingRelease("Failed to find GeoIP database release asset");
    }
}
export function geoipAllowed() {
    if (!ALLOW_GEOIP) {
        throw new NotInstalledGeoIPExtra("Please install the geoip extra to use this feature: pip install camoufox[geoip]");
    }
}
export async function downloadMMDB(sourceName) {
    geoipAllowed();
    if (getAsBooleanFromENV("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", false)) {
        console.log("Skipping GeoIP database download due to PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD set!");
        return;
    }
    const source = getGeoIPSource(sourceName);
    // Ensure mmdb directory exists
    if (!fs.existsSync(MMDB_DIR)) {
        fs.mkdirSync(MMDB_DIR, { recursive: true });
    }
    for (const [ipVer, urlList] of Object.entries(source.urls)) {
        const mmdbPath = getMmdbPath(ipVer, source);
        let lastError = null;
        for (const url of urlList) {
            try {
                const fileStream = fs.createWriteStream(mmdbPath);
                await webdl(url, `Downloading ${source.name} (${ipVer})`, true, fileStream);
                lastError = null;
                break;
            }
            catch (e) {
                lastError = e;
                continue;
            }
        }
        if (lastError) {
            throw lastError;
        }
    }
}
export function removeMMDB() {
    // Remove new-style mmdb directory
    if (fs.existsSync(MMDB_DIR)) {
        fs.rmSync(MMDB_DIR, { recursive: true });
        console.log("GeoIP database removed.");
        return;
    }
    // Remove legacy file
    if (fs.existsSync(LEGACY_MMDB_FILE)) {
        fs.unlinkSync(LEGACY_MMDB_FILE);
        console.log("GeoIP database removed.");
        return;
    }
    console.log("GeoIP database not found.");
}
export async function getGeolocation(ip, geoipDb) {
    validateIP(ip);
    const source = getGeoIPSource(geoipDb);
    const ipVersion = ip.includes(":") ? "ipv6" : "ipv4";
    let mmdbPath = getMmdbPath(ipVersion, source);
    // Download if missing or outdated
    if (!fs.existsSync(mmdbPath) || needsUpdate(mmdbPath)) {
        // Check legacy path for backwards compatibility
        if (!geoipDb &&
            fs.existsSync(LEGACY_MMDB_FILE) &&
            !needsUpdate(LEGACY_MMDB_FILE)) {
            mmdbPath = LEGACY_MMDB_FILE;
        }
        else {
            await downloadMMDB(geoipDb);
            mmdbPath = getMmdbPath(ipVersion, source);
        }
    }
    const reader = await maxmind.open(mmdbPath);
    const resp = reader.get(ip);
    if (!resp) {
        throw new UnknownIPLocation(`IP not found in database: ${ip}`);
    }
    const isoCode = findIn(resp, source.paths.iso_code);
    const longitude = findIn(resp, source.paths.longitude);
    const latitude = findIn(resp, source.paths.latitude);
    const timezone = findIn(resp, source.paths.timezone);
    if (!isoCode || longitude == null || latitude == null || !timezone) {
        throw new UnknownIPLocation(`Unknown IP location: ${ip}`);
    }
    const locale = SELECTOR.fromRegion(String(isoCode).toUpperCase());
    return new Geolocation(locale, Number(longitude), Number(latitude), String(timezone));
}
function getUnicodeInfo() {
    const data = fs.readFileSync(path.join(currentDir, "data-files", "territoryInfo.xml"));
    const parser = new xml2js.Parser();
    let result;
    parser.parseString(data, (err, parsed) => {
        if (err)
            throw err;
        result = parsed;
    });
    return result;
}
function asFloat(element, attr) {
    return parseFloat(element[attr] || "0");
}
class StatisticalLocaleSelector {
    root;
    constructor() {
        this.root = getUnicodeInfo();
    }
    loadTerritoryData(isoCode) {
        const territory = this.root.territoryInfo.territory.find((t) => t.$.type === isoCode);
        if (!territory) {
            throw new UnknownTerritory(`Unknown territory: ${isoCode}`);
        }
        const langPopulations = territory.languagePopulation;
        if (!langPopulations) {
            throw new Error(`No language data found for region: ${isoCode}`);
        }
        const languages = langPopulations.map((lang) => lang.$.type);
        const percentages = langPopulations.map((lang) => asFloat(lang.$, "populationPercent"));
        return this.normalizeProbabilities(languages, percentages);
    }
    loadLanguageData(language) {
        const territories = this.root.territoryInfo.territory.filter((t) => t.languagePopulation?.some((lp) => lp.$.type === language));
        if (!territories.length) {
            throw new UnknownLanguage(`No region data found for language: ${language}`);
        }
        const regions = [];
        const percentages = [];
        for (const terr of territories) {
            const region = terr.$.type;
            const langPop = terr.languagePopulation.find((lp) => lp.$.type === language);
            if (region && langPop) {
                regions.push(region);
                percentages.push(((asFloat(langPop.$, "populationPercent") *
                    asFloat(terr.$, "literacyPercent")) /
                    10000) *
                    asFloat(terr.$, "population"));
            }
        }
        if (!regions.length) {
            throw new Error(`No valid region data found for language: ${language}`);
        }
        return this.normalizeProbabilities(regions, percentages);
    }
    normalizeProbabilities(languages, freq) {
        const total = freq.reduce((a, b) => a + b, 0);
        return [languages, freq.map((f) => f / total)];
    }
    weightedRandomChoice(items, weights) {
        if (items.length === 0) {
            throw new Error("items must not be empty");
        }
        if (items.length !== weights.length) {
            throw new Error("items and weights must have the same length");
        }
        let total = 0;
        for (const w of weights) {
            if (w < 0) {
                throw new Error("weights must be non-negative");
            }
            total += w;
        }
        // Fallback to uniform choice if all weights are zero
        if (total === 0) {
            return items[Math.floor(Math.random() * items.length)];
        }
        const r = Math.random() * total;
        let acc = 0;
        for (let i = 0; i < items.length; i++) {
            acc += weights[i];
            if (r < acc) {
                return items[i];
            }
        }
        // Numerical edge case
        return items[items.length - 1];
    }
    fromRegion(region) {
        const [languages, probabilities] = this.loadTerritoryData(region);
        const language = this.weightedRandomChoice(languages, probabilities).replace("_", "-");
        return normalizeLocale(`${language}-${region}`);
    }
    fromLanguage(language) {
        const [regions, probabilities] = this.loadLanguageData(language);
        const region = this.weightedRandomChoice(regions, probabilities);
        return normalizeLocale(`${language}-${region}`);
    }
}
const SELECTOR = new StatisticalLocaleSelector();
