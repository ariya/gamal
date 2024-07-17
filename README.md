# Gamal

Gamal is a simple, zero-dependency tool designed to quickly provide answers to questions. It finds relevant web pages and uses an LLM to summarize the content, delivering concise answers.  Gamal is accessible via the terminal (as a CLI tool), through its minimalist web interface, or as a Telegram bot.

[![asciicast](https://asciinema.org/a/668554.svg)](https://asciinema.org/a/668554)

To run Gamal, API keys for both [Brave Search API](https://brave.com/search/api/) and [OpenRouter](https://openrouter.ai) are required (both offer generous free credits). Store these keys as `BRAVE_SEARCH_API_KEY` and `LLM_API_KEY`, respectively. Then use either [Node.js](https://nodejs.org) (>= v18) or [Bun](https://bun.sh) to run Gamal:

```bash
./gamal.js
```

For instant answers, you can pipe your questions directly into Gamal:
```bash
echo "List 5 Indonesia's best travel destinations" | ./gamal.js
```

Gamal is also compatible with local LLM inference tools such as [llama.cpp](https://github.com/ggerganov/llama.cpp), [Jan](https://jan.ai), [Ollama](https://ollama.com), and [LocalAI](https://localai.io). For instructions on how to set up the environment variables for these services, please refer to the documentation of the sister project, [Ask LLM](https://github.com/ariya/ask-llm?tab=readme-ov-file#using-local-llm-servers). For optimal performance, it is recommended to use an instruction-following LLM with 7B parameters or more, such as Mistral 7B, Qwen-2 7B, Llama-3 8B, Gemma-2 9B, etc.

Gamal also includes a minimalist front-end web interface. To launch it, specify the environment variable `GAMAL_HTTP_PORT`, for example:
```bash
GAMAL_HTTP_PORT=5000 ./gamal.js
```
Then, open a web browser and go to `localhost:5000`.

Gamal is capable of functioning as a [Telegram bot](https://core.telegram.org/bots). Obtain a token (refer to [Telegram documentation](https://core.telegram.org/bots/tutorial#obtain-your-bot-token) for details) and set it as the environment variable `GAMAL_TELEGRAM_TOKEN` before launching Gamal. Note that conversation history in Telegram chats is stored in memory and not persisted to disk.