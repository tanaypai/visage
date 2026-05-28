# Visage

Visage is a voice-assisted forensic composite prototype. It helps an investigator create an initial one-suspect case profile, run a short witness interview through the OpenAI Realtime API, and generate consistent suspect sketch iterations from the collected description.

## Features

- Three-step case workflow: profile setup, witness interview, and generated sketch iterations.
- Initial suspect profile form with case ID, gender or presentation, race or ethnicity, age range, eye color, hair color, composite style, iteration count, voice model, and image model.
- Shared case schema stored as `visage.case.v1` and passed through the interview and image-generation flow.
- One-suspect enforcement across the frontend, Realtime instructions, and image prompt.
- Realtime WebRTC voice interview with microphone capture, server-side VAD, near-field noise reduction, English transcription, and the `marin` voice.
- Configurable voice model from the UI: `gpt-realtime`, `gpt-realtime-mini`, or `gpt-realtime-2`.
- Interview guidance loaded from `preamble.md`, with a built-in fallback if the file is unavailable.
- Three-minute interview limit, with an automatic wrap-up prompt at 2 minutes and 30 seconds.
- Live transcript panel that captures witness transcriptions, interviewer transcript text, and system status messages.
- Manual finish action that stops the voice session and moves directly to sketch generation.
- Image generation through the OpenAI Images API with configurable image model: `gpt-image-1.5`, `gpt-image-1`, or `gpt-image-1-mini`.
- Image prompt guardrails loaded from `image-preamble.md`, with a built-in fallback on the server.
- Configurable generation count of 2, 3, or 4 suspect iterations.
- Download links for generated sketches.
- Regenerate action for another set of suspect iterations.
- Back-to-interview action for revisiting the transcript and profile summary.
- Canvas-based demo sketches when API generation is unavailable or returns an error.
- Local static server that also proxies OpenAI API calls so the API key stays server-side.
- Optional `.env` loading for local development.

## App Flow

1. Build the initial profile from known witness-provided traits.
2. Start the interview screen and review the active suspect summary.
3. Click `Start interview` to grant microphone access and begin the Realtime voice session.
4. Let the interview collect or refine observable facial traits and accessories.
5. Finish manually or allow the three-minute limit to end the interview automatically.
6. Generate suspect sketch iterations for the active case.
7. Download generated sketches or regenerate a new set.

## Case Schema

The frontend builds and refreshes a single active case object with this version:

```text
visage.case.v1
```

The schema includes:

- `caseId`
- `suspectCount`, fixed at `1`
- suspect starter traits: gender or presentation, race or ethnicity, age range, eye color, and hair color
- interview-gathered fields for face shape, hair, eyes, nose, facial hair, distinguishing features, and visible accessories
- generation settings for style, iteration count, and image model
- interview settings for voice model, prompt preamble, time limit, and witness details

The same schema is sent to the Realtime interview agent and to image generation so profile context stays consistent across the flow.

## Prompt Files

- `preamble.md` defines the voice interview assistant behavior, safety rules, interview phases, summary schema, final outputs, and three-minute ending behavior.
- `image-preamble.md` defines image-generation guardrails, including one centered face per image, no lineups or collages, neutral forensic styling, and visible accessories only when reported.

Both files are loaded at runtime. The app and server include fallbacks so the prototype still runs if either file is unavailable.

## Backend Endpoints

The local Node server serves the static frontend and exposes two API routes:

### `POST /api/realtime/call`

Creates a Realtime WebRTC call.

- Accepts an SDP offer body.
- Builds a Realtime session with the active case profile.
- Uses the selected voice model when provided by the case schema.
- Returns the SDP answer from OpenAI.

### `POST /api/images/generate`

Generates suspect sketch iterations.

- Accepts `model`, `caseProfile`, `prompt`, `n`, and `size`.
- Clamps image count to 1-4.
- Combines the local image preamble, case-specific prompt, and shared case schema.
- Returns generated image data and usage metadata when available.

## Run Locally

Create a `.env` file or export your key in the shell:

```sh
OPENAI_API_KEY=your_api_key
```

Start the local server:

```sh
node server.js
```

Open:

```text
http://localhost:5173/
```

The interview screen asks for microphone permission when you click `Start interview`.

You can override the port:

```sh
PORT=3000 node server.js
```

## Development Notes

- Keep OpenAI API keys on the server. The browser calls the local server, not OpenAI directly.
- Use Chrome or Safari for microphone capture and WebRTC testing.
- If the Realtime or Images API is unavailable, the UI records the error in the transcript and shows demo sketch canvases.
- Generated sketches are requested at `1024x1536` with `quality: "auto"`.
- The server loads `.env` automatically for local development, but production deployments should use environment variables.
