import {
  prepareWithSegments,
  measureNaturalWidth,
} from "https://esm.sh/@chenglou/pretext@0.0.5";

const PREFIX = "Hi, my name is ";
const REMAINING = ["i", "c", "h", "a", "e", "l", "."];
const PLACE_INTERVAL = 1400;
const BUMP_COOLDOWN = 900;

const FRAMES = {
  idle: ["ʕ•ᴥ•ʔ", "ʕ-ᴥ-ʔ"],
  placing: "ʕ^ᴥ^ʔ",
  bumped: "ʕ◉ᴥ◉ʔ",
  done: "ʕ•ᴥ•ʔ✨",
};

const h1 = document.querySelector(".name-h1");
if (h1) {
  const lettersContainer = h1.querySelector(".name-letters");
  const creature = document.getElementById("name-builder-creature");
  const creatureBody = creature.querySelector(".creature-body");

  const placed = ["M"];
  const queue = [...REMAINING];
  let state = "idle";
  let lastBump = 0;

  const readFont = () => {
    const cs = getComputedStyle(h1);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  };
  let font = readFont();

  const measureWidth = (text) =>
    measureNaturalWidth(prepareWithSegments(text, font));

  const updateCreaturePosition = () => {
    const width = measureWidth(PREFIX + placed.join(""));
    creature.style.setProperty("--text-width", `${width}px`);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function placeNext() {
    if (state !== "idle" || queue.length === 0) return;
    state = "placing";
    creatureBody.textContent = FRAMES.placing;
    creatureBody.classList.add("placing");

    const letter = queue.shift();
    placed.push(letter);

    const span = document.createElement("span");
    span.className = "name-letter arriving";
    span.textContent = letter;
    lettersContainer.appendChild(span);

    await nextFrame();
    span.classList.remove("arriving");
    updateCreaturePosition();

    await wait(450);
    creatureBody.classList.remove("placing");
    creatureBody.textContent =
      queue.length === 0 ? FRAMES.done : FRAMES.idle[0];
    state = "idle";
  }

  async function handleBump() {
    const now = Date.now();
    if (state !== "idle" || now - lastBump < BUMP_COOLDOWN) return;
    if (placed.length <= 1) return;
    lastBump = now;

    state = "bumped";
    creatureBody.textContent = FRAMES.bumped;
    creatureBody.classList.add("bumped");

    const letterEls = lettersContainer.querySelectorAll(".name-letter");
    const lastEl = letterEls[letterEls.length - 1];
    lastEl.classList.add("falling");

    const popped = placed.pop();
    queue.unshift(popped);

    await nextFrame();
    updateCreaturePosition();

    await wait(650);
    lastEl.remove();
    creatureBody.classList.remove("bumped");
    creatureBody.textContent = FRAMES.idle[0];
    state = "idle";
  }

  let blinkFrame = 0;
  setInterval(() => {
    if (state !== "idle") return;
    if (queue.length === 0) {
      creatureBody.textContent = FRAMES.done;
      return;
    }
    blinkFrame = (blinkFrame + 1) % FRAMES.idle.length;
    creatureBody.textContent = FRAMES.idle[blinkFrame];
  }, 2600);

  setInterval(placeNext, PLACE_INTERVAL);

  creature.addEventListener("mouseenter", handleBump);
  creature.addEventListener("touchstart", handleBump, { passive: true });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      font = readFont();
      updateCreaturePosition();
    });
  }

  window.addEventListener("resize", () => {
    font = readFont();
    updateCreaturePosition();
  });

  updateCreaturePosition();
}
