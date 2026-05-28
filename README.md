# Forensics Drawer

A frontend prototype for voice-assisted forensic composite generation.

## Flow

- Create a new case by selecting suspect profile traits from feature-specific option lists.
- Move directly into a witness interview backed by a Realtime voice model.
- Finish the interview to trigger image generation.
- Output only iterations of the single suspect for the active case, with each generated sketch rendered and downloadable.

## Case Schema

The frontend stores the active case as `forensics-drawer.case.v1`. The same schema is passed to the Realtime interview agent and image generation request so profile context stays consistent across the flow.

The interview agent preamble lives in `preamble.md`.

## Backend Hooks

The included local server provides:

- `POST /api/realtime/call` for Realtime WebRTC call creation.
- `POST /api/images/generate` for image generation with the selected image model.

Keep OpenAI API keys on the server. The current frontend falls back to demo composites when those endpoints are not available.

## Run Locally

```sh
OPENAI_API_KEY=your_api_key node server.js
```

Open `http://localhost:5173/`. The interview screen will ask for microphone permission when you click `Start voice`.
