const state = {
  live: false,
  connecting: false,
  details: [],
  generatedImages: [],
  realtime: null,
  caseSchema: null,
  interviewPreamble: "",
  interviewTimeoutId: null,
  wrapUpTimeoutId: null,
};

const INTERVIEW_LIMIT_MS = 3 * 60 * 1000;
const INTERVIEW_WRAP_UP_MS = 2.5 * 60 * 1000;

const FALLBACK_INTERVIEW_AGENT_PREAMBLE = [
  "You are the detective conducting a short follow-up interview with a witness for one suspect composite.",
  "Begin by saying: \"I'm the detective assigned to help create the sketch. I just need a few more details about the person you saw.\"",
  "The interview is limited to 3 minutes. Ask one concise question at a time.",
  "At 2 minutes and 30 seconds, begin gracefully wrapping up and ask if there is anything else the witness would like to mention that was not covered.",
  "At the 3-minute mark, gracefully end by saying: \"Thank you, I have the details I need to create the sketch now.\"",
  "Do not ask confidence-rating questions. Assume provided details are high confidence unless the witness explicitly says they are unsure.",
  "Ask about observable facial traits and visible accessories such as eyewear, headwear, scarves, masks, sunglasses, jewelry, scars, or tattoos.",
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
  ["gender", "Gender"],
  ["raceEthnicity", "Race / ethnicity"],
  ["age", "Age range"],
  ["eyeColor", "Eye color"],
  ["hairColor", "Hair color"],
  ["style", "Composite style"],
];

function getProfile() {
  return Object.fromEntries(new FormData(profileForm).entries());
}

function buildCaseSchema() {
  const form = getProfile();

  return {
    schemaVersion: "visage.case.v1",
    caseId: form.caseId,
    suspectCount: 1,
    suspect: {
      genderPresentation: form.gender,
      raceEthnicity: form.raceEthnicity,
      ageRange: form.age,
      eyeColor: form.eyeColor,
      hairColor: form.hairColor,
      faceShape: "to be gathered during interview",
      hair: "to be gathered during interview",
      eyes: "to be gathered during interview",
      nose: "to be gathered during interview",
      facialHair: "to be gathered during interview",
      distinguishingFeature: "to be gathered during interview",
      visibleAccessory: "to be gathered during interview",
    },
    generation: {
      style: form.style,
      iterations: Number(form.iterations),
      imageModel: form.imageModel,
    },
    interview: {
      voiceModel: form.voiceModel,
      preamble: state.interviewPreamble || FALLBACK_INTERVIEW_AGENT_PREAMBLE,
      limitSeconds: INTERVIEW_LIMIT_MS / 1000,
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
    `Gender or presentation: ${caseSchema.suspect.genderPresentation}.`,
    `Race or ethnicity, if witness provided it: ${caseSchema.suspect.raceEthnicity}.`,
    `Age range: ${caseSchema.suspect.ageRange}.`,
    `Eye color: ${caseSchema.suspect.eyeColor}.`,
    `Hair color: ${caseSchema.suspect.hairColor}.`,
    `Witness interview notes: ${details}.`,
    "Use a neutral forward-facing forensic composition on a plain background.",
  ].join("\n");
}

function getImageErrorMessage(status, errorText) {
  try {
    const parsed = JSON.parse(errorText);
    const message = parsed.error?.message || parsed.error || parsed.message || errorText;
    return `Image generation failed (${status}): ${message}`;
  } catch {
    return `Image generation failed (${status}): ${errorText || "No details returned."}`;
  }
}

function renderSummary() {
  const caseSchema = getCaseSchema();
  const summaryValues = {
    gender: caseSchema.suspect.genderPresentation,
    raceEthnicity: caseSchema.suspect.raceEthnicity,
    age: caseSchema.suspect.ageRange,
    eyeColor: caseSchema.suspect.eyeColor,
    hairColor: caseSchema.suspect.hairColor,
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

function clearInterviewTimers() {
  if (state.interviewTimeoutId) {
    clearTimeout(state.interviewTimeoutId);
    state.interviewTimeoutId = null;
  }

  if (state.wrapUpTimeoutId) {
    clearTimeout(state.wrapUpTimeoutId);
    state.wrapUpTimeoutId = null;
  }
}

function requestInterviewWrapUp() {
  const dataChannel = state.realtime?.dataChannel;

  if (!dataChannel || dataChannel.readyState !== "open") {
    appendTranscript("Detective", "Is there anything else you would like to mention that we haven’t covered?");
    return;
  }

  dataChannel.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "The interview has reached 2 minutes and 30 seconds. Begin wrapping up now. Ask the witness: \"Is there anything else you would like to mention that we haven’t covered?\" Keep it brief.",
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
}

function startInterviewTimer() {
  clearInterviewTimers();

  state.wrapUpTimeoutId = setTimeout(() => {
    state.wrapUpTimeoutId = null;
    sessionStatus.textContent = "Wrapping up";
    appendTranscript("System", "Two minutes and thirty seconds reached. Wrapping up.");
    requestInterviewWrapUp();
  }, INTERVIEW_WRAP_UP_MS);

  state.interviewTimeoutId = setTimeout(() => {
    state.interviewTimeoutId = null;
    appendTranscript("System", "Three-minute interview limit reached.");
    appendTranscript("Detective", "Thank you, I have the details I need to create the sketch now.");
    finishInterview();
  }, INTERVIEW_LIMIT_MS);
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
  clearInterviewTimers();
  stopRealtimeSession();
  state.live = false;
  caseLabel.textContent = `Case ${caseSchema.caseId}`;
  state.details = [];
  state.caseSchema = getCaseSchema();
  transcript.innerHTML = "";
  recordButton.classList.remove("live");
  voiceCard.classList.remove("live");
  sessionStatus.classList.remove("live");
  recordLabel.textContent = "Start interview";
  sessionStatus.textContent = "Ready";
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
      startInterviewTimer();
    } catch (error) {
      clearInterviewTimers();
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
    clearInterviewTimers();
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
  const seed = variant * 19 + suspect.hairColor.length + suspect.eyeColor.length;

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

  const faceWidth = suspect.genderPresentation.includes("female") ? 72 : 82;
  const jaw = suspect.genderPresentation.includes("male") ? 10 : 0;

  ctx.beginPath();
  ctx.ellipse(0, -8, faceWidth + variant * 2, 98 - jaw, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const hairColor = suspect.hairColor.includes("blond")
    ? "#b49356"
    : suspect.hairColor.includes("red")
      ? "#8b4636"
      : suspect.hairColor.includes("gray") || suspect.hairColor.includes("white")
        ? "#9a9a91"
        : "#25202a";

  ctx.fillStyle = hairColor;
  if (!suspect.hairColor.includes("unknown")) {
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

  const eyeColor = suspect.eyeColor.includes("blue")
    ? "#3b6e95"
    : suspect.eyeColor.includes("green")
      ? "#4f7552"
      : suspect.eyeColor.includes("hazel")
        ? "#7a5d36"
        : "#242a33";
  ctx.fillStyle = eyeColor;
  const eyeOffset = 34;
  ctx.beginPath();
  ctx.ellipse(-eyeOffset, -24, 10, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(eyeOffset, -24, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#6d4d3e";
  ctx.lineWidth = 3;
  const noseLength = 32;
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

  if (suspect.visibleAccessory === "dark sunglasses") {
    ctx.fillStyle = "rgba(20, 26, 34, 0.88)";
    ctx.fillRect(-50, -34, 34, 18);
    ctx.fillRect(16, -34, 34, 18);
    ctx.strokeStyle = "#1f2835";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-16, -25);
    ctx.lineTo(16, -25);
    ctx.stroke();
  }

  if (suspect.visibleAccessory === "clear eyeglasses") {
    ctx.strokeStyle = "#1f2835";
    ctx.lineWidth = 3;
    ctx.strokeRect(-50, -35, 34, 22);
    ctx.strokeRect(16, -35, 34, 22);
    ctx.beginPath();
    ctx.moveTo(-16, -24);
    ctx.lineTo(16, -24);
    ctx.stroke();
  }

  if (suspect.visibleAccessory === "scarf around neck") {
    ctx.fillStyle = "#536b7d";
    ctx.fillRect(-58, 88, 116, 28);
  }

  if (suspect.visibleAccessory === "baseball cap") {
    ctx.fillStyle = "#34465a";
    ctx.beginPath();
    ctx.ellipse(0, -104, 78, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-62, -124, 124, 30);
  }

  ctx.restore();

  ctx.fillStyle = "#253040";
  ctx.font = "600 13px Inter, sans-serif";
  ctx.fillText(`Iteration ${variant}`, 18, height - 18);
}

async function requestImageGeneration(count) {
  const caseSchema = getCaseSchema();

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

  if (!response.ok) {
    throw new Error(getImageErrorMessage(response.status, await response.text()));
  }

  return await response.json();
}

function createImageCard(image, index) {
  const card = document.createElement("article");
  const img = document.createElement("img");
  const meta = document.createElement("div");
  const download = document.createElement("a");

  card.className = "iteration-card";
  img.className = "sketch generated-sketch";
  img.src = image.url;
  img.alt = `Generated suspect sketch iteration ${index}`;
  meta.className = "iteration-meta";
  download.href = image.url;
  download.download = `suspect-iteration-${index}.png`;
  download.textContent = "Download";
  meta.append(`Generated sketch ${index}`, download);
  card.append(img, meta);

  return card;
}

function createDemoCard(index) {
  const card = document.createElement("article");
  const canvas = document.createElement("canvas");
  const meta = document.createElement("div");

  card.className = "iteration-card";
  canvas.className = "sketch";
  canvas.width = 512;
  canvas.height = 640;
  meta.className = "iteration-meta";
  meta.textContent = `Demo sketch ${index}`;

  drawIteration(canvas, index);
  card.append(canvas, meta);

  return card;
}

async function generateIterations() {
  const caseSchema = getCaseSchema();
  const count = Number(caseSchema.generation.iterations);

  showScreen("iterations");
  iterationsGrid.innerHTML = "";
  regenerateButton.disabled = true;
  regenerateButton.textContent = "Generating";

  try {
    const result = await requestImageGeneration(count);
    state.generatedImages = result.images || [];

    if (!state.generatedImages.length) {
      throw new Error("Image generation returned no sketches.");
    }

    state.generatedImages.forEach((image, index) => {
      iterationsGrid.append(createImageCard(image, index + 1));
    });
  } catch (error) {
    appendTranscript("System", error.message || "Image generation failed. Showing demo sketches.");

    for (let index = 1; index <= count; index += 1) {
      iterationsGrid.append(createDemoCard(index));
    }
  }

  regenerateButton.disabled = false;
  regenerateButton.textContent = "Regenerate";
}

function finishInterview() {
  clearInterviewTimers();

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
