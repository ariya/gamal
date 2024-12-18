#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const GAMAL_HTTP_PORT = process.env.GAMAL_HTTP_PORT;
const GAMAL_TELEGRAM_TOKEN = process.env.GAMAL_TELEGRAM_TOKEN;

const WHISPER_STREAM = process.env.WHISPER_STREAM || 'whisper-cpp-stream';
const WHISPER_MODEL = process.env.WHISPER_MODEL;

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
const LLM_API_BASE_URL = process.env.LLM_API_BASE_URL || 'https://openrouter.ai/api/v1';
const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL || 'meta-llama/llama-3.1-8b-instruct';
const LLM_STREAMING = process.env.LLM_STREAMING !== 'no';
const LLM_JSON_SCHEMA = process.env.LLM_JSON_SCHEMA;

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://searx.foss.family'; // alternatively: 'https://search.mdosch.de'
const TOP_K = 3;

const VOICE_DEBUG = process.env.VOICE_DEBUG;
const LLM_DEBUG_CHAT = process.env.LLM_DEBUG_CHAT;
const LLM_DEBUG_PIPELINE = process.env.LLM_DEBUG_PIPELINE;
const LLM_DEBUG_SEARCH = process.env.LLM_DEBUG_SEARCH;
const LLM_DEBUG_FAIL_EXIT = process.env.LLM_DEBUG_FAIL_EXIT;

const NORMAL = '\x1b[0m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[93m';
const BLUE = '\x1b[94m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[91m';
const GREEN = '\x1b[92m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const ARROW = '⇢';
const CHECK = '✓';
const CROSS = '✘';

const TRANSCRIPTION_END_MARKER = /Transcription \d+ END/i;

/**
 * Starts a new speech recognition process.
 *
 * @param {function} handler - callback function to handle the transcribed text
 * @return {childProcess} the spawned process
 */
const listen = (handler) => {
    if (!WHISPER_MODEL) {
        VOICE_DEBUG && console.error('No whisper model is specified!');
        return;
    }

    try {
        VOICE_DEBUG && console.log(`Starting ${WHISPER_STREAM} with model ${WHISPER_MODEL}...`);
        const options = { stdio: ['pipe', 'pipe', 'ignore'] };
        const process = spawn(WHISPER_STREAM, ['-m', WHISPER_MODEL, '--step', '0'], options);

        let buffer = '';

        process.stdout.on('data', (data) => {
            VOICE_DEBUG && console.log(`whisper-cpp-stream: ${data.length} bytes`);
            buffer += data.toString();
            if (buffer.match(TRANSCRIPTION_END_MARKER)) {
                const transcript = buffer
                    .split('\n')
                    .filter((line) => line && line.length > 0)
                    .filter((line) => !line.startsWith('###'))
                    .join('\n')
                    .replace(/\n/g, ' ')
                    .replace(/\./g, '')
                    .replace(/\[.*?\]/g, '')
                    .replace(/\(.*?\)/g, '')
                    .trim();
                if (transcript.length > 0 && handler) {
                    handler && handler(transcript);
                }
                buffer = '';
            }
        });

        process.on('exit', (code) => {
            VOICE_DEBUG && console.log('whisper-cpp-stream finished with', code);
        });

        return process;
    } catch (e) {
        VOICE_DEBUG && console.error('ASR failed:', e);
    }
};

/**
 * Speaks the given text in the specified language using a text-to-speech model.
 *
 * @param {string} text - the text to be spoken
 * @param {string} language - the language of the text
 * @return {object} an object containing the speaker and piper processes
 */
const speak = (text, language = 'en') => {
    const lang = language.toUpperCase();
    const ref = `PIPER_MODEL_${lang}`;
    let model = process.env[ref];
    if (!model || model.length <= 0) {
        model = process.env.PIPER_MODEL;
        if (model && model.length > 0) {
            VOICE_DEBUG && console.log('Using fallback TTS model for', lang, model);
        } else {
            VOICE_DEBUG && console.log('TTS model is not available for', lang);
        }
    }

    if (!model) {
        return;
    }

    let buffer = text;
    while (true) {
        const index = buffer.indexOf('[citation:');
        if (index < 0) {
            break;
        }
        const number = buffer[index + 10];
        if (number >= '0' && number <= '9') {
            buffer = buffer.slice(0, index) + buffer.slice(index + 12);
        }
    }

    try {
        VOICE_DEBUG && console.log('Setting up play (from sox) for audio output...');

        // quiet, lowest verbosity, pipe to stdin
        const options = { stdio: ['pipe', 'pipe', 'inherit'] };
        const speaker = spawn('play', ['-q', '-V0', '-'], options);
        speaker.on('error', (err) => {
            VOICE_DEBUG && console.log('play failed to run', err);
        });
        speaker.on('exit', (code) => {
            VOICE_DEBUG && console.log('play finished with', code);
        });

        // quiet, pipe to stdout
        const piper = spawn('piper', ['--quiet', '--model', model, '-f', '-'], options);
        piper.on('error', (err) => {
            VOICE_DEBUG && console.log('piper failed to run', err);
        });
        piper.on('exit', (code) => {
            VOICE_DEBUG && console.log('piper finished with', code);
        });
        piper.stdout.pipe(speaker.stdin);
        piper.stdin.write(buffer);
        piper.stdin.end();

        return { speaker, piper };
    } catch (e) {
        VOICE_DEBUG && console.error('TTS failed:', e);
    }
};

/**
 * Creates a new function by chaining multiple async functions from left to right.
 *
 * @param  {...any} fns - Functions to chain
 * @returns {function}
 */
const pipe =
    (...fns) =>
        (arg) =>
            fns.reduce((d, fn) => d.then(fn), Promise.resolve(arg));

const MAX_RETRY_ATTEMPT = 3;

/**
 * Suspends the execution for a specified amount of time.
 *
 * @param {number} ms - The amount of time to suspend execution in milliseconds.
 * @returns {Promise<void>} - A promise that resolves after the specified time has elapsed.
 */
const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tries to parse a string as JSON, but if that fails, tries adding a
 * closing curly brace or double quote to fix the JSON.
 *
 * @param {string} text
 * @returns {Object}
 */
const unJSON = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            return JSON.parse(text + '}');
        } catch (e) {
            try {
                return JSON.parse(text + '"}');
            } catch (e) {
                return {};
            }
        }
    }
}

/**
 * Breaks down the completion into a dictionary containing the thought process,
 * important keyphrases, observation, and topic.
 *
 * @param {string} hint - The hint or example given to the LLM.
 * @param {string} completion - The completion generated by the LLM.
 * @returns {Object} Breakdown of the thought process into a dictionary.
 */
const breakdown = (hint, completion) => {
    const remark = completion
        .replace('<|start_header_id|>', '')
        .replace('<|end_header_id|>', '')
        .replace(/^assistant/, '')
        .trim();
    const text = remark.startsWith(hint) ? remark : hint + remark;
    if (text.startsWith('{')) {
        try {
            return unJSON(text);
        } catch (error) {
            LLM_DEBUG_CHAT && console.error(`Failed to parse JSON: ${text.replaceAll('\n', '')}`);
        }
    }
    let result = deconstruct(text);
    const { topic } = result;
    if (!topic || topic.length === 0) {
        result = deconstruct(text + '\n' + 'TOPIC: general knowledge.');
    }
    return result;
};


/**
 * Returns a formatted string based on the given object.
 *
 * @param {string} [prefix] - An optional prefix string
 * @param {Object} object - The object to format
 * @returns {string} The formatted string
 */
const structure = (prefix, object) => {
    if (LLM_JSON_SCHEMA) {
        const format = prefix ? prefix + ' (JSON with this schema)' : '';
        return format + '\n' + JSON.stringify(object, null, 2) + '\n';
    }

    return (prefix || '') + '\n\n' + construct(object) + '\n';
};

/**
 * Represents a chat message.
 *
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * A callback function to stream then completion.
 *
 * @callback CompletionHandler
 * @param {string} text
 * @returns {void}
 */

/**
 * Generates a chat completion using a RESTful LLM API service.
 *
 * @param {Array<Message>} messages - List of chat messages.
 * @param {Object} schema - An optional JSON schema for the completion.
 * @param {CompletionHandler=} handler - An optional callback to stream the completion.
 * @returns {Promise<string>} The completion generated by the LLM.
 */

const chat = async (messages, schema, handler = null, attempt = MAX_RETRY_ATTEMPT) => {
    const timeout = 17; // seconds
    const gemini = LLM_API_BASE_URL.indexOf('generativelanguage.google') > 0;
    const stream = LLM_STREAMING && typeof handler === 'function';
    const model = LLM_CHAT_MODEL || 'gpt-4o-mini';
    const generate = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'
    const url = gemini ? `${LLM_API_BASE_URL}/models/${model}:${generate}key=${LLM_API_KEY}` : `${LLM_API_BASE_URL}/chat/completions`
    const auth = (LLM_API_KEY && !gemini) ? { 'Authorization': `Bearer ${LLM_API_KEY}` } : {};
    const stop = ['<|im_end|>', '<|end|>', '<|eot_id|>'];
    const max_tokens = 500;
    const temperature = 0;

    const response_format = schema ? {
        type: 'json_schema',
        json_schema: {
            schema,
            name: 'response',
            strict: true
        }
    } : undefined;

    const geminify = schema => ({ ...schema, additionalProperties: undefined });
    const response_schema = response_format ? geminify(schema) : undefined;
    const response_mime_type = response_schema ? 'application/json' : 'text/plain';

    const bundles = messages.map(({ role, content }) => {
        return { role, parts: [{ text: content }] };
    });
    const contents = bundles.filter(({ role }) => role === 'user');
    const system_instruction = bundles.filter(({ role }) => role === 'system').shift();
    const generationConfig = { temperature, response_mime_type, response_schema, maxOutputTokens: max_tokens };

    const body = gemini ?
        { system_instruction, contents, generationConfig } :
        { messages, response_format, model, stop, max_tokens, temperature, stream }

    LLM_DEBUG_CHAT &&
        messages.forEach(({ role, content }) => {
            console.log(`${MAGENTA}${role}:${NORMAL} ${content}`);
        });

    try {

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(`HTTP error with the status: ${response.status} ${response.statusText}`);
        }

        const extract = (data) => {
            const { choices, candidates } = data;
            const first = choices ? choices[0] : candidates[0];
            if (first?.content || first?.message) {
                const content = first?.content ? first.content : first.message.content;
                const parts = content?.parts;
                const answer = parts ? parts.map(part => part.text).join('') : content;
                return answer;
            }
            return '';
        }

        if (!stream) {
            const data = await response.json();
            const answer = extract(data).trim();
            if (LLM_DEBUG_CHAT) {
                if (LLM_JSON_SCHEMA) {
                    const parsed = unJSON(answer);
                    const empty = Object.keys(parsed).length === 0;
                    const formatted = empty ? answer : JSON.stringify(parsed, null, 2);
                    console.log(`${YELLOW}${formatted}${NORMAL}`);
                } else {
                    console.log(`${YELLOW}${answer}${NORMAL}`);
                }
            }
            (answer.length > 0) && handler && handler(answer);
            return answer;
        }

        const parse = (line) => {
            let partial = null;
            const prefix = line.substring(0, 6);
            if (prefix === 'data: ') {
                const payload = line.substring(6);
                try {
                    const data = JSON.parse(payload);
                    const { choices, candidates } = data;
                    if (choices) {
                        const [choice] = choices;
                        const { delta } = choice;
                        partial = delta?.content;
                    } else if (candidates) {
                        partial = extract(data);
                    }
                } catch (e) {
                    // ignore
                } finally {
                    return partial;
                }
            }
            return partial;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let answer = '';
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            const lines = decoder.decode(value).split('\n');
            for (let i = 0; i < lines.length; ++i) {
                const line = buffer + lines[i];
                if (line[0] === ':') {
                    buffer = '';
                    continue;
                }
                if (line === 'data: [DONE]') {
                    break;
                }
                if (line.length > 0) {
                    const partial = parse(line.trim());
                    if (partial === null) {
                        buffer = line;
                    } else if (partial && partial.length > 0) {
                        buffer = '';
                        if (answer.length < 1) {
                            const leading = partial.trim();
                            answer = leading;
                            handler && (leading.length > 0) && handler(leading);
                        } else {
                            answer += partial;
                            handler && handler(partial);
                        }
                    }
                }
            }
        }
        return answer;
    } catch (e) {
        if (e.name === 'TimeoutError') {
            LLM_DEBUG_CHAT && console.log(`Timeout with LLM chat after ${timeout} seconds`);
        }
        if (attempt > 1 && (e.name === 'TimeoutError' || e.name === 'EvalError')) {
            LLM_DEBUG_CHAT && console.log('Retrying...');
            await sleep((MAX_RETRY_ATTEMPT - attempt + 1) * 1500);
            return await chat(messages, schema, handler, attempt - 1);
        } else {
            throw e;
        }
    }
}

const PREDEFINED_KEYS = ['inquiry', 'tool', 'language', 'thought', 'keyphrases', 'observation', 'answer', 'topic'];

/**
 * Break downs a multi-line text based on a number of predefined keys.
 *
 * @param {string} text
 * @returns {Array<string>}
 */

const deconstruct = (text, markers = PREDEFINED_KEYS) => {
    const parts = {};
    const keys = [...markers].reverse();
    const anchor = markers.slice().pop();
    const start = text.lastIndexOf(anchor + ':');
    if (start >= 0) {
        parts[anchor] = text.substring(start).replace(anchor + ':', '').trim();
        let str = text.substring(0, start);
        for (let i = 0; i < keys.length; ++i) {
            const marker = keys[i];
            const pos = str.lastIndexOf(marker + ':');
            if (pos >= 0) {
                const substr = str.substr(pos + marker.length + 1).trim();
                const value = substr.split('\n').shift();
                str = str.slice(0, pos);
                parts[marker] = value;
            }
        }
    }
    return parts;
};

/**
 * Constructs a multi-line text based on a number of key-value pairs.
 *
 * @param {Object} key-value pairs
 * @return {text}
 */
const construct = (kv) => {
    if (LLM_JSON_SCHEMA) {
        return JSON.stringify(kv, null, 2);
    }
    return PREDEFINED_KEYS.filter(key => kv[key]).map(key => {
        const value = kv[key];
        if (value && value.length > 0) {
            return `${key}: ${value}`;
        }
        return null;
    }).join('\n');
};

/**
 * Represents the record of an atomic processing.
 *
 * @typedef {Object} Stage
 * @property {string} name
 * @property {number} timestamp (Unix epoch)
 * @property {number} duration (in ms)
 */

/**
 * Represents the contextual information for each pipeline stage.
 *
 * @typedef {Object} Context
 * @property {Array<object>} history
 * @property {string} inquiry
 * @property {string} thought
 * @property {string} keyphrases
 * @property {string} observation
 * @property {string} answer
 * @property {Object.<string, function>} delegates - Impure functions to access the outside world.
 */

/**
 * Performs a basic step-by-step reasoning, in the style of Chain of Thought.
 * The updated context will contains new information such as `keyphrases` and `observation`.
 *
 * @param {Context} context - Current pipeline context.
 * @returns {Context} Updated pipeline context.
 */

const REASON_PROMPT = `You are Gamal, a world-class answering assistant.
You are interacting with a human who gives you an inquiry.
Your task is as follows.

Focus on the last message from the user.
If necessary, refer to the relevant part of the previous conversation history.
This is particulary useful when the inquiry is a follow-up question with pronouns, or when the inquiry contains pronouns referring to the earlier discussion.

Use Google to search for the answer. Think step by step. Fix any misspelings.
Do not refuse to search for future events beyond your knowledge cutoff, because Google will still find it for you.

Use the same language as the inquiry.

Always output your thought in the following format`;

const REASON_GUIDELINE = {
    tool: 'the search engine to use (must be Google)',
    language: 'the language of the inquiry e.g. French, Spanish, Mandarin, etc',
    thought: 'describe your thoughts about the inquiry',
    keyphrases: 'the important key phrases to search for',
    observation: 'the concise result of the search tool',
    topic: 'the specific topic covering the inquiry'
};

const REASON_EXAMPLE_FRENCH_INQUIRY = `
# Example 1

Given an inquiry "Pour quoi le lac de Pitch à Trinidad est-il célèbre?", you will output:`;

const REASON_EXAMPLE_FRENCH_OUTPUT = {
    tool: 'Google',
    language: 'French',
    thought: 'Cela concerne la géographie, je vais utiliser la recherche Google',
    keyphrases: 'Pitch Lake in Trinidad famerenommée du lac de Pitch à Trinidad',
    observation: 'Le lac de Pitch à Trinidad est le plus grand dépôt naturel d\'asphalte.',
    topic: 'géographie'
};

const REASON_EXAMPLE_ENGLISH_INQUIRY = `
# Example 2

Given an inquiry "What mineral was once considered the rarest in the world?", you will output:`;

const REASON_EXAMPLE_ENGLISH_OUTPUT = {
    tool: 'Google',
    language: 'English',
    thought: 'This is about mineralogy, I will use Google to search for the answer',
    keyphrases: 'rarest mineral in the world',
    observation: 'Painite was once considered the rarest mineral in the world, with only a handful of specimens known until new deposits were discovered in the early 2000s.',
    topic: 'mineralogy'
};

const REASON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tool: {
            type: 'string'
        },
        language: {
            type: 'string'
        },
        thought: {
            type: 'string'
        },
        keyphrases: {
            type: 'string'
        },
        observation: {
            type: 'string'
        },
        topic: {
            type: 'string'
        }
    },
    required: [
        'tool',
        'language',
        'thought',
        'keyphrases',
        'observation',
        'topic'
    ]
};

const reason = async (context) => {
    const { history = [], delegates = {} } = context;
    const { enter, leave } = delegates;
    enter && enter('Reason');

    const schema = LLM_JSON_SCHEMA ? REASON_SCHEMA : null;
    const relevant = history.slice(-3);

    const messages = [];
    let prompt = structure(REASON_PROMPT, REASON_GUIDELINE);
    prompt += structure(REASON_EXAMPLE_FRENCH_INQUIRY, REASON_EXAMPLE_FRENCH_OUTPUT);
    prompt += structure(REASON_EXAMPLE_ENGLISH_INQUIRY, REASON_EXAMPLE_ENGLISH_OUTPUT);
    if (relevant.length > 0) {
        prompt += '\n\n';
        prompt += ['# Conversation History', 'You and the user recently discussed:'].join('\n\n');
        prompt += '\n\n';
        relevant.forEach((msg) => {
            const { inquiry, answer } = msg;
            prompt += `  * ${inquiry}\n`;
            prompt += `  * ${answer}\n`;
        });
    }
    messages.push({ role: 'system', content: prompt });

    const { inquiry } = context;
    messages.push({ role: 'user', content: inquiry });
    const hint = schema ? '' : ['tool: Google', 'language: '].join('\n');
    (!schema) && messages.push({ role: 'assistant', content: hint });
    const completion = await chat(messages, schema);
    let result = breakdown(hint, completion);
    if (!result.keyphrases || result.keyphrases.length === 0) {
        LLM_DEBUG_CHAT && console.log(`-->${RED}Invalid keyphrases. Trying again...`);
        if (!schema) {
            const hint = ['TOOL: Google.', 'THOUGHT: ' + result.thought, 'KEYPHRASES: '].join('\n');
            messages.pop();
            messages.push({ role: 'assistant', content: hint });
        }
        const completion = await chat(messages);
        result = breakdown(hint, completion);
    }
    const { language, topic, thought, keyphrases, observation } = result;
    LLM_DEBUG_CHAT && console.log(`-->${GREEN}${JSON.stringify({ language, topic, keyphrases }, null, 2)}`);
    leave && leave('Reason', { language, topic, thought, keyphrases, observation });
    return { language, topic, thought, keyphrases, observation, ...context };
};

/**
 * Determines the ISO 639-1 language code based on the input language string.
 *
 * @param {string} language - The language string to be checked.
 * @return {string} The corresponding ISO 639-1 language code or null if not found.
 */
const iso6391 = (language) => {
    const lang = language || 'Unknown';
    const CODE = {
        German: 'de',
        Deutsch: 'de',
        French: 'fr',
        Français: 'fr',
        Spanish: 'es',
        Español: 'es',
        Indonesia: 'id',
        Bahasa: 'id',
        Italian: 'it',
        Italiano: 'it'
    };
    const name = Object.keys(CODE).find((key) => lang.toLowerCase().startsWith(key.toLowerCase()));
    return name ? CODE[name] : null;
};

/**
 * Searches for relevant information using SearXNG.
 *
 * @param {string} query - The search query.
 * @return {Array} Array of references containing search results.
 * @throws {Error} - If the search fails with a non-200 status.
 */
const searxng = async (query, language, attempt = MAX_RETRY_ATTEMPT) => {
    const timeout = 31; // seconds

    LLM_DEBUG_SEARCH && console.log(`SearXNG search with language: ${MAGENTA}${language}${NORMAL}, query: ${YELLOW}${query}${NORMAL}`);

    const lang = iso6391(language) || 'auto';
    let url = new URL(`${SEARXNG_URL}/search`);
    url.searchParams.append('q', query);
    url.searchParams.append('language', lang);
    url.searchParams.append('categories', 'web');
    url.searchParams.append('engines', 'go,ddg,bi,br,yh,qw,sp,mjk');
    url.searchParams.append('safesearch', '0');
    url.searchParams.append('format', 'json');
    try {
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(timeout * 1000)
        });
        if (!response.ok) {
            throw new EvalError(`SearXNG failed with status: ${response.status}`);
        }
        const { results = [] } = await response.json();
        const references = results
            .filter((entry) => {
                const { url, content } = entry;
                return url && url.length > 0 && content && content.length > 0;
            })
            .slice(0, TOP_K)
            .map((entry, i) => {
                const { url, title, content } = entry;
                const position = i + 1;
                const snippet = content;
                return { position, url, title, snippet };
            });
        if (references.length <= 0) {
            throw new EvalError('SearXNG failed, giving no result');
        }
        return { url, references };
    } catch (e) {
        LLM_DEBUG_SEARCH && console.log();
        if (e.name === 'TimeoutError') {
            LLM_DEBUG_SEARCH && console.log(`Timeout with SearXNG after ${timeout} seconds`);
        }
        if (attempt > 1 && (e.name === 'TimeoutError' || e.name === 'EvalError')) {
            LLM_DEBUG_SEARCH && console.log(`Retrying... (due to error: ${e.toString()})`);
            await sleep((MAX_RETRY_ATTEMPT - attempt + 1) * 1500);
            return await searxng(query, language, attempt - 1);
        } else {
            throw e;
        }
    }
};

/**
 * Uses the online search engine to collect relevant information based on the keyphrases.
 * The TOP_K most relevant results will be stored in `references`.
 *
 * @param {Context} context - Current pipeline context.
 * @returns {Context} Updated pipeline context.
 */
const search = async (context) => {
    const { delegates, keyphrases, topic, language } = context;
    const { enter, leave } = delegates;
    enter && enter('Search');

    const query = (topic || '') + ': ' + keyphrases.replace(/\.$/, '').replace(/^"|"$/g, '');

    const { url, references } = await searxng(query, language);
    leave && leave('Search', { engine: 'SearXNG', url, references });
    return { ...context, references };
};

/**
 * Responds to the user's recent message using an LLM.
 * The response from the LLM is available as `answer` in the updated context.
 *
 * @param {Context} context - Current pipeline context.
 * @returns {Context} Updated pipeline context.
 */

const RESPOND_PROMPT = `You are a world-renowned research assistant.
You are given a user question, and please write clean, concise and accurate answer to the question.
You will be given a set of related references to the question, each starting with a reference number like [citation:x], where x is a number.
Please use only 3 most relevant references, not all of them.
Cite each reference at the end of each sentence.

You are expected to provide an answer that is accurate, correct, and reflect expert knowledge.
Your answer must maintain an unbiased and professional tone.
Your answer should not exceed 3 sentences in length, unless the instruction is to do so.

Do not give any information that is not related to the question.
No need to mention "according to the references..." and other internal references.

Use plain text only, no markdown or HTML.

After every sentence, always cite the reference with the citation numbers, in the format [citation:x].
If a sentence comes from multiple references, please list all applicable citations, like [citation:3][citation:5].

Here are the set of references:

{REFERENCES}

Remember, don't blindly repeat the references verbatim.
Only supply the answer and do not add any additional commentaries, notes, remarks, list of citations, literature references, extra translations, postanalysis.

Your answer must be in the same language as the inquiry, i.e. {LANGUAGE}.`;

const respond = async (context) => {
    const { history, delegates = {} } = context;
    const { enter, leave, stream } = delegates;
    enter && enter('Respond');

    const { inquiry, language = 'English', references = [] } = context;

    const messages = [];
    if (references && Array.isArray(references) && references.length > 0) {
        const refs = references.map((ref) => {
            const { position, title, snippet } = ref;
            return `[citation:${position}] ${snippet}`;
        });

        let prompt = RESPOND_PROMPT.replace('{LANGUAGE}', language).replace('{REFERENCES}', refs.join('\n'));
        const relevant = history.slice(-2);
        if (relevant.length > 0) {
            prompt += '\n\n';
            prompt += ['# Conversation History', 'You and the user recently discussed:'].join('\n\n');
            prompt += '\n\n';
            relevant.forEach((msg) => {
                const { inquiry, answer } = msg;
                prompt += `  * ${inquiry}\n`;
                prompt += `  * ${answer}\n`;
            });
        }
        messages.push({ role: 'system', content: prompt });
    } else {
        console.error('No references to cite');
    }
    messages.push({ role: 'user', content: inquiry });
    const schema = null;
    const answer = await chat(messages, schema, stream);
    leave && leave('Respond', { inquiry });
    return { answer, ...context };
};

/**
 * Prints the pipeline stages, mostly for troubleshooting.
 *
 * @param {Array<Stage>} stages
 */
const review = (stages) => {
    const cite = (references) => {
        return '\n' + references.map(reference => {
            const { position, url, title, snippet } = reference;
            return `${BLUE}[${position}]${NORMAL} ${BOLD}${title} ${GRAY}(${url})${NORMAL}\n${snippet}`;
        }).join('\n');
    };

    let buffer = 'Pipeline review:\n';
    console.log();
    console.log(`${MAGENTA}Pipeline review ${NORMAL}`);
    console.log('---------------');
    stages.map((stage, index) => {
        const { name, duration, timestamp, ...fields } = stage;
        console.log(`${GREEN}${ARROW} Stage #${index + 1} ${YELLOW}${name} ${GRAY}[${duration} ms]${NORMAL}`);
        buffer += `\nStage #${index + 1} ${name} [${duration} ms]\n`;
        Object.keys(fields).map((key) => {
            const value = fields[key];
            const str = (key === 'references') ? cite(value)
                : Array.isArray(value) ? JSON.stringify(value, null, 2) : value?.toString();
            console.log(`${GRAY}${key}: ${NORMAL}${str}`);
            buffer += `${key}: ${str}\n`;
        });
    });
    console.log();
    return buffer;
};

/**
 * Collapses every pair of stages (enter and leave) into one stage,
 * and compute its duration instead of invididual timestamps.
 *
 * @param {Array<object} stage
 * @returns {Array<object>}
 */
const simplify = (stages) => {
    const isOdd = (x) => {
        return x % 2 !== 0;
    };
    return stages
        .map((stage, index) => {
            if (isOdd(index)) {
                const before = stages[index - 1];
                const duration = stage.timestamp - before.timestamp;
                return { ...stage, duration };
            }
            return stage;
        })
        .filter((_, index) => isOdd(index));
};

/**
 * Converts an expected answer into a suitable regular expression array.
 *
 * @param {string} match
 * @returns {Array<RegExp>}
 */
const regexify = (match) => {
    const filler = (text, index) => {
        let i = index;
        while (i < text.length) {
            if (text[i] === '/') {
                break;
            }
            ++i;
        }
        return i;
    };

    const pattern = (text, index) => {
        let i = index;
        if (text[i] === '/') {
            ++i;
            while (i < text.length) {
                if (text[i] === '/' && text[i - 1] !== '\\') {
                    break;
                }
                ++i;
            }
        }
        return i;
    };

    const regexes = [];
    let pos = 0;
    while (pos < match.length) {
        pos = filler(match, pos);
        const next = pattern(match, pos);
        if (next > pos && next < match.length) {
            const sub = match.substring(pos + 1, next);
            const regex = RegExp(sub, 'gi');
            regexes.push(regex);
            pos = next + 1;
        } else {
            break;
        }
    }

    if (regexes.length === 0) {
        regexes.push(RegExp(match, 'gi'));
    }

    return regexes;
};

/**
 * Returns all possible matches given a list of regular expressions.
 *
 * @param {string} text
 * @param {Array<RegExp>} regexes
 * @returns {Array<Span>}
 */
const match = (text, regexes) => {
    return regexes
        .map((regex) => {
            const match = regex.exec(text);
            if (!match) {
                return null;
            }
            const [first] = match;
            const { index } = match;
            const { length } = first;
            return { index, length };
        })
        .filter((span) => span !== null);
};

/**
 * Formats the input (using ANSI colors) to highlight the spans.
 *
 * @param {string} text
 * @param {Array<Span>} spans
 * @param {string} color
 * @returns {string}
 */

const highlight = (text, spans, color = BOLD + GREEN) => {
    let result = text;
    spans
        .sort((p, q) => q.index - p.index)
        .forEach((span) => {
            const { index, length } = span;
            const prefix = result.substring(0, index);
            const content = result.substring(index, index + length);
            const suffix = result.substring(index + length);
            result = `${prefix}${color}${content}${NORMAL}${suffix}`;
        });

    let colored = '';
    const print = (text) => (colored += text);
    const cite = (citation) => `${GRAY}[${citation}]${NORMAL}`;
    let display = { buffer: '', refs: [], print, cite };
    for (let i = 0; i < result.length; ++i) {
        display = push(display, result[i]);
    }
    const refs = display.refs.slice();
    flush(display);

    return { colored, refs };
};

/**
 * Evaluates a test file and executes the test cases.
 *
 * @param {string} filename - The path to the test file.
 */
const evaluate = async (filename) => {
    try {
        let history = [];
        let total = 0;
        let failures = 0;

        const handle = async (line) => {
            const parts = line && line.length > 0 ? line.split(':') : [];
            if (parts.length >= 2) {
                const role = parts[0];
                const content = line.slice(role.length + 1).trim();
                if (role === 'Story') {
                    console.log();
                    console.log('-----------------------------------');
                    console.log(`Story: ${MAGENTA}${BOLD}${content}${NORMAL}`);
                    console.log('-----------------------------------');
                    history = [];
                } else if (role === 'User') {
                    const inquiry = content;
                    const stages = [];
                    const enter = (name) => {
                        stages.push({ name, timestamp: Date.now() });
                    };
                    const leave = (name, fields) => {
                        stages.push({ name, timestamp: Date.now(), ...fields });
                    };
                    const delegates = { enter, leave };
                    const context = { inquiry, history, delegates };
                    console.log();
                    process.stdout.write(`  ${inquiry}\r`);
                    const start = Date.now();
                    const pipeline = pipe(reason, search, respond);
                    const result = await pipeline(context);
                    const duration = Date.now() - start;
                    const { topic, language, thought, keyphrases, references, answer } = result;
                    history.push({
                        inquiry,
                        thought,
                        keyphrases,
                        topic,
                        language,
                        references,
                        answer,
                        duration,
                        stages
                    });
                    ++total;
                } else if (role === 'Assistant') {
                    const expected = content;
                    const last = history.slice(-1).pop();
                    if (!last) {
                        console.error('There is no answer yet!');
                        process.exit(-1);
                    } else {
                        const { inquiry, answer, duration, references, stages } = last;
                        const target = answer;
                        const regexes = regexify(expected);
                        const matches = match(target, regexes);
                        if (matches.length === regexes.length) {
                            console.log(`${GREEN}${CHECK} ${CYAN}${inquiry} ${GRAY}[${duration} ms]${NORMAL}`);
                            const { colored, refs } = highlight(target, matches);
                            console.log(' ', colored);
                            if (references && Array.isArray(references)) {
                                if (references.length > 0 && references.length >= refs.length) {
                                    refs.forEach((ref, i) => {
                                        const entry = references[ref - 1];
                                        if (entry && entry.url) {
                                            console.log(`  ${GRAY}[${i + 1}] ${entry.url}${NORMAL}`);
                                        }
                                    });
                                }
                            }
                            LLM_DEBUG_PIPELINE && review(simplify(stages));
                        } else {
                            ++failures;
                            console.error(`${RED}${CROSS} ${YELLOW}${inquiry} ${GRAY}[${duration} ms]${NORMAL}`);
                            console.error(`Expected ${role} to contain: ${CYAN}${regexes.join(',')}${NORMAL}`);
                            console.error(`Actual ${role}: ${MAGENTA}${target}${NORMAL}`);
                            review(simplify(stages));
                            LLM_DEBUG_FAIL_EXIT && process.exit(-1);
                        }
                    }
                } else if (role === 'Pipeline.Reason.Keyphrases' || role === 'Pipeline.Reason.Language') {
                    const expected = content;
                    const last = history.slice(-1).pop();
                    if (!last) {
                        console.error('There is no answer yet!');
                        process.exit(-1);
                    } else {
                        const { keyphrases, language, stages } = last;
                        const target = role === 'Pipeline.Reason.Keyphrases' ? keyphrases : language;
                        const regexes = regexify(expected);
                        const matches = match(target, regexes);
                        if (matches.length === regexes.length) {
                            const { colored } = highlight(target, matches, GREEN);
                            console.log(`    ${ARROW} ${GRAY}${role}:`, colored);
                        } else {
                            ++failures;
                            console.error(`${RED}Expected ${role} to contain: ${CYAN}${regexes.join(',')}${NORMAL}`);
                            console.error(`${RED}Actual ${role}: ${MAGENTA}${target}${NORMAL}`);
                            review(simplify(stages));
                            LLM_DEBUG_FAIL_EXIT && process.exit(-1);
                        }
                    }
                } else {
                    console.error(`Unknown role: ${role}!`);
                    handle.exit(-1);
                }
            }
        };

        const trim = (input) => {
            const text = input.trim();
            const marker = text.indexOf('#');
            if (marker >= 0) {
                return text.substr(0, marker).trim();
            }
            return text;
        };

        const lines = fs.readFileSync(filename, 'utf-8').split('\n').map(trim);
        for (const i in lines) {
            await handle(lines[i]);
        }
        if (failures <= 0) {
            console.log(`${GREEN}${CHECK}${NORMAL} SUCCESS: ${GREEN}${total} test(s)${NORMAL}.`);
        } else {
            const count = `${GRAY}${total} test(s), ${RED}${failures} failure(s)`;
            console.log(`${RED}${CROSS}${NORMAL} FAIL: ${count}${NORMAL}.`);
            process.exit(-1);
        }
    } catch (e) {
        console.error('ERROR:', e.toString());
        process.exit(-1);
    }
};

const MAX_LOOKAHEAD = 3 * '[citation:x]'.length;

/**
 * Pushes the given text to the buffer and handles citation references.
 *
 * @param {Object} display - The display object.
 * @param {string} display.buffer - The buffer to push the text to.
 * @param {Array} display.refs - The array of citation references.
 * @param {Function} display.print - The function to print the output.
 * @param {Function} display.cite - The function to cite a reference.
 * @param {string} text - The text to push to the buffer.
 * @return {Object} The updated display object.
 */
const push = (display, text) => {
    let { buffer, refs, print, cite } = display;
    buffer += text;
    let match;
    const PATTERN = /[\[\()]citation[:\s](\d+)[\]\)]/gi;
    while ((match = PATTERN.exec(buffer)) !== null) {
        const number = match[1];
        const { index } = match;
        if (number >= '0' && number <= '9') {
            const num = parseInt(number, 10);
            if (refs.indexOf(num) < 0) {
                refs.push(num);
            }
            const citation = 1 + refs.indexOf(num);
            buffer = buffer.substr(0, index) + cite(citation) + buffer.substr(index + 12);
        }
    }
    if (buffer.length > MAX_LOOKAHEAD) {
        const output = buffer.substr(0, buffer.length - MAX_LOOKAHEAD);
        print && print(output);
        buffer = buffer.substr(buffer.length - MAX_LOOKAHEAD);
    }
    return { buffer, refs, print, cite };
};

/**
 * Flushes the buffer and resets the display object.
 *
 * @param {Object} display - The display object.
 * @param {string} display.buffer - The buffer to flush.
 * @param {Array} display.refs - The array of citation references.
 * @param {Function} display.print - The function to print the output.
 * @param {Function} display.cite - The function to cite a reference.
 * @return {Object} The updated display object with an empty buffer and empty reference array.
 */
const flush = (display) => {
    const { buffer, print, cite } = display;
    print && print(buffer.trimEnd());
    return { buffer: '', refs: [], print, cite };
};

/**
 * Interacts with the user in the terminal, asking for inquiries and providing answers.
 * The function uses readline to read user input and prints the output to the console.
 * The interaction is looped until the user closes the input stream.
 * The user can reset the history or review the last interaction.
 */
const interact = async () => {
    const print = (text) => process.stdout.write(text);
    const cite = (citation) => `${GRAY}[${citation}]${NORMAL}`;
    let display = { buffer: '', refs: [], print, cite };

    let history = [];

    let loop = true;
    const io = readline.createInterface({ input: process.stdin, output: process.stdout });
    io.on('close', () => {
        loop = false;
    });
    console.log();

    let asr = null;

    const prepare = async () => {
        asr = listen(async (text) => {
            console.log(text);
            await answer(text);
            process.stdout.write(`${YELLOW}>> ${CYAN} ***`);
            loop && setImmediate(setup);
        });
        return asr;
    };

    const answer = async (inquiry) => {
        process.stdout.write(NORMAL);
        if (asr) {
            try {
                asr.kill();
            } catch (e) { }
        }

        if (inquiry === '!reset' || inquiry === '/reset') {
            history = [];
            console.log('History cleared.');
            console.log();
        } else if (inquiry === '!review' || inquiry === '/review') {
            const last = history.slice(-1).pop();
            if (!last) {
                console.log('Nothing to review yet!');
                console.log();
            } else {
                const { stages } = last;
                review(simplify(stages));
            }
        } else {
            const stages = [];
            const update = (stage, fields) => {
                if (stage === 'Reason') {
                    const { keyphrases } = fields;
                    if (keyphrases && keyphrases.length > 0) {
                        console.log(`${GRAY}${ARROW} Searching for ${keyphrases}...${NORMAL}`);
                    }
                }
            };

            const stream = (text) => (display = push(display, text));
            const enter = (name) => {
                stages.push({ name, timestamp: Date.now() });
            };
            const leave = (name, fields) => {
                update(name, fields);
                stages.push({ name, timestamp: Date.now(), ...fields });
            };
            const delegates = { stream, enter, leave };
            const context = { inquiry, history, delegates };
            const start = Date.now();
            const pipeline = pipe(reason, search, respond);
            const result = await pipeline(context);
            const refs = display.refs.slice();
            display = flush(display);
            const { topic, thought, keyphrases } = result;
            const duration = Date.now() - start;
            const { answer, language, references } = result;
            const tts = speak(answer, iso6391(language) || 'en');
            if (tts) {
                tts.speaker.on('exit', prepare);
            } else {
                prepare();
            }
            if (references && Array.isArray(references)) {
                if (references.length > 0 && references.length >= refs.length) {
                    console.log();
                    console.log();
                    refs.forEach((ref, i) => {
                        const entry = references[ref - 1];
                        if (entry && entry.url) {
                            console.log(`[${i + 1}] ${GRAY}${entry.url}${NORMAL}`);
                        }
                    });
                }
            }
            history.push({ inquiry, thought, keyphrases, topic, answer, duration, stages });
            console.log();
        }
    };

    const qa = () => {
        io.question(`${YELLOW}>> ${CYAN}`, async (inquiry) => {
            await answer(inquiry);
            loop && setImmediate(setup);
        });
    };

    const setup = () => {
        qa();
        if (!asr) {
            prepare();
        }
    };

    setup();
};

/**
 * Starts an HTTP server that listens on the specified port and serves requests.
 *
 * @param {number} port - The port number to listen on.
 */
const serve = async (port) => {
    let history = [];

    const decode = (url) => {
        const parsedUrl = new URL(`http://localhost/${url}`);
        const { search } = parsedUrl;
        return decodeURIComponent(search.substring(1)).trim();
    };

    const server = http.createServer(async (request, response) => {
        const { url } = request;
        if (url === '/health') {
            response.writeHead(200).end('OK');
        } else if (url === '/' || url === '/index.html') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(fs.readFileSync('./index.html'));
        } else if (url.startsWith('/chat')) {
            const inquiry = decode(url);
            if (inquiry === '/reset') {
                history = [];
                response.write('History cleared.');
                response.end();
            } else if (inquiry === '/review') {
                const last = history.slice(-1).pop();
                if (!last) {
                    response.write('Nothing to review yet!');
                } else {
                    const { stages } = last;
                    response.write(review(simplify(stages)));
                }
                response.end();
            } else if (inquiry.length > 0) {
                console.log(`${YELLOW}>> ${CYAN}${inquiry}${NORMAL}`);
                response.writeHead(200, { 'Content-Type': 'text/plain' });

                const print = (text) => {
                    process.stdout.write(text);
                    response.write(text);
                };
                const cite = (citation) => `[${citation}]`;
                let display = { buffer: '', refs: [], print, cite };

                const stages = [];
                const enter = (name) => {
                    stages.push({ name, timestamp: Date.now() });
                };
                const leave = (name, fields) => {
                    stages.push({ name, timestamp: Date.now(), ...fields });
                };
                const stream = (text) => (display = push(display, text));
                const delegates = { enter, leave, stream };
                const context = { inquiry, history, delegates };
                const start = Date.now();
                const pipeline = pipe(reason, search, respond);
                const { topic, thought, keyphrases, answer, references } = await pipeline(context);
                const refs = display.refs.slice();
                flush(display);
                console.log();
                if (references && Array.isArray(references) && references.length >= refs.length) {
                    response.write('\n\n');
                    console.log();
                    refs.forEach((ref, i) => {
                        const entry = references[ref - 1];
                        if (entry && entry.url) {
                            response.write(`[${i + 1}] ${entry.url}\n`);
                            console.log(`[${i + 1}] ${entry.url}`);
                        }
                    });
                }
                response.end();
                const duration = Date.now() - start;
                history.push({ inquiry, thought, keyphrases, topic, answer, duration, stages });
            } else {
                response.writeHead(400).end();
            }
        } else {
            console.error(`${url} is 404!`);
            response.writeHead(404);
            response.end();
        }
    });
    server.listen(port);
    console.log('Listening on port', port);
};

/**
 * Asynchronously polls the Telegram API for updates and processes them.
 */
const poll = async () => {
    let state = {};

    /**
     * Formats the given answer by replacing citation references with formatted citations.
     *
     * @param {string} answer - The answer to format.
     * @param {Array} references - The array of references.
     * @return {string} The formatted answer with citations.
     */
    const format = (answer, references) => {
        let buffer = answer;
        let refs = [];

        while (true) {
            const index = buffer.indexOf('[citation:');
            if (index < 0) {
                break;
            }
            const number = buffer[index + 10];
            if (number >= '0' && number <= '9') {
                const num = parseInt(number, 10);
                if (refs.indexOf(num) < 0) {
                    refs.push(num);
                }
                const citation = 1 + refs.indexOf(num);
                buffer = buffer.substr(0, index) + `[${citation}]` + buffer.substr(index + 12);
            }
        }

        if (references && Array.isArray(references) && references.length >= refs.length) {
            buffer += '\n\nReferences:\n';
            refs.forEach((ref, i) => {
                const entry = references[ref - 1];
                if (entry && entry.url) {
                    buffer += `[${i + 1}] ${entry.url}\n`;
                }
            });
        }
        return buffer;
    };

    /**
     * Checks for updates from the Telegram API and processes incoming messages.
     *
     * @param {number} offset - The offset from which to start fetching updates.
     * @return {Promise<void>} A promise that resolves when the function completes.
     */
    const check = async (offset) => {
        const POLL_URL = `https://api.telegram.org/bot${GAMAL_TELEGRAM_TOKEN}/getUpdates?offset=${offset}`;
        const SEND_URL = `https://api.telegram.org/bot${GAMAL_TELEGRAM_TOKEN}/sendMessage`;

        const send = async (id, message) => {
            try {
                await fetch(SEND_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        chat_id: id,
                        text: message
                    }),
                    signal: AbortSignal.timeout(5 * 1000) // 5 seconds
                });
            } catch (error) {
                console.error(`Unable to send message to ${id}: ${error}`);
            }
        };

        try {
            const response = await fetch(POLL_URL, {
                signal: AbortSignal.timeout(5 * 1000) // 5 seconds
            });
            if (!response.ok) {
                console.error(`Error: ${response.status} ${response.statusText}`);
            } else {
                const data = await response.json();
                const { result } = data;
                result.forEach(async (update) => {
                    const { message, update_id } = update;
                    const { text, chat } = message;
                    const history = state[chat.id] || [];
                    offset = update_id + 1;
                    if (text === '/reset') {
                        state[chat.id] = [];
                        send(chat.id, 'History cleared.');
                    } else if (text === '/review') {
                        const last = history.slice(-1).pop();
                        if (!last) {
                            send(chat.id, 'Nothing to review yet!');
                        } else {
                            const { stages } = last;
                            send(chat.id, review(simplify(stages)));
                        }
                    } else {
                        const stages = [];
                        const enter = (name) => {
                            stages.push({ name, timestamp: Date.now() });
                        };
                        const leave = (name, fields) => {
                            stages.push({ name, timestamp: Date.now(), ...fields });
                        };
                        const delegates = { enter, leave };
                        const inquiry = text;
                        console.log(`${YELLOW}>> ${CYAN}${inquiry}${NORMAL}`);
                        const context = { inquiry, history, delegates };
                        const start = Date.now();
                        const pipeline = pipe(reason, search, respond);
                        const result = await pipeline(context);
                        const duration = Date.now() - start;
                        const { topic, thought, keyphrases, references, answer } = result;
                        console.log(answer);
                        console.log();
                        history.push({ inquiry, thought, keyphrases, topic, references, answer, duration, stages });
                        state[chat.id] = history;
                        send(chat.id, format(answer, references));
                    }
                });
            }
        } catch (error) {
            console.error(`Failed to get Telegram updates: ${error}`);
        } finally {
            setTimeout(() => {
                check(offset);
            }, 200);
        }
    };

    check(0);
};

/**
 * Runs a canary test to ensure that the configured LLM service is ready and
 * terminates the process if it is not.
 */
const canary = async () => {
    console.log(`Using SearXNG at ${MAGENTA}${SEARXNG_URL}${NORMAL}.`);
    console.log(`Using LLM at ${LLM_API_BASE_URL} (model: ${GREEN}${LLM_CHAT_MODEL || 'default'}${NORMAL}).`);
    process.stdout.write(`${ARROW} Checking LLM...\r`);
    const messages = [];
    messages.push({ role: 'system', content: 'Answer concisely.' });
    messages.push({ role: 'user', content: 'What is the capital of France?' });
    try {
        await chat(messages);
        console.log(`LLM is ${GREEN}ready${NORMAL} (working as expected).`);
    } catch (error) {
        console.error(`${CROSS} ${RED}Fatal error: LLM is not ready!${NORMAL}`);
        console.error(error);
        process.exit(-1);
    }
};

(async () => {
    await canary();

    const args = process.argv.slice(2);
    args.forEach(evaluate);
    if (args.length == 0) {
        const port = parseInt(GAMAL_HTTP_PORT, 10);
        if (!Number.isNaN(port) && port > 0 && port < 65536) {
            await serve(port);
        } else if (GAMAL_TELEGRAM_TOKEN && GAMAL_TELEGRAM_TOKEN.length >= 40) {
            console.log('Running as a Telegram bot...');
            await poll();
        } else {
            await interact();
        }
    }
})();
