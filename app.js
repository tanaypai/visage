const state = {
  live: false,
  connecting: false,
  details: [],
  realtime: null,
  caseSchema: null,
  interviewPreamble: "",
};

const FALLBACK_INTERVIEW_AGENT_PREAMBLE = [
  "You are a forensic interview assistant helping a trained investigator collect details for one suspect composite.",
  "Speak calmly and ask one concise question at a time.",
  "Only ask about observable physical facial traits useful for a sketch.",
  "Avoid making demographic inferences beyond what the witness explicitly states.",
  "Always treat the initial suspect profile as context, confirm uncertain details, and refine the profile through witness testimony.",
].join(" ");

const screens = {
  profile: document.querySelector("#profileScreen"),
  interview: document.querySelector("#interviewScreen"),
  iterations: document.querySelector("#iterationsScreen"),
};

const profileForm = document.querySelector("#profileForm");
const caseLabel = document.querySelector("#caseLabel");
const profileSummary = document.querySelector("#profileSummary");
const startCaseButton = document.querySelector("#startCaseButton");
const recordButton = document.querySelector("#recordButton");
const recordLabel = document.querySelector("#recordLabel");
const sessionStatus = document.querySelector("#sessionStatus");
const voiceCard = document.querySelector("#voiceCard");
const finishInterviewButton = document.querySelector("#finishInterviewButton");
const transcript = document.querySelector("#transcript");
const iterationsGrid = document.querySelector("#iterationsGrid");
const regenerateButton = document.querySelector("#regenerateButton");
const backToInterviewButton = document.querySelector("#backToInterviewButton");

const summaryFields = [
  ["age", "Age range"],
  ["face", "Face shape"],
  ["hair", "Hair"],
  ["eyes", "Eyes"],
  ["nose", "Nose"],
  ["facialHair", "Facial hair"],
  ["mark", "Distinguishing feature"],
  ["style", "Composite style"],
];

function getProfile() {
  return Object.fromEntries(new FormData(profileForm).entries());
}

function buildCaseSchema() {
  const form = getProfile();

  return {
    schemaVersion: "forensics-drawer.case.v1",
    caseId: form.caseId,
    suspectCount: 1,
    suspect: {
      ageRange: form.age,
      faceShape: form.face,
      hair: form.hair,
      eyes: form.eyes,
      nose: form.nose,
      facialHair: form.facialHair,
      distinguishingFeature: form.mark,
    },
    generation: {
      style: form.style,
      iterations: Number(form.iterations),
      imageModel: form.imageModel,
    },
    interview: {
      voiceModel: form.voiceModel,
      preamble: state.interviewPreamble || FALLBACK_INTERVIEW_AGENT_PREAMBLE,
      witnessDetails: [...state.details],
    },
  };
}

async function loadInterviewPreamble() {
  try {
    const response = await fetch("./preamble.md", { cache: "no-store" });
    if (!response.ok) throw new Error("Preamble not found");

    state.interviewPreamble = (await response.text()).trim();
  } catch {
    state.interviewPreamble = FALLBACK_INTERVIEW_AGENT_PREAMBLE;
  }
}

function getCaseSchema() {
  state.caseSchema = buildCaseSchema();
  return state.caseSchema;
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("active", key === name);
  });

  document.querySelectorAll("[data-step-indicator]").forEach((step) => {
    step.classList.toggle("active", step.dataset.stepIndicator === name);
  });
}

function buildPrompt() {
  const caseSchema = getCaseSchema();
  const details = state.details.length
    ? state.details.join("; ")
    : "No additional witness details captured yet.";

  return [
    `Create ${caseSchema.generation.iterations} iterations of the same suspect as a ${caseSchema.generation.style}.`,
    `One suspect only; keep identity consistent across iterations.`,
    `Age range: ${caseSchema.suspect.ageRange}.`,
    `Face shape: ${caseSchema.suspect.faceShape}.`,
    `Hair: ${caseSchema.suspect.hair}.`,
    `Eyes: ${caseSchema.suspect.eyes}.`,
    `Nose: ${caseSchema.suspect.nose}.`,
    `Facial hair: ${caseSchema.suspect.facialHair}.`,
    `Distinguishing feature: ${caseSchema.suspect.distinguishingFeature}.`,
    `Witness interview notes: ${details}.`,
    "Use a neutral forward-facing forensic composition on a plain background.",
  ].join("\n");
}

function renderSummary() {
  const caseSchema = getCaseSchema();
  const summaryValues = {
    age: caseSchema.suspect.ageRange,
    face: caseSchema.suspect.faceShape,
    hair: caseSchema.suspect.hair,
    eyes: caseSchema.suspect.eyes,
    nose: caseSchema.suspect.nose,
    facialHair: caseSchema.suspect.facialHair,
    mark: caseSchema.suspect.distinguishingFeature,
    style: caseSchema.generation.style,
  };

  profileSummary.innerHTML = "";

  summaryFields.forEach(([key, label]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");

    term.textContent = label;
    value.textContent = summaryValues[key];
    item.append(term, value);
    profileSummary.append(item);
  });
}

function appendTranscript(speaker, text) {
  const article = document.createElement("article");
  const speakerLabel = document.createElement("strong");
  const line = document.createElement("p");

  speakerLabel.textContent = speaker;
  line.textContent = text;
  article.append(speakerLabel, line);
  transcript.append(article);
  transcript.scrollTop = transcript.scrollHeight;
}

function getMicrophonePermissionMessage(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Microphone capture is not available in this browser. Open the app in Chrome or Safari at http://localhost:5173.";
  }

  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone permission was denied. Allow microphone access for localhost in the browser address bar, then start the interview again.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No microphone was found. Connect or enable a microphone, then start the interview again.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The microphone is already in use or blocked by the system. Close other audio apps and check macOS microphone permissions for this browser.";
  }

  return error?.message || "Could not access the microphone.";
}

function getRealtimeErrorMessage(status, errorText) {
  try {
    const parsed = JSON.parse(errorText);
    let message = parsed.error?.message || parsed.error || parsed.message || errorText;

    if (parsed.details) {
      try {
        const details = JSON.parse(parsed.details);
        message = details.error?.message || parsed.details;
      } catch {
        message = parsed.details;
      }
    }

    return `Realtime call failed (${status}): ${message}`;
  } catch {
    return `Realtime call failed (${status}): ${errorText || "No details returned."}`;
  }
}

async function getMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    throw new Error(getMicrophonePermissionMessage(error));
  }
}

async function createRealtimeSession() {
  const caseSchema = getCaseSchema();
  const stream = await getMicrophoneStream();
  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  const remoteAudio = document.createElement("audio");

  remoteAudio.autoplay = true;
  remoteAudio.muted = false;
  remoteAudio.playsInline = true;
  remoteAudio.hidden = true;
  document.body.append(remoteAudio);

  peerConnection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(() => {
      appendTranscript("System", "Model audio is connected, but the browser blocked playback.");
    });
  };

  stream.getAudioTracks().forEach((track) => {
    peerConnection.addTrack(track, stream);
  });

  dataChannel.addEventListener("open", () => {
    const context = getCaseSchema();

    dataChannel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                context.interview.preamble,
                "Begin the interview using the following case schema as required context.",
                "Always preserve it as the current known profile unless the witness corrects or refines a field.",
                JSON.stringify(context, null, 2),
              ].join("\n"),
            },
          ],
        },
      }),
    );

    dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
        },
      }),
    );
  });

  dataChannel.addEventListener("open", () => {
    appendTranscript("System", "Realtime data channel connected.");
  });

  dataChannel.addEventListener("message", (event) => {
    handleRealtimeEvent(event.data);
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  try {
    const response = await fetch("/api/realtime/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(getRealtimeErrorMessage(response.status, errorText));
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await response.text(),
    });

    state.realtime = {
      dataChannel,
      peerConnection,
      remoteAudio,
      stream,
    };

    return state.realtime;
  } catch (error) {
    dataChannel.close();
    peerConnection.close();
    stream.getTracks().forEach((track) => track.stop());
    remoteAudio.remove();
    throw error;
  }
}

function stopRealtimeSession() {
  if (!state.realtime) return;

  state.realtime.dataChannel?.close();
  state.realtime.peerConnection?.close();
  state.realtime.stream?.getTracks().forEach((track) => track.stop());
  state.realtime.remoteAudio?.remove();
  state.realtime = null;
}

function handleRealtimeEvent(payload) {
  let event;

  try {
    event = JSON.parse(payload);
  } catch {
    return;
  }

  const transcriptText =
    event.transcript ||
    event.delta ||
    event.item?.content?.find((part) => part.transcript)?.transcript ||
    "";

  if (
    event.type === "conversation.item.input_audio_transcription.completed" &&
    transcriptText
  ) {
    state.details.push(transcriptText);
    appendTranscript("Witness", transcriptText);
  }

  if (
    (event.type === "response.audio_transcript.done" ||
      event.type === "response.output_text.done") &&
    transcriptText
  ) {
    appendTranscript("Interviewer", transcriptText);
  }

  if (event.type === "error") {
    appendTranscript("System", event.error?.message || "Realtime session error.");
  }
}

async function startInterview() {
  const caseSchema = getCaseSchema();
  caseLabel.textContent = `Case ${caseSchema.caseId}`;
  state.details = [];
  state.caseSchema = getCaseSchema();
  transcript.innerHTML = "";
  renderSummary();
  showScreen("interview");
  appendTranscript(
    "Detective",
    "Start with the most certain details. We will refine the suspect before generating iterations.",
  );
}

async function toggleVoice() {
  if (state.connecting) return;

  state.live = !state.live;

  if (state.live) {
    try {
      state.connecting = true;
      recordButton.disabled = true;
      recordLabel.textContent = "Connecting";
      sessionStatus.textContent = "Requesting mic";
      await createRealtimeSession();
      recordButton.classList.add("live");
      voiceCard.classList.add("live");
      sessionStatus.classList.add("live");
      recordLabel.textContent = "Stop interview";
      sessionStatus.textContent = "Interview live";
      appendTranscript("System", "Realtime interview started.");
    } catch (error) {
      state.live = false;
      recordButton.classList.remove("live");
      voiceCard.classList.remove("live");
      sessionStatus.classList.remove("live");
      sessionStatus.textContent = "Permission needed";
      recordLabel.textContent = "Start interview";
      appendTranscript(
        "System",
        error.message || "Could not start the Realtime voice session.",
      );
    } finally {
      state.connecting = false;
      recordButton.disabled = false;
    }
  } else {
    stopRealtimeSession();
    recordButton.classList.remove("live");
    voiceCard.classList.remove("live");
    sessionStatus.classList.remove("live");
    recordLabel.textContent = "Start interview";
    sessionStatus.textContent = "Ready";
    appendTranscript("System", "Realtime interview stopped.");
  }
}

function drawIteration(canvas, variant) {
  const ctx = canvas.getContext("2d");
  const caseSchema = getCaseSchema();
  const suspect = caseSchema.suspect;
  const width = canvas.width;
  const height = canvas.height;
  const seed = variant * 19 + suspect.hair.length + suspect.faceShape.length;

  ctx.fillStyle = "#f8f5ef";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(37, 48, 64, 0.15)";
  ctx.lineWidth = 1;
  for (let y = 24; y < height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(14, y + ((seed + y) % 5));
    ctx.lineTo(width - 14, y - ((seed + y) % 4));
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(width / 2, height / 2 + 14);

  ctx.strokeStyle = "#253040";
  ctx.fillStyle = "#efe2d3";
  ctx.lineWidth = 4;

  const narrow = suspect.faceShape.includes("narrow") || suspect.faceShape.includes("long");
  const jaw = suspect.faceShape.includes("square") ? 12 : 0;
  const faceWidth = narrow ? 68 : 82;

  ctx.beginPath();
  ctx.ellipse(0, -8, faceWidth + variant * 2, 98 - jaw, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#25202a";
  if (!suspect.hair.includes("bald") && !suspect.hair.includes("shaved")) {
    ctx.beginPath();
    ctx.moveTo(-78, -82);
    ctx.bezierCurveTo(-50, -150, 54, -148, 80, -78);
    ctx.bezierCurveTo(44, -96, -20, -92, -78, -82);
    ctx.fill();
  }

  ctx.strokeStyle = "#1f2835";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-48, -43);
  ctx.quadraticCurveTo(-27, -52 - variant, -8, -43);
  ctx.moveTo(10, -43);
  ctx.quadraticCurveTo(32, -52 + variant, 54, -42);
  ctx.stroke();

  ctx.fillStyle = "#242a33";
  const eyeOffset = suspect.eyes.includes("close") ? 28 : 38;
  ctx.beginPath();
  ctx.ellipse(-eyeOffset, -24, 10, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(eyeOffset, -24, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#6d4d3e";
  ctx.lineWidth = 3;
  const noseLength = suspect.nose.includes("prominent") ? 40 : 30;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-8, -16 + noseLength);
  ctx.quadraticCurveTo(0, 25, 10, 18);
  ctx.stroke();

  ctx.strokeStyle = "#6c3f34";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-34, 42);
  ctx.quadraticCurveTo(0, 56 + variant, 36, 42);
  ctx.stroke();

  if (!suspect.facialHair.includes("clean") && !suspect.facialHair.includes("none")) {
    ctx.fillStyle = "rgba(42, 34, 34, 0.78)";
    ctx.beginPath();
    ctx.moveTo(-48, 34);
    ctx.quadraticCurveTo(0, 94, 50, 34);
    ctx.quadraticCurveTo(18, 70, -48, 34);
    ctx.fill();
  }

  if (!suspect.distinguishingFeature.includes("none")) {
    ctx.strokeStyle = "#8f493d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-46, -58);
    ctx.lineTo(-26, -48);
    ctx.stroke();
  }

  ctx.restore();

  ctx.fillStyle = "#253040";
  ctx.font = "600 13px Inter, sans-serif";
  ctx.fillText(`Iteration ${variant}`, 18, height - 18);
}

async function requestImageGeneration(count) {
  const caseSchema = getCaseSchema();

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: caseSchema.generation.imageModel,
        caseProfile: caseSchema,
        prompt: buildPrompt(),
        n: count,
        size: "1024x1536",
      }),
    });

    if (!response.ok) throw new Error("Image service unavailable");
    return await response.json();
  } catch {
    return { mode: "demo", images: [] };
  }
}

async function generateIterations() {
  const caseSchema = getCaseSchema();
  const count = Number(caseSchema.generation.iterations);

  showScreen("iterations");
  iterationsGrid.innerHTML = "";
  regenerateButton.disabled = true;
  regenerateButton.textContent = "Generating";

  await requestImageGeneration(count);

  for (let index = 1; index <= count; index += 1) {
    const card = document.createElement("article");
    const canvas = document.createElement("canvas");
    const meta = document.createElement("div");

    card.className = "iteration-card";
    canvas.className = "sketch";
    canvas.width = 512;
    canvas.height = 640;
    meta.className = "iteration-meta";
    meta.textContent = `Same suspect, iteration ${index}`;

    drawIteration(canvas, index);
    card.append(canvas, meta);
    iterationsGrid.append(card);
  }

  regenerateButton.disabled = false;
  regenerateButton.textContent = "Regenerate";
}

function finishInterview() {
  if (state.live) {
    state.live = false;
    stopRealtimeSession();
    recordButton.classList.remove("live");
    voiceCard.classList.remove("live");
    sessionStatus.classList.remove("live");
    recordLabel.textContent = "Start interview";
  }

  sessionStatus.textContent = "Interview finished";
  appendTranscript("System", "Interview finished. Generating suspect iterations.");
  generateIterations();
}

startCaseButton.addEventListener("click", startInterview);
recordButton.addEventListener("click", toggleVoice);
finishInterviewButton.addEventListener("click", finishInterview);
regenerateButton.addEventListener("click", generateIterations);
backToInterviewButton.addEventListener("click", () => showScreen("interview"));
profileForm.addEventListener("input", renderSummary);
profileForm.addEventListener("change", renderSummary);

await loadInterviewPreamble();
renderSummary();
