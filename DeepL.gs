/*
MIT License

Copyright 2022 DeepL SE (https://www.deepl.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

// Securely store and retrieve the authentication key
function getAuthKey() {
  const userProperties = PropertiesService.getUserProperties();
  return userProperties.getProperty('DEEPL_AUTH_KEY');
}

function setAuthKey(key) {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('DEEPL_AUTH_KEY', key);
}

// Configuration flags
const DISABLE_TRANSLATIONS = false; // Set to true to stop translations.
const ACTIVATE_AUTO_DETECT = false; // Set to true to enable auto-detection of re-translation.

/* You shouldn't need to modify the lines below here */

/**
 * Translates from one language to another using the DeepL Translation API.
 *
 * Note that you need to set your DeepL auth key by calling DeepLAuthKey() before use.
 *
 * @param {"Hello"} input The text to translate.
 * @param {"en"} sourceLang Optional. The language code of the source language.
 *   Use "auto" to auto-detect the language.
 * @param {"es"} targetLang Optional. The language code of the target language.
 *   If unspecified, defaults to your system language.
 * @param {"def3a26b-3e84-..."} glossaryId Optional. The ID of a glossary to use
 *   for the translation.
 * @param {cell range} options Optional. Range of additional options to send with API translation
 *   request. May also be specified inline e.g. '{"tag_handling", "xml"; "ignore_tags", "ignore"}'
 * @return Translated text.
 * @customfunction
 */
function DeepLTranslate(input,
                        sourceLang,
                        targetLang,
                        glossaryId,
                        options
) {
    const authKey = getAuthKey();
    if (!authKey) {
        throw new Error("Authentication key is not set. Please set it using setAuthKey() function.");
    }

    if (input === undefined || input === '') {
        throw new Error("Input field is empty or undefined. Please specify the text to translate.");
    } else if (typeof input === "number") {
        input = input.toString();
    } else if (typeof input !== "string") {
        throw new Error("Input text must be a string.");
    }

    // Validate source and target languages
    if (sourceLang && !isValidLanguage(sourceLang)) {
        throw new Error("Invalid source language code.");
    }
    if (targetLang && !isValidLanguage(targetLang)) {
        throw new Error("Invalid target language code.");
    }
    // Check the current cell to detect recalculations due to reopening the sheet
    const cell = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getCurrentCell();

    if (disableTranslations) {
        Logger.log("disableTranslations is active, skipping DeepL translation request");
        return cell.getDisplayValue();
    }

    if (activateAutoDetect &&
            cell.getDisplayValue() !== "" &&
            cell.getDisplayValue() !== "Loading...") {
        Logger.log("Detected cell-recalculation, skipping DeepL translation request");
        return cell.getDisplayValue();
    }

    if (!targetLang) targetLang = selectDefaultTargetLang_();
    let formData = {
        'target_lang': targetLang,
        'text': input
    };
    if (sourceLang && sourceLang !== 'auto') {
        formData['source_lang'] = sourceLang;
    }
    if (glossaryId) {
        formData['glossary_id'] = glossaryId;
    }
    if (options) {
        if (!Array.isArray(options) ||
            !Object.values(options).every(function(value) {
                return Array.isArray(value) && value.length === 2;
            })) {
            throw new Error("options must be a range with two columns, or have the form '{\"opt1\", \"val1\"; \"opt2\", \"val2\"}'");
        }

        for (let i = 0; i < options.length; i++) {
            const items = options[i];
            const key = items[0];
            const value = items[1];
            formData[key] = value;
        }
    }

    const response = httpRequestWithRetries_('post', '/v2/translate', formData, input.length);
    checkResponse_(response);
    const responseObject = JSON.parse(response.getContentText());
    return responseObject.translations[0].text;
}

/**
 * Retrieve information about your DeepL API usage during the current billing period.
 * @param {"count", "limit"} type Optional, retrieve the current used amount ("count")
 *   or the maximum allowed amount ("limit").
 * @return String explaining usage, or count or limit values as specified by type argument.
 * @customfunction
 */
function DeepLUsage(type) {
    const authKey = getAuthKey();
    if (!authKey) {
        throw new Error("Authentication key is not set. Please set it using setAuthKey() function.");
    }

    const response = httpRequestWithRetries_('get', '/v2/usage');
    checkResponse_(response);
    const responseObject = JSON.parse(response.getContentText());
    const charCount = responseObject.character_count;
    const charLimit = responseObject.character_limit;
    if (charCount === undefined || charLimit === undefined)
        throw new Error('Character usage not found.');
    
    switch(type) {
        case 'count':
            return charCount;
        case 'limit':
            return charLimit;
        case undefined:
            return `${charCount} of ${charLimit} characters used.`;
        default:
            throw new Error('Unrecognized type argument. Use "count", "limit", or leave empty.');
    }
}

/////////////////////////////////////////////////////////////////////////////////////////
// General helper functions
/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Determines the default target language using the system language.
 * @return A DeepL-supported target language.
 * @throws Error If the system language could not be converted to a supported target language.
 */
function selectDefaultTargetLang_() {
    const targetLangs = [
        'bg', 'cs', 'da', 'de', 'el', 'en-gb', 'en-us', 'es', 'et', 'fi', 'fr', 'hu', 'id',
        'it', 'ja', 'lt', 'lv', 'nl', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'sk', 'sl', 'sv',
        'tr', 'zh'];
    const locale = Session.getActiveUserLocale().replace('_', '-').toLowerCase();
    if (targetLangs.indexOf(locale) !== -1) return locale;
    const localePrefix = locale.substring(0, 2);
    if (targetLangs.indexOf(localePrefix) !== -1) return localePrefix;
    if (localePrefix === 'en') return 'en-US';
    if (localePrefix === 'pt') return 'en-PT';
    return 'en';
}

/**
 * Helper function to check response code is OK and if not, throw useful exceptions.
 */
function checkResponse_(response) {
    const responseCode = response.getResponseCode();
    if (200 <= responseCode && responseCode < 400) return;

    const content = response.getContentText();

    let message = '';
    try {
        const jsonObj = JSON.parse(content);
        if (jsonObj.message !== undefined) {
            message += `, message: ${jsonObj.message}`;
        }
        if (jsonObj.detail !== undefined) {
            message += `, detail: ${jsonObj.detail}`;
        }
    } catch (error) {
        // JSON parsing errors are ignored, and we fall back to the raw content
        message = ', ' + content;
    }

    switch (responseCode) {
        case 403:
            throw new Error(`Authorization failure, check authKey${message}`);
        case 456:
            throw new Error(`Quota for this billing period has been exceeded${message}`);
        case 400:
            throw new Error(`Bad request${message}`);
        case 429:
            throw new Error(
                `Too many requests, DeepL servers are currently experiencing high load${message}`,
            );
        default: {
            throw new Error(
                `Unexpected status code: ${responseCode} ${message}, content: ${content}`,
            );
        }
    }
}

/**
 * Helper function to execute HTTP requests and retry failed requests.
 */
function httpRequestWithRetries_(method, relativeUrl, formData = null, charCount = 0) {
    const authKey = getAuthKey();
    if (!authKey) {
        throw new Error("Authentication key is not set. Please set it using setAuthKey() function.");
    }

    const baseUrl = authKey.endsWith(':fx')
        ? 'https://api-free.deepl.com'
        : 'https://api.deepl.com';
    const url = baseUrl + relativeUrl;
    const params = {
        method: method,
        muteHttpExceptions: true,
        headers: {
            'Authorization': 'DeepL-Auth-Key ' + authKey,
        },
    };
    if (formData) params.payload = formData;
    let response = null;
    for (let numRetries = 0; numRetries < 5; numRetries++) {
        const lastRequestTime = Date.now();
        try {
            Logger.log(`Sending HTTP request to ${url} with ${charCount} characters`);
            response = UrlFetchApp.fetch(url, params);
            const responseCode = response.getResponseCode();
            if (responseCode !== 429 && responseCode < 500) {
                return response;
            }
        } catch (e) {
            if (e.toString().includes('Timeout')) {
                Logger.log(`Request timed out. Retrying...`);
            } else {
                throw e; // Rethrow non-timeout errors
            }
        }
        Logger.log(`Retrying after ${numRetries} failed requests.`);
        sleepForBackoff(numRetries, lastRequestTime);
    }
    throw new Error("Max retries reached. Unable to complete the request.");
}

/**
 * Helper function to sleep after failed requests.
 */
function sleepForBackoff(numRetries, lastRequestTime) {
    const backoff = Math.min(1000 * (1.6 ** numRetries), 60000);
    const jitter = 1 + 0.23 * (2 * Math.random() - 1); // Random value in [0.77 1.23]
    const sleepTime = Date.now() - lastRequestTime + backoff * jitter;
    Utilities.sleep(sleepTime);
}
