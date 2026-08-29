(function () {
'use strict';
var nav = document.querySelector('.nb-nav');
var burger = nav && nav.querySelector('.nb-nav-burger');
var links = nav && nav.querySelector('.nb-nav-links');
if (nav && burger && links) {
burger.addEventListener('click', function () {
var open = nav.classList.toggle('is-open');
burger.setAttribute('aria-expanded', open ? 'true' : 'false');
});
links.addEventListener('click', function (e) {
if (!e.target.closest('a')) return;
nav.classList.remove('is-open');
burger.setAttribute('aria-expanded', 'false');
});
}
if (nav) {
var onScroll = function () {
var y = window.scrollY;
nav.classList.toggle('is-scrolled', y > 24);
if (y > 260) nav.classList.add('is-far');
else if (y < 180) nav.classList.remove('is-far');
};
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });
}
var io = new IntersectionObserver(function (entries) {
entries.forEach(function (e) {
if (!e.isIntersecting) return;
e.target.classList.add('is-in');
io.unobserve(e.target);
});
}, { threshold: 0.12 });
function observe(root) {
(root || document).querySelectorAll('.nb-reveal').forEach(function (el) {
if (!el.classList.contains('is-in')) io.observe(el);
});
}
observe();
window.HereldReveal = observe;
var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
var RAINBAW = ['--nb-red', '--nb-green', '--nb-blue', '--nb-yellow', '--nb-pink'];
document.addEventListener('click', function (e) {
var poke = e.target.closest('.nb-poke');
if (!poke) return;
var i = (parseInt(poke.dataset.hue || '0', 10) + 1) % RAINBAW.length;
poke.dataset.hue = String(i);
var prop = poke.classList.contains('nb-shape--tri') ? 'border-bottom-color' : 'background';
poke.style.setProperty(prop, 'var(' + RAINBAW[i] + ')');
});
var floats = Array.prototype.slice.call(document.querySelectorAll('.nb-float:not(img)'));
if (floats.length && !reduced.matches && matchMedia('(hover: hover)').matches) {
var queued = false, mx = 0, my = 0;
window.addEventListener('pointermove', function (e) {
mx = e.clientX; my = e.clientY;
if (queued) return;
queued = true;
requestAnimationFrame(function () {
queued = false;
var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
floats.forEach(function (el) {
var depth = parseFloat(el.dataset.depth || '14');
el.style.setProperty('--nb-tx', (-((mx - cx) / cx) * depth).toFixed(1) + 'px');
el.style.setProperty('--nb-ty', (-((my - cy) / cy) * depth).toFixed(1) + 'px');
});
});
}, { passive: true });
}
})();
