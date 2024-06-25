#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');

const LLM_API_BASE_URL = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL;
const LLM_STREAMING = process.env.LLM_STREAMING !== 'no';

const LLM_ZERO_SHOT = process.env.LLM_ZERO_SHOT;
const LLM_DEBUG_CHAT = process.env.LLM_DEBUG_CHAT;
const LLM_DEBUG_PIPELINE = process.env.LLM_DEBUG_PIPELINE;
const LLM_DEBUG_FAIL_EXIT = process.env.LLM_DEBUG_FAIL_EXIT;

const NORMAL = '\x1b[0m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[93m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[91m';
const GREEN = '\x1b[92m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const ARROW = '⇢';
const CHECK = '✓';
const CROSS = '✘';

/**
 * Creates a new function by chaining multiple async functions from left to right.
 *
 * @param  {...any} fns - Functions to chain
 * @returns {function}
 */
const pipe = (...fns) => arg => fns.reduce((d, fn) => d.then(fn), Promise.resolve(arg));


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
 * @param {CompletionHandler=} handler - An optional callback to stream the completion.
 * @returns {Promise<string>} The completion generated by the LLM.
 */

const chat = async (messages, handler) => {
    const url = `${LLM_API_BASE_URL}/chat/completions`;
    const auth = LLM_API_KEY ? { 'Authorization': `Bearer ${LLM_API_KEY}` } : {};
    const model = LLM_CHAT_MODEL || 'gpt-3.5-turbo';
    const stop = ['<|im_end|>', '<|end|>', '<|eot_id|>', '<|end_of_turn|>', 'INQUIRY: '];;
    const max_tokens = 400;
    const temperature = 0;
    const stream = LLM_STREAMING && typeof handler === 'function';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ messages, model, stop, max_tokens, temperature, stream })
    });
    if (!response.ok) {
        throw new Error(`HTTP error with the status: ${response.status} ${response.statusText}`);
    }

    LLM_DEBUG_CHAT && messages.forEach(({ role, content }) => {
        console.log(`${MAGENTA}${role}:${NORMAL} ${content}`);
    });

    if (!stream) {
        const data = await response.json();
        const { choices } = data;
        const first = choices[0];
        const { message } = first;
        const { content } = message;
        const answer = content.trim();
        handler && handler(answer);
        LLM_DEBUG_CHAT && console.log(`${YELLOW}${answer}${NORMAL}`);
        return answer;
    }

    const parse = (line) => {
        let partial = null;
        const prefix = line.substring(0, 6);
        if (prefix === 'data: ') {
            const payload = line.substring(6);
            try {
                const { choices } = JSON.parse(payload);
                const [choice] = choices;
                const { delta } = choice;
                partial = delta?.content;
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
                const partial = parse(line);
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
}


/**
 * Replies to the user. This is zero-shot style.
 *
 * @param {Context} context - Current pipeline context.
 * @returns {Context} Updated pipeline context.
 */

const REPLY_PROMPT = `You are a helpful answering assistant.
Your task is to reply and respond to the user politely and concisely.
Answer in plain text and not in Markdown format.`;

const reply = async (context) => {
    const { inquiry, history, delegates } = context;
    const { enter, leave, stream } = delegates;
    enter && enter('Reply');

    const messages = [];
    messages.push({ role: 'system', content: REPLY_PROMPT });
    const relevant = history.slice(-5);
    relevant.forEach(msg => {
        const { inquiry, answer } = msg;
        messages.push({ role: 'user', content: inquiry });
        messages.push({ role: 'assistant', content: answer });
    });

    messages.push({ role: 'user', content: inquiry });
    const answer = await chat(messages, stream);

    leave && leave('Reply', { inquiry, answer });
    return { answer, ...context };
}

const PREDEFINED_KEYS = ['INQUIRY', 'TOOL', 'THOUGHT', 'KEYPHRASES', 'OBSERVATION', 'TOPIC'];

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
        parts[anchor.toLowerCase()] = text.substring(start).replace(anchor + ':', '').trim();
        let str = text.substring(0, start);
        for (let i = 0; i < keys.length; ++i) {
            const marker = keys[i];
            const pos = str.lastIndexOf(marker + ':');
            if (pos >= 0) {
                const substr = str.substr(pos + marker.length + 1).trim();
                const value = substr.split('\n').shift();
                str = str.slice(0, pos);
                const key = marker.toLowerCase();
                parts[key] = value;
            }
        }
    }
    return parts;
}

/**
 * Constructs a multi-line text based on a number of key-value pairs.
 *
 * @param {Object} key-value pairs
 * @return {text}
 */
const construct = (kv) => {
    return PREDEFINED_KEYS.filter(key => kv[key.toLowerCase()]).map(key => {
        const value = kv[key.toLowerCase()];
        if (value && value.length > 0) {
            return `${key.toUpperCase()}: ${value}`;
        }
        return null;
    }).join('\n');
}

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

const REASON_PROMPT = `Use Google to search for the answer.
Think step by step. Always output your thought in the following format:

TOOL: the search engine to use (must be Google).
THOUGHT: describe your thoughts about the inquiry.
KEYPHRASES:  the important key phrases to search for.
OBSERVATION: the concise result of the search tool.
TOPIC: the specific topic covering the inquiry.`;

const REASON_EXAMPLE = `

# Example

Given an inquiry "What is Pitch Lake in Trinidad famous for?", you will output:

TOOL: Google.
THOUGHT: This is about geography, I will use Google search.
KEYPHRASES: Pitch Lake in Trinidad fame.
OBSERVATION: Pitch Lake in Trinidad is the largest natural deposit of asphalt.
TOPIC: geography.`;

const reason = async (context) => {
    const { history, delegates } = context;
    const { enter, leave } = delegates;
    enter && enter('Reason');

    const relevant = history.slice(-3);
    let prompt = REASON_PROMPT;
    if (relevant.length === 0) {
        prompt += REASON_EXAMPLE;
    }

    const messages = [];
    messages.push({ role: 'system', content: prompt });
    relevant.forEach(msg => {
        const { inquiry, topic, thought, keyphrases, answer } = msg;
        const observation = answer;
        messages.push({ role: 'user', content: inquiry });
        const assistant = construct({ tool: 'Google.', thought, keyphrases, observation, topic });
        messages.push({ role: 'assistant', content: assistant });
    });

    const { inquiry } = context;
    messages.push({ role: 'user', content: inquiry });
    const hint = ['TOOL: Google.', 'THOUGHT: '].join('\n');
    messages.push({ role: 'assistant', content: hint });
    const completion = await chat(messages);
    let result = deconstruct(hint + completion);
    if (!result.observation) {
        result = deconstruct(hint + completion + '\n' + 'TOPIC: general knowledge.');
    }
    const { topic, thought, keyphrases, observation } = result;
    leave && leave('Reason', { topic, thought, keyphrases, observation });
    return { topic, thought, keyphrases, observation, ...context };
}

/**
 * Responds to the user's recent message using an LLM.
 * The response from the LLM is available as `answer` in the updated context.
 *
 * @param {Context} context - Current pipeline context.
 * @returns {Context} Updated pipeline context.
 */

const RESPOND_PROMPT = `You are an assistant for question-answering tasks.
You are digesting the most recent user's inquiry, thought, and observation.
Your task is to use the observation to answer the inquiry politely and concisely.
You may need to refer to the user's conversation history to understand some context.
There is no need to mention "based on the observation" or "based on the previous conversation" in your answer.
Your answer is in simple English, and at max 3 sentences.
Do not make any apology or other commentary.
Do not use other sources of information, including your memory.
Do not make up new names or come up with new facts.`;

const respond = async (context) => {
    const { history, delegates } = context;
    const { enter, leave, stream } = delegates;
    enter && enter('Respond');

    let prompt = RESPOND_PROMPT;
    const relevant = history.slice(-2);
    if (relevant.length > 0) {
        prompt += '\n';
        prompt += '\n';
        prompt += 'For your reference, you and the user have the following Q&A discussion:\n';
        relevant.forEach(msg => {
            const { inquiry, answer } = msg;
            prompt += `* ${inquiry} ${answer}\n`;
        });
    }

    const messages = [];
    messages.push({ role: 'system', content: prompt });
    const { inquiry, thought, observation } = context;
    messages.push({ role: 'user', content: construct({ inquiry, thought, observation }) });
    messages.push({ role: 'assistant', content: 'ANSWER: ' });
    const answer = await chat(messages, stream);

    leave && leave('Respond', { inquiry, thought, observation, answer });
    return { answer, ...context };
}

/**
 * Prints the pipeline stages, mostly for troubleshooting.
 *
 * @param {Array<Stage>} stages
 */
const review = (stages) => {
    console.log();
    console.log(`${MAGENTA}Pipeline review ${NORMAL}`);
    console.log('---------------');
    stages.map((stage, index) => {
        const { name, duration, timestamp, ...fields } = stage;
        console.log(`${GREEN}${ARROW} Stage #${index + 1} ${YELLOW}${name} ${GRAY}[${duration} ms]${NORMAL}`);
        Object.keys(fields).map(key => {
            console.log(`${GRAY}${key}: ${NORMAL}${fields[key]}`);
        });
    });
    console.log();
}

/**
 * Collapses every pair of stages (enter and leave) into one stage,
 * and compute its duration instead of invididual timestamps.
 *
 * @param {Array<object} stage
 * @returns {Array<object>}
 */
const simplify = (stages) => {
    const isOdd = (x) => { return (x % 2) !== 0 };
    return stages.map((stage, index) => {
        if (isOdd(index)) {
            const before = stages[index - 1];
            const duration = stage.timestamp - before.timestamp;
            return { ...stage, duration };
        }
        return stage;
    }).filter((_, index) => isOdd(index));
}

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
}

/**
 * Returns all possible matches given a list of regular expressions.
 *
 * @param {string} text
 * @param {Array<RegExp>} regexes
 * @returns {Array<Span>}
 */
const match = (text, regexes) => {
    return regexes.map(regex => {
        const match = regex.exec(text);
        if (!match) {
            return null;
        }
        const [first] = match;
        const { index } = match;
        const { length } = first;
        return { index, length };
    }).filter(span => span !== null);
}

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
    spans.sort((p, q) => q.index - p.index).forEach((span) => {
        const { index, length } = span;
        const prefix = result.substring(0, index);
        const content = result.substring(index, index + length);
        const suffix = result.substring(index + length);
        result = `${prefix}${color}${content}${NORMAL}${suffix}`;
    });
    return result;
}

/**
 * Evaluates a test file and executes the test cases.
 *
 * @param {string} filename - The path to the test file.
 */
const evaluate = async (filename) => {
    const identity = (x) => x;

    try {
        let history = [];
        let total = 0;
        let failures = 0;

        const handle = async (line) => {
            const parts = (line && line.length > 0) ? line.split(':') : [];
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
                    const enter = (name) => { stages.push({ name, timestamp: Date.now() }) };
                    const leave = (name, fields) => { stages.push({ name, timestamp: Date.now(), ...fields }) };
                    const delegates = { enter, leave };
                    const context = { inquiry, history, delegates };
                    process.stdout.write(`  ${inquiry}\r`);
                    const start = Date.now();
                    const pipeline = LLM_ZERO_SHOT ? reply : pipe(reason, respond);
                    const result = await pipeline(context);
                    const duration = Date.now() - start;
                    const { topic, thought, keyphrases, answer } = result;
                    history.push({ inquiry, thought, keyphrases, topic, answer, duration, stages });
                    ++total;
                } else if (role === 'Assistant') {
                    const expected = content;
                    const last = history.slice(-1).pop();
                    if (!last) {
                        console.error('There is no answer yet!');
                        process.exit(-1);
                    } else {
                        const { inquiry, answer, duration, stages } = last;
                        const target = answer;
                        const regexes = regexify(expected);
                        const matches = match(target, regexes);
                        if (matches.length === regexes.length) {
                            console.log(`${GREEN}${CHECK} ${CYAN}${inquiry} ${GRAY}[${duration} ms]${NORMAL}`);
                            console.log(' ', highlight(target, matches));
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
                } else if (role === 'Pipeline.Reason.Keyphrases' || role === 'Pipeline.Reason.Topic') {
                    const expected = content;
                    const last = history.slice(-1).pop();
                    if (!last) {
                        console.error('There is no answer yet!');
                        process.exit(-1);
                    } else {
                        const { keyphrases, topic, stages } = last;
                        const target = (role === 'Pipeline.Reason.Keyphrases') ? keyphrases : topic;
                        const regexes = regexify(expected);
                        const matches = match(target, regexes);
                        if (matches.length === regexes.length) {
                            console.log(`${GRAY}    ${ARROW} ${role}:`, highlight(target, matches, GREEN));
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
        }

        const lines = fs.readFileSync(filename, 'utf-8').split('\n').map(trim);
        for (const i in lines) {
            await handle(lines[i]);
        }
        if (failures <= 0) {
            console.log(`${GREEN}${CHECK}${NORMAL} SUCCESS: ${GREEN}${total} test(s)${NORMAL}.`);
        } else {
            console.log(`${RED}${CROSS}${NORMAL} FAIL: ${GRAY}${total} test(s), ${RED}${failures} failure(s)${NORMAL}.`);
            process.exit(-1);
        }
    } catch (e) {
        console.error('ERROR:', e.toString());
        process.exit(-1);
    }
}

const interact = async () => {
    const history = [];
    const stream = (text) => process.stdout.write(text);

    let loop = true;
    const io = readline.createInterface({ input: process.stdin, output: process.stdout });
    io.on('close', () => { loop = false; });

    const qa = () => {
        io.question(`${YELLOW}>> ${CYAN}`, async (inquiry) => {
            process.stdout.write(NORMAL);
            if (inquiry === '!review' || inquiry === '/review') {
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
                }
                const enter = (name) => { stages.push({ name, timestamp: Date.now() }) };
                const leave = (name, fields) => { update(name, fields); stages.push({ name, timestamp: Date.now(), ...fields }) };
                const delegates = { stream, enter, leave };
                const context = { inquiry, history, delegates };
                const start = Date.now();
                const pipeline = LLM_ZERO_SHOT ? reply : pipe(reason, respond);
                const result = await pipeline(context);
                const { topic, thought, keyphrases } = result;
                const duration = Date.now() - start;
                const { answer } = result;
                history.push({ inquiry, thought, keyphrases, topic, answer, duration, stages });
                console.log();
            }
            loop && qa();
        })
    }

    qa();
}


(async () => {
    console.log(`Using LLM at ${LLM_API_BASE_URL} (model: ${GREEN}${LLM_CHAT_MODEL || 'default'}${NORMAL}).`);

    const args = process.argv.slice(2);
    args.forEach(evaluate);
    if (args.length == 0) {
        await interact();
    }
})();
