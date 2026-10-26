// Landing motion: one GSAP ticker drives Lenis, the hero route and the story thread.
// The page is complete without this file; under reduced motion only the route buttons work.
import { gsap } from 'gsap';
import Lenis from 'lenis';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const track = document.querySelector('.route-track');
const fill = document.querySelector('.route-fill');
const dot = document.querySelector('.route-dot');
const figure = document.querySelector('.route-figure');
const caption = document.querySelector('.route-caption');
const number = document.querySelector('.route-caption-number');
const stops = [...document.querySelectorAll('.route-stop')];
const storyTrack = document.querySelector('.story-track');
const threadFill = document.querySelector('.thread-fill');
const nodes = [...document.querySelectorAll('[data-node]')];

let cleanup = () => {};

function setup() {
  cleanup();
  const off = [];
  const motion = !reduced.matches;
  root.classList.toggle('motion', motion);
  // One driver for the route: the drawn line, the marker and the pressed stop all read it.
  const route = { progress: 1, time: 0 };
  let heroVisible = true;

  const drawRoute = () => {
    if (!track || !fill || !dot) return;
    const length = track.getTotalLength();
    fill.style.strokeDashoffset = String(1 - route.progress);
    // Idle: the marker breathes a short way back along the line it has already carried.
    const idle = motion ? (Math.sin(route.time * 1.4) * 0.5 + 0.5) * 0.03 : 0;
    const point = track.getPointAtLength(Math.max(0, route.progress - idle) * length);
    dot.setAttribute('cx', point.x.toFixed(2));
    dot.setAttribute('cy', point.y.toFixed(2));
  };

  const select = (index) => {
    const stop = stops[index];
    stops.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    if (caption) caption.textContent = stop.dataset.caption;
    if (number) number.textContent = `0${index + 1} / 0${stops.length}`;
    gsap.killTweensOf(route, 'progress');
    const to = Number(stop.dataset.at);
    if (motion) gsap.to(route, { progress: to, duration: 0.9, ease: 'power3.inOut', onUpdate: drawRoute });
    else { route.progress = to; drawRoute(); }
  };
  stops.forEach((button, i) => {
    const onClick = () => select(i);
    button.addEventListener('click', onClick);
    off.push(() => button.removeEventListener('click', onClick));
  });

  // The story thread fills with scroll; each stage lights its node as the thread reaches it.
  const drawThread = () => {
    if (!storyTrack || !threadFill) return;
    const line = innerHeight * 0.55;
    const r = storyTrack.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (line - r.top) / r.height));
    threadFill.style.setProperty('--p', p.toFixed(4));
    nodes.forEach((n) => n.classList.toggle('is-reached', n.getBoundingClientRect().top < line));
  };

  if (motion) {
    const lenis = new Lenis({ duration: 0.9, anchors: true });
    lenis.on('scroll', drawThread);
    const tick = (time) => {
      lenis.raf(time * 1000);
      if (heroVisible && !document.hidden) { route.time = time; drawRoute(); }
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    addEventListener('resize', drawThread);
    off.push(() => { gsap.ticker.remove(tick); lenis.destroy(); removeEventListener('resize', drawThread); });
    if (figure) {
      const io = new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; });
      io.observe(figure);
      off.push(() => io.disconnect());
    }
    drawThread();
  } else {
    threadFill?.style.removeProperty('--p');
    nodes.forEach((n) => n.classList.remove('is-reached'));
  }
  drawRoute();
  cleanup = () => { off.forEach((fn) => fn()); gsap.killTweensOf(route); };
}

setup();
reduced.addEventListener('change', setup);
addEventListener('pagehide', () => cleanup());
addEventListener('pageshow', (event) => { if (event.persisted) setup(); });
