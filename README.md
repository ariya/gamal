# Gamal

Gamal is a simple, zero-dependency tool designed to quickly provide answers to questions. It finds relevant web pages and uses an LLM to summarize the content, delivering concise answers.  Gamal is accessible via the terminal (as a CLI tool), through its minimalist web interface, or as a Telegram bot.

[![asciicast](https://asciinema.org/a/668554.svg)](https://asciinema.org/a/668554)

Gamal utilizes [SearXNG](https://searxng.org) for web searches and requires an LLM to generate responses based on search results. By default, Gamal integrates with [OpenRouter](https://openrouter.ai) as its LLM service, requiring the configuration of an API key in the `LLM_API_KEY` environment variable. Please continue reading for detailed instructions on configuring Gamal to use either a local LLM ([llama.cpp](https://github.com/ggerganov/llama.cpp), [Jan](https://jan.ai), and [Ollama](https://ollama.com)) or other managed LLM services (offering over half a dozen options, including [OpenAI](https://platform.openai.com), [Fireworks](https://fireworks.ai), and [Groq](https://groq.com)).

To execute Gamal as a CLI tool, run it with [Node.js](https://nodejs.org) (version >= 18) or [Bun](https://bun.sh):

```bash
./gamal.js
```

For instant answers, pipe the questions directly into Gamal:

```bash
echo "List 5 Indonesia's best travel destinations" | ./gamal.js
```

Gamal also includes a minimalist front-end web interface. To launch it, specify the environment variable `GAMAL_HTTP_PORT`, for example:

```bash
GAMAL_HTTP_PORT=5000 ./gamal.js
```

Then, open a web browser and go to `localhost:5000`.

Gamal is capable of functioning as a [Telegram bot](https://core.telegram.org/bots). Obtain a token (refer to [Telegram documentation](https://core.telegram.org/bots/tutorial#obtain-your-bot-token) for details) and set it as the environment variable `GAMAL_TELEGRAM_TOKEN` before launching Gamal. Note that conversation history in Telegram chats is stored in memory and not persisted to disk.

## Multi-language Support

Gamal can converse in many languages besides English. It always tries to respond in the same language as the question. You can freely switch languages between questions, as shown in the following example:

```
>> Which planet in our solar system is the biggest?
Jupiter is the largest planet in our solar system [1].
[1] https://science.nasa.gov/jupiter/

>> ¿Y el más caliente?
Venus es el planeta más caliente, con hasta 475°C. [1].
[1] https://www.redastronomy.com/sistema-solar/el-planeta-venus/
```

Gamal's continuous integration workflows include evaluation tests in English, Spanish, German, French, and Indonesian.

[![English tests](https://github.com/ariya/gamal/actions/workflows/english.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/english.yml)
[![Spanish tests](https://github.com/ariya/gamal/actions/workflows/spanish.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/spanish.yml)
[![French tests](https://github.com/ariya/gamal/actions/workflows/french.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/french.yml)
[![German tests](https://github.com/ariya/gamal/actions/workflows/german.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/german.yml)
[![Indonesian tests](https://github.com/ariya/gamal/actions/workflows/indonesian.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/indonesian.yml)
[![Language switch](https://github.com/ariya/gamal/actions/workflows/lang-switch.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/lang-switch.yml)

## Using Other LLM Services

Gamal is designed to be used with OpenRouter by default, but it can also be configured to work with other LLM services by adjusting some environment variables. The correct API key and a suitable model are required.

Compatible LLM services include [Anyscale](https://www.anyscale.com), [Deep Infra](https://deepinfra.com), [Fireworks](https://fireworks.ai), [Groq](https://groq.com), [Lepton](https://lepton.ai), [Novita](https://novita.ai), [Octo](https://octo.ai), [OpenAI](https://platform.openai.com), and [Together](https://www.together.ai).

[![Test on DeepInfra](https://github.com/ariya/gamal/actions/workflows/test-deepinfra.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/test-deepinfra.yml)
[![Test on Groq](https://github.com/ariya/gamal/actions/workflows/test-groq.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/test-groq.yml)
[![Test on Lepton](https://github.com/ariya/gamal/actions/workflows/test-lepton.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/test-lepton.yml)
[![Test on OpenAI](https://github.com/ariya/gamal/actions/workflows/test-openai.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/test-openai.yml)
[![Test on Together](https://github.com/ariya/gamal/actions/workflows/test-together.yml/badge.svg)](https://github.com/ariya/gamal/actions/workflows/test-together.yml)

Refer to the relevant section for configuration details. The example provided is for Llama-3 8B, though any LLM with 7B parameters should also work, such as Mistral 7B, Qwen-2 7B, or Gemma-2 9B.

<details><summary>Anyscale</summary>

```bash
export LLM_API_BASE_URL=https://api.endpoints.anyscale.com/v1
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="meta-llama/Llama-3-8b-chat-hf"
```
</details>

<details><summary>Deep Infra</summary>

```bash
export LLM_API_BASE_URL=https://api.deepinfra.com/v1/openai
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="meta-llama/Meta-Llama-3-8B-Instruct"
```
</details>

<details><summary>Fireworks</summary>

```bash
export LLM_API_BASE_URL=https://api.fireworks.ai/inference/v1
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="accounts/fireworks/models/llama-v3-8b-instruct"
```
</details>

<details><summary>Groq</summary>

```bash
export LLM_API_BASE_URL=https://api.groq.com/openai/v1
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="llama3-8b-8192"
```
</details>

<details><summary>Lepton</summary>

```bash
export LLM_API_BASE_URL=https://llama3-1-8b.lepton.run/api/v1
export LLM_API_KEY="yourownapikey"
```
</details>

<details><summary>Novita</summary>

```bash
export LLM_API_BASE_URL=https://api.novita.ai/v3/openai
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="meta-llama/llama-3-8b-instruct"
```
</details>

<details><summary>Octo</summary>

```bash
export LLM_API_BASE_URL=https://text.octoai.run/v1/
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="meta-llama-3-8b-instruct"
```
</details>

<details><summary>OpenAI</summary>

```bash
export LLM_API_BASE_URL=https://api.openai.com/v1
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="gpt-4o-mini"
```
</details>

<details><summary>Together</summary>

```bash
export LLM_API_BASE_URL=https://api.together.xyz/v1
export LLM_API_KEY="yourownapikey"
export LLM_CHAT_MODEL="meta-llama/Llama-3-8b-chat-hf"
```
</details>


## Using Local LLM Servers

Gamal is compatible with local LLM inference tools such as [llama.cpp](https://github.com/ggerganov/llama.cpp), [Jan](https://jan.ai), and [Ollama](https://ollama.com). Refer to the relevant section for configuration details.

The example provided uses Llama-3 8B. For optimal performance, an instruction-following LLM with 7B parameters or more is recommended. Suitable models include Mistral 7B, Qwen-2 7B, and Gemma-2 9B.

<details><summary>llama.cpp</summary>

First, load a quantized model such as [Llama-3 8B](https://huggingface.co/QuantFactory/Meta-Llama-3-8B-Instruct-GGUF). Then, adjust the `LLM_API_BASE_URL` environment variable accordingly:

```bash
/path/to/llama-server -m Meta-Llama-3-8B-Instruct.Q4_K_M.gguf
export LLM_API_BASE_URL=http://127.0.0.1:8080/v1
```
</details>

<details><summary>Jan</summary>

Refer to [the documentation](https://jan.ai/docs/local-api) and load a model like [Llama-3 8B](https://huggingface.co/QuantFactory/Meta-Llama-3-8B-Instruct-GGUF). Then, set the environment variable:

```bash
export LLM_API_BASE_URL=http://127.0.0.1:1337/v1
export LLM_CHAT_MODEL='llama3-8b-instruct'
```
</details>

<details><summary>Ollama</summary>

Load a model and configure the environment variables:

```bash
ollama pull llama3
export LLM_API_BASE_URL=http://127.0.0.1:11434/v1
export LLM_CHAT_MODEL='llama3'
```
</details>


## Evaluating Questions

Gamal includes a built-in evaluation tool. For instance, if a text file named `qa.txt` contains pairs of `User` and `Assistant` messages:

```
User: Which planet is the largest?
Assistant: The largest planet is /Jupiter/.

User: and the smallest?
Assistant: The smallest planet is /Mercury/.
```

executing the following command will sequentially search for these questions and verify the answers using regular expressions:
```bash
./gamal.js qa.txt
```

Additional examples can be found in the `tests/` subdirectory.

Two environment variables can modify the behavior:

* `LLM_DEBUG_FAIL_EXIT`: When set, Gamal will exit immediately upon encountering an incorrect answer, and subsequent questions in the file will not be processed.

* `LLM_DEBUG_PIPELINE`: When set, if the expected regular expression does not match the answer, the internal LLM pipeline will be printed to stdout.


## Improving Search Quality

By default, Gamal utilizes the [public SearXNG instance](https://searx.space/) at `searx.work`. To switch to a different SearXNG instance, such as a private one capable of searching additional custom data sources, configure the URL using the `SEARXNG_URL` environment variable.

For more frequent searches, obtain an API key for [JINA reader](https://jina.ai/reader/) (its free tier is generous) and set it as `JINA_API_KEY`. This will increase the rate limit from 20 requests per minute to 200 requests per minute.

To leverage the [Brave Search API](https://brave.com/search/api), a paid search API offering a free trial, acquire the API key and store it as the `BRAVE_SEARCH_API_KEY` environment variable. With this key configured, Gamal will prioritize Brave Search over SearXNG.