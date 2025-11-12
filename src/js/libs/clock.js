import { $ } from "./element";

export default function updateClock() {
  $('#liveClock').innerText = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Instead of setInterval inline, we can do this instead, calling
  // updateClock() recursively.
  setTimeout(updateClock, 1000);
}
