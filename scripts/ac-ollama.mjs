// Thin Ollama JSON client for AC analyst tasks (no resume text generation).

import http from "node:http";

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
export const DEFAULT_MODEL = "gemma4:12b";

export function ollamaChat({ model = DEFAULT_MODEL, system, user, schema, numPredict = 2048, temperature = 0.1 }) {
  return new Promise((resolve, reject) => {
    const payload = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      think: false,
      format: schema,
      options: {
        temperature,
        num_predict: numPredict,
        num_ctx: 16384,
      },
      keep_alive: "10m",
    };
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.setTimeout(0);
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString();
            if (res.statusCode >= 400) {
              reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
              return;
            }
            const data = JSON.parse(raw);
            const content = data.message?.content || "";
            let parsed = null;
            let parseError = null;
            try {
              parsed = JSON.parse(content);
            } catch (error) {
              parseError = error.message;
            }
            resolve({
              model,
              content,
              parsed,
              parseError,
              doneReason: data.done_reason,
              evalCount: data.eval_count,
            });
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(0);
    req.write(body);
    req.end();
  });
}

export async function ollamaHealth(timeoutMs = 3000) {
  try {
    const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
