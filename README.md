# Gamal

Gamal is a simple, zero-dependency tool designed to quickly provide answers to questions. It finds relevant web pages and uses an LLM to summarize the content, delivering concise answers.  Gamal is accessible via the terminal (as a CLI tool), through its minimalist web interface, or as a Telegram bot.

To run Gamal, API keys for both [You.com](https://you.com) and [OpenRouter](https://openrouter.ai) are required (both offer generous free credits). Store these keys as `YOU_API_KEY` and `LLM_API_KEY`, respectively. Then use either [Node.js](https://nodejs.org) (>= v18) or [Bun](https://bun.sh) to run Gamal:

```bash
./gamal.js
```

For instant answers, you can pipe your questions directly into Gamal:
```bash
echo "List 5 Indonesia's best travel destinations" | ./gamal.js
```

Gamal is also compatible with local LLM inference tools such as [llama.cpp](https://github.com/ggerganov/llama.cpp), [Jan](https://jan.ai), [Ollama](https://ollama.com), and [LocalAI](https://localai.io). For instructions on how to set up the environment variables for these services, please refer to the documentation of the project, [Ask LLM](https://github.com/ariya/ask-llm?tab=readme-ov-file#using-local-llm-servers). For the best results, it is recommended to use an LLM with 7B parameters or more.

If the `GAMAL_HTTP_PORT` environment variable is specified, Gamal can be accessed through its minimalist front-end web interface. For example:
```bash
GAMAL_HTTP_PORT=5000 ./gamal.js
```
Then, open a web browser and navigate to `localhost:5000`.

If the `GAMAL_TELEGRAM_TOKEN` environment variable is provided (refer to [Telegram documentation](https://core.telegram.org/bots/tutorial#obtain-your-bot-token) for more details), Gamal functions as a [Telegram bot](https://core.telegram.org/bots). lease note that the conversation history in the Telegram chats is stored in memory and not persisted to disk.
