import {
  advancePreviewFrame,
  buildPreviewRows,
  createPreviewState,
  selectPreviewAction,
  setPreviewPlaying,
  setPreviewScale
} from "./preview-state.js";

const canvas = document.querySelector("#pet-canvas");
const context = canvas.getContext("2d");
const fileInput = document.querySelector("#spritesheet-file");
const actionList = document.querySelector("#action-list");
const playToggle = document.querySelector("#play-toggle");
const scaleInput = document.querySelector("#scale");
const frameMeta = document.querySelector("#frame-meta");
const actionMeta = document.querySelector("#action-meta");

let state = createPreviewState();
let spritesheet = null;
let lastFrameAt = 0;
let objectUrl = null;
const previewRows = buildPreviewRows();

for (const row of previewRows) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.textContent = row.action;
  button.dataset.action = row.action;
  button.addEventListener("click", () => {
    state = selectPreviewAction(state, row.action);
    render();
  });
  actionList.append(button);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    spritesheet = image;
    render();
  };
  image.src = objectUrl;
});

playToggle.addEventListener("click", () => {
  state = setPreviewPlaying(state, !state.playing);
  render();
});

scaleInput.addEventListener("input", () => {
  state = setPreviewScale(state, Number(scaleInput.value));
  render();
});

function tick(timestamp) {
  if (state.playing && timestamp - lastFrameAt > 120) {
    state = advancePreviewFrame(state);
    lastFrameAt = timestamp;
    render();
  }

  requestAnimationFrame(tick);
}

function render() {
  canvas.width = state.frameRect.width * state.scale;
  canvas.height = state.frameRect.height * state.scale;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (spritesheet) {
    context.drawImage(
      spritesheet,
      state.frameRect.x,
      state.frameRect.y,
      state.frameRect.width,
      state.frameRect.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  } else {
    drawEmptyState();
  }

  for (const button of actionList.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.action === state.action);
  }

  playToggle.textContent = state.playing ? "Pause" : "Play";
  actionMeta.textContent = state.action;
  const row = previewRows.find((previewRow) => previewRow.action === state.action);
  frameMeta.textContent = `frame ${state.frameIndex + 1} / ${row.frameCount}`;
}

function drawEmptyState() {
  context.fillStyle = "#f4f1e8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#2f5d62";
  context.lineWidth = 2;
  context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = "#24343b";
  context.font = "14px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("spritesheet", canvas.width / 2, canvas.height / 2 - 8);
  context.fillText("1536 x 1872", canvas.width / 2, canvas.height / 2 + 14);
}

render();
requestAnimationFrame(tick);
