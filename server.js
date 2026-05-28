const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;

async function loadLocalEnv() {
  try {
    const env = await fs.readFile(path.join(ROOT, ".env"), "utf8");

    env.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (key && !process.env[key]) process.env[key] = value;
    });
  } catch {
    // .env is optional; production deployments should use real environment vars.
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function buildRealtimeInstructions(caseProfile, interviewPreamble) {
  const preamble =
    interviewPreamble ||
    "You are a forensic interview assistant helping a trained investigator collect details for one suspect composite.";

  return [
    preamble,
    "Required case context follows as JSON. Always treat this schema as the current shared source of truth for the active case.",
    "There is exactly one suspect in this case. Do not introduce additional suspects.",
    "Use witness answers to refine or confirm fields in this schema, and keep questions focused on missing or uncertain observable facial traits.",
    JSON.stringify(caseProfile, null, 2),
  ].join(" ");
}

async function handleRealtimeCall(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 500, { error: "OPENAI_API_KEY is not set for the local server." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const contentType = request.headers["content-type"] || "";
    const isJson = contentType.includes("application/json");
    const body = isJson ? JSON.parse(rawBody) : {};
    const headerCaseProfile = request.headers["x-case-profile"]
      ? JSON.parse(decodeURIComponent(request.headers["x-case-profile"]))
      : null;
    const headerPreamble = request.headers["x-interview-preamble"]
      ? decodeURIComponent(request.headers["x-interview-preamble"])
      : null;
    const sdp = isJson ? body.sdp : rawBody;

    if (!sdp) {
      sendJson(response, 400, { error: "Missing SDP offer in request body." });
      return;
    }

    const caseProfile = body.caseProfile || body.profile || headerCaseProfile || {};
    const interviewPreamble = body.interviewPreamble || headerPreamble;
    const session = {
      type: "realtime",
      model:
        caseProfile.interview?.voiceModel ||
        request.headers["x-voice-model"] ||
        "gpt-realtime",
      instructions: buildRealtimeInstructions(caseProfile, interviewPreamble),
      audio: {
        input: {
          noise_reduction: {
            type: "near_field",
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "en",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
          },
        },
        output: {
          voice: "marin",
        },
      },
    };

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(session));

    const openaiResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const responseText = await openaiResponse.text();

    if (!openaiResponse.ok) {
      console.error("OpenAI Realtime call failed", openaiResponse.status, responseText);
      sendJson(response, openaiResponse.status, {
        error: "OpenAI Realtime call failed.",
        status: openaiResponse.status,
        details: responseText || null,
      });
      return;
    }

    send(response, 201, responseText, "application/sdp; charset=utf-8");
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Failed to create Realtime call.",
    });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    send(response, 200, file, contentType);
  } catch {
    send(response, 404, "Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  console.log(`${request.method} ${requestUrl.pathname}`);

  if (requestUrl.pathname === "/api/realtime/call" && request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Voice-Model",
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }

  if (requestUrl.pathname === "/api/realtime/call" && request.method === "POST") {
    await handleRealtimeCall(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }

  sendJson(response, 405, {
    error: "Method not allowed.",
    method: request.method,
    path: requestUrl.pathname,
  });
});

loadLocalEnv().then(() => {
  server.listen(PORT, () => {
    console.log(`Forensics Drawer listening on http://localhost:${PORT}`);
  });
});
