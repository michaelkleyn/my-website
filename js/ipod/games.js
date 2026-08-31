/**
 * iPod 3G games: Brick, Parachute, Music Quiz, Solitaire.
 *
 * All four render on the monochrome LCD (canvas at the 3G's native-ish
 * 160x107 body resolution, scaled up pixelated, inked with the screen's live
 * --lcd-ink/--lcd-bg vars so backlight and contrast affect gameplay too) and
 * are driven by the wheel + buttons, like 2003.
 *
 * Solitaire's card logic follows Klondike draw-three with the hand-cursor
 * interaction of the original; the Brick/Solitaire idea of "iPod games on the
 * web" is proven by tvillarete/ipod-classic-js (MIT) — these are original
 * implementations restyled for the 3G's monochrome screen.
 *
 * ipod.js calls IpodGames.init(api) and gets view factories back.
 */
(function () {
  'use strict';

  var W = 160, H = 107; // LCD body pixels (128 minus the title bar)

  window.IpodGames = { init: init };

  function init(api) {
    // api: { lib(), pauseMusic(), tick(), volume() }

    // ---- shared canvas-game scaffolding ----------------------------------
    function canvasGame(title, game) {
      // game: { reset(), step(dt), draw(ctx,ink,bg), onScroll(dir), onSelect() }
      var canvas, raf = null, last = 0, over = false;
      function loop(t) {
        if (!canvas.isConnected) { raf = null; return; } // view left the screen
        var dt = Math.min(0.05, (t - last) / 1000); last = t;
        if (!over) game.step(dt);
        paint();
        raf = requestAnimationFrame(loop);
      }
      function paint() {
        var cs = getComputedStyle(canvas.parentElement.closest('.ipod-screen'));
        var ink = cs.getPropertyValue('--lcd-ink').trim() || '#17210f';
        var bg = cs.getPropertyValue('--lcd-bg').trim() || '#b9c1b0';
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 1;
        game.draw(ctx, ink, bg);
        if (over) {
          ctx.textAlign = 'center'; ctx.font = 'bold 10px sans-serif';
          ctx.fillText('GAME OVER', W / 2, 46);
          ctx.font = '8px sans-serif';
          ctx.fillText('Score: ' + (game.score | 0), W / 2, 60);
          ctx.fillText('press select', W / 2, 74);
        }
      }
      var view = {
        title: title, kind: 'custom',
        render: function (el) {
          if (canvas && el.contains(canvas)) return; // re-render guard
          canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
          el.innerHTML = ''; el.appendChild(canvas);
          over = false; game.reset();
          last = performance.now();
          if (!raf) raf = requestAnimationFrame(loop);
        },
        onScroll: function (dir) { if (!over) { game.onScroll(dir); api.tick(); } },
        onSelect: function () {
          if (over) { over = false; game.reset(); return; }
          if (game.onSelect) game.onSelect();
        },
        onExit: function () { if (raf) cancelAnimationFrame(raf); raf = null; if (game.onExit) game.onExit(); }
      };
      game.end = function () { over = true; };
      return view;
    }

    // ---- Brick ------------------------------------------------------------
    function brick() {
      var g = {
        score: 0,
        reset: function (keepScore) {
          if (!keepScore) { g.score = 0; g.lives = 3; g.speed = 55; }
          g.px = W / 2 - 13; g.pw = 26;
          g.bx = W / 2; g.by = 70; g.stuck = true;
          g.vx = 0; g.vy = 0;
          g.bricks = [];
          for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++) g.bricks.push({ x: 2 + c * 20, y: 10 + r * 7, r: r });
        },
        onScroll: function (dir) { g.px = Math.max(0, Math.min(W - g.pw, g.px + dir * 7)); },
        onSelect: function () {
          if (!g.stuck) return;
          g.stuck = false;
          var a = (Math.random() * 0.8 - 0.4) - Math.PI / 2;
          g.vx = Math.cos(a) * g.speed; g.vy = Math.sin(a) * g.speed;
        },
        step: function (dt) {
          if (g.stuck) { g.bx = g.px + g.pw / 2; g.by = 96; return; }
          g.bx += g.vx * dt; g.by += g.vy * dt;
          if (g.bx < 1) { g.bx = 1; g.vx = Math.abs(g.vx); }
          if (g.bx > W - 2) { g.bx = W - 2; g.vx = -Math.abs(g.vx); }
          if (g.by < 1) { g.by = 1; g.vy = Math.abs(g.vy); }
          // paddle
          if (g.by > 98 && g.by < 102 && g.bx > g.px - 2 && g.bx < g.px + g.pw + 2 && g.vy > 0) {
            var t = (g.bx - (g.px + g.pw / 2)) / (g.pw / 2);
            var sp = Math.hypot(g.vx, g.vy);
            var ang = -Math.PI / 2 + t * 1.1;
            g.vx = Math.cos(ang) * sp; g.vy = Math.sin(ang) * sp;
          }
          if (g.by > H + 4) {
            g.lives--;
            if (g.lives <= 0) { g.end(); return; }
            g.stuck = true;
          }
          for (var i = g.bricks.length - 1; i >= 0; i--) {
            var b = g.bricks[i];
            if (g.bx > b.x - 1 && g.bx < b.x + 19 && g.by > b.y - 1 && g.by < b.y + 6) {
              g.bricks.splice(i, 1);
              g.score += (4 - b.r);
              g.vy = -g.vy;
              break;
            }
          }
          if (!g.bricks.length) { g.speed *= 1.15; var s = g.score, l = g.lives, sp2 = g.speed; g.reset(true); g.score = s; g.lives = l; g.speed = sp2; }
        },
        draw: function (ctx) {
          ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('' + g.score, 3, 7);
          ctx.textAlign = 'right'; ctx.fillText('balls ' + g.lives, W - 3, 7);
          g.bricks.forEach(function (b) { ctx.fillRect(b.x, b.y, 18, 5); });
          ctx.fillRect(g.px, 99, g.pw, 3);
          ctx.fillRect(g.bx - 1.5, g.by - 1.5, 3, 3);
        }
      };
      return canvasGame('Brick', g);
    }

    // ---- Parachute --------------------------------------------------------
    function parachute() {
      var g = {
        score: 0,
        reset: function () {
          g.score = 0; g.angle = 0; // 0 = straight up, radians, +right
          g.bullets = []; g.helis = []; g.troopers = []; g.landed = 0; g.spawnT = 0;
        },
        onScroll: function (dir) { g.angle = Math.max(-1.25, Math.min(1.25, g.angle + dir * 0.09)); },
        onSelect: function () {
          if (g.bullets.length > 5) return;
          g.bullets.push({ x: W / 2 + Math.sin(g.angle) * 10, y: 97 - Math.cos(g.angle) * 10, vx: Math.sin(g.angle) * 90, vy: -Math.cos(g.angle) * 90 });
        },
        step: function (dt) {
          g.spawnT -= dt;
          if (g.spawnT <= 0) {
            g.spawnT = 1.6 + Math.random() * 2;
            var ltr = Math.random() < 0.5;
            g.helis.push({ x: ltr ? -14 : W + 14, y: 12 + Math.random() * 22, v: (ltr ? 1 : -1) * (18 + Math.random() * 14), drop: 0.6 + Math.random() * 2 });
          }
          g.helis.forEach(function (h) {
            h.x += h.v * dt; h.drop -= dt;
            if (h.drop < 0 && h.x > 15 && h.x < W - 15) { h.drop = 99; g.troopers.push({ x: h.x, y: h.y + 4, vy: 26 }); }
          });
          g.helis = g.helis.filter(function (h) { return h.x > -20 && h.x < W + 20 && !h.dead; });
          g.troopers.forEach(function (t) {
            t.y += t.vy * dt;
            if (t.y >= 97 && !t.done) { t.done = true; g.landed++; if (g.landed >= 4) g.end(); }
          });
          g.troopers = g.troopers.filter(function (t) { return !t.dead && !t.done; });
          g.bullets.forEach(function (b) {
            b.x += b.vx * dt; b.y += b.vy * dt;
            g.helis.forEach(function (h) { if (Math.abs(b.x - h.x) < 8 && Math.abs(b.y - h.y) < 5) { h.dead = b.dead = true; g.score += 5; } });
            g.troopers.forEach(function (t) { if (Math.abs(b.x - t.x) < 4 && Math.abs(b.y - t.y) < 6) { t.dead = b.dead = true; g.score += 2; } });
          });
          g.bullets = g.bullets.filter(function (b) { return !b.dead && b.x > -4 && b.x < W + 4 && b.y > -4; });
        },
        draw: function (ctx) {
          ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('' + g.score, 3, 7);
          ctx.fillRect(0, 103, W, 1); // ground
          // landed troopers stand near the base
          for (var i = 0; i < g.landed; i++) ctx.fillRect(W / 2 - 26 + i * 6, 99, 2, 4);
          // gun: base + rotating barrel
          ctx.fillRect(W / 2 - 6, 97, 12, 6);
          ctx.beginPath();
          ctx.moveTo(W / 2, 97);
          ctx.lineTo(W / 2 + Math.sin(g.angle) * 11, 97 - Math.cos(g.angle) * 11);
          ctx.stroke();
          g.helis.forEach(function (h) {
            ctx.fillRect(h.x - 7, h.y - 2, 14, 5);
            ctx.fillRect(h.x - 5, h.y - 4, 10, 1);
            ctx.fillRect(h.x + (h.v > 0 ? -9 : 7), h.y - 1, 2, 3);
          });
          g.troopers.forEach(function (t) {
            ctx.beginPath(); ctx.arc(t.x, t.y - 5, 4, Math.PI, 0); ctx.stroke(); // chute
            ctx.fillRect(t.x - 1, t.y - 1, 2, 4);
          });
          g.bullets.forEach(function (b) { ctx.fillRect(b.x - 1, b.y - 1, 2, 2); });
        }
      };
      return canvasGame('Parachute', g);
    }

    // ---- Music Quiz -------------------------------------------------------
    // DOM-based (it IS a menu screen): 10s clip from a random library song,
    // pick the title out of five. Needs >= 5 songs, like the real one.
    function musicQuiz() {
      var lib = api.lib();
      if (!lib.songs || lib.songs.length < 5) {
        return {
          title: 'Music Quiz', kind: 'custom',
          render: function (el) {
            el.innerHTML = '<div class="ipod-text"><br>Music Quiz needs<br>at least 5 songs<br>in the library.</div>';
          }
        };
      }
      var qa = new Audio();
      qa.volume = api.volume();
      var round = null, timer = null, score = 0, reveal = false;
      function startRound() {
        reveal = false;
        var songs = lib.songs;
        var ci = Math.floor(Math.random() * songs.length);
        var picks = [ci];
        while (picks.length < 5) { var r = Math.floor(Math.random() * songs.length); if (picks.indexOf(r) < 0) picks.push(r); }
        picks.sort(function () { return Math.random() - 0.5; });
        round = { correct: ci, picks: picks, left: 10 };
        api.pauseMusic();
        qa.src = songs[ci].src;
        qa.play().then(function () {
          if (qa.duration > 14) qa.currentTime = Math.random() * (qa.duration - 12);
        }).catch(function () {});
        clearInterval(timer);
        timer = setInterval(function () {
          round.left -= 0.2;
          if (round.left <= 0) { round.left = 0; endRound(); } else rr();
        }, 200);
      }
      var frameEl = null, selIdx = 0;
      function endRound() {
        clearInterval(timer);
        reveal = true; rr();
        setTimeout(function () { if (frameEl && frameEl.isConnected) { selIdx = 0; startRound(); } }, 1800);
      }
      function rr() { if (frameEl && frameEl.isConnected) view.render(frameEl, null, true); }
      var view = {
        title: 'Music Quiz', kind: 'custom',
        render: function (el, f, internal) {
          frameEl = el;
          if (!round && !internal) { score = 0; selIdx = 0; startRound(); }
          if (!round) return;
          var html = '<div class="ipod-bar" style="margin-top:2%"><div class="fill" style="width:' + (round.left * 10) + '%"></div></div>';
          round.picks.forEach(function (si, i) {
            var cls = i === selIdx ? ' sel' : '';
            var mark = reveal && si === round.correct ? ' ✓' : '';
            html += '<div class="ipod-row' + cls + '">' + String(lib.songs[si].title).replace(/</g, '&lt;') + mark + '</div>';
          });
          el.innerHTML = html;
        },
        onScroll: function (dir) {
          if (reveal) return;
          selIdx = Math.max(0, Math.min(4, selIdx + dir));
          api.tick(); rr();
        },
        onSelect: function () {
          if (reveal || !round) return;
          if (round.picks[selIdx] === round.correct) score += Math.ceil(round.left * 10);
          endRound();
        },
        onExit: function () { clearInterval(timer); qa.pause(); qa.src = ''; round = null; }
      };
      Object.defineProperty(view, 'title', { get: function () { return 'Score: ' + score; } });
      return view;
    }

    // ---- Solitaire (Klondike, draw three) ---------------------------------
    function solitaire() {
      var SUITS = '♠♡♢♣'; // spades, hearts(outline), diamonds(outline), clubs
      var RANKS = 'A23456789TJQK';
      var g = {
        score: 0,
        reset: function () {
          var deck = [];
          for (var s = 0; s < 4; s++) for (var r = 0; r < 13; r++) deck.push({ s: s, r: r, up: false });
          for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
          g.cols = [];
          for (var c = 0; c < 7; c++) {
            g.cols.push(deck.splice(0, c + 1));
            g.cols[c][g.cols[c].length - 1].up = true;
          }
          g.stock = deck; g.waste = []; g.found = [[], [], [], []];
          g.cur = 0;       // 0 stock, 1 waste, 2..5 foundations, 6..12 columns
          g.held = null;   // { cards:[], from:{t,i} }
          g.won = false;
        },
        onScroll: function (dir) { g.cur = (g.cur + dir + 13) % 13; },
        onMenu: function () {
          if (!g.held) return false;
          putBack(); return true;
        },
        onSelect: function () {
          if (g.won) { g.reset(); return; }
          var c = g.cur;
          if (c === 0) { // stock: deal 3 / recycle
            if (g.held) return;
            if (g.stock.length) { for (var i = 0; i < 3 && g.stock.length; i++) { var cd = g.stock.pop(); cd.up = true; g.waste.push(cd); } }
            else { while (g.waste.length) { var w = g.waste.pop(); w.up = false; g.stock.push(w); } }
            return;
          }
          if (c === 1) { // waste: pick top
            if (!g.held && g.waste.length) g.held = { cards: [g.waste.pop()], from: { t: 'waste' } };
            return;
          }
          if (c <= 5) { // foundations: drop single
            var fi = c - 2, f = g.found[fi];
            if (g.held && g.held.cards.length === 1) {
              var card = g.held.cards[0];
              if (card.s === fi && card.r === f.length) { f.push(card); finishMove(); }
            }
            return;
          }
          var col = g.cols[c - 6];
          if (!g.held) { // pick the face-up run
            var k = col.length; while (k > 0 && col[k - 1].up) k--;
            if (k < col.length) g.held = { cards: col.splice(k), from: { t: 'col', i: c - 6 } };
            return;
          }
          // drop run: deepest held card goes on the column
          var bottom = g.held.cards[0];
          var top = col[col.length - 1];
          var ok = top
            ? (top.up && bottom.r === top.r - 1 && isRed(bottom.s) !== isRed(top.s))
            : bottom.r === 12; // king on empty
          if (ok) {
            col.push.apply(col, g.held.cards);
            finishMove();
          }
        },
        step: function () {},
        draw: function (ctx, ink, bg) {
          var y0 = 3, ty = 34, pitch = 22, x0 = 3;
          function cardAt(x, y, cd, sliver) {
            ctx.fillStyle = bg; ctx.fillRect(x, y, 20, 27);
            ctx.strokeStyle = ink; ctx.strokeRect(x + 0.5, y + 0.5, 19, 26);
            ctx.fillStyle = ink;
            if (!cd.up) { for (var h = y + 3; h < y + 25; h += 4) ctx.fillRect(x + 3, h, 14, 1); return; }
            ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
            var rk = cd.r === 9 ? '10' : RANKS[cd.r];
            ctx.fillText(rk + SUITS[cd.s], x + 2, y + 8);
            if (!sliver) { ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(SUITS[cd.s], x + 10, y + 21); }
          }
          function slotAt(x, y) { ctx.strokeRect(x + 0.5, y + 0.5, 19, 26); }
          // stock + waste
          if (g.stock.length) cardAt(x0, y0, { up: false }); else slotAt(x0, y0);
          if (g.waste.length) cardAt(x0 + pitch, y0, g.waste[g.waste.length - 1]); else slotAt(x0 + pitch, y0);
          // foundations
          for (var f = 0; f < 4; f++) {
            var fx = x0 + (3 + f) * pitch;
            if (g.found[f].length) cardAt(fx, y0, g.found[f][g.found[f].length - 1]);
            else { slotAt(fx, y0); ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(SUITS[f], fx + 10, y0 + 18); }
          }
          // columns
          for (var c = 0; c < 7; c++) {
            var col = g.cols[c], x = x0 + c * pitch;
            if (!col.length) { slotAt(x, ty); continue; }
            var downs = 0; col.forEach(function (cd) { if (!cd.up) downs++; });
            var ups = col.length - downs;
            var upOff = ups > 1 ? Math.min(9, Math.floor((H - ty - 27 - downs * 3) / (ups - 1))) : 9;
            var y = ty;
            for (var i = 0; i < col.length; i++) {
              cardAt(x, y, col[i], i < col.length - 1);
              y += col[i].up ? upOff : 3;
            }
          }
          // held run floats above the cursor
          var cx = cursorX();
          if (g.held) {
            for (var hI = 0; hI < g.held.cards.length; hI++) cardAt(cx - 6, 44 + hI * 8, g.held.cards[hI], hI < g.held.cards.length - 1);
          }
          // hand cursor
          ctx.fillStyle = ink;
          var hy = g.cur <= 5 ? 31 : H - 6;
          ctx.beginPath();
          ctx.moveTo(cx + 10, hy); ctx.lineTo(cx + 6, hy + 4); ctx.lineTo(cx + 14, hy + 4);
          ctx.closePath(); ctx.fill();
          if (g.won) { ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('YOU WIN!', W / 2, 70); }
          function cursorX() {
            if (g.cur === 0) return x0;
            if (g.cur === 1) return x0 + pitch;
            if (g.cur <= 5) return x0 + (g.cur + 1) * pitch;
            return x0 + (g.cur - 6) * pitch;
          }
        }
      };
      function isRed(s) { return s === 1 || s === 2; }
      function putBack() {
        var h = g.held; g.held = null;
        if (!h) return;
        if (h.from.t === 'waste') g.waste.push(h.cards[0]);
        else g.cols[h.from.i].push.apply(g.cols[h.from.i], h.cards);
      }
      function finishMove() {
        var from = g.held.from; g.held = null;
        if (from.t === 'col') {
          var col = g.cols[from.i];
          if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
        }
        checkWin();
      }
      function checkWin() {
        g.won = g.found.every(function (f) { return f.length === 13; });
      }
      var v = canvasGame('Solitaire', g);
      v.onMenu = function () { return g.onMenu(); };
      return v;
    }

    return { brick: brick, parachute: parachute, musicQuiz: musicQuiz, solitaire: solitaire };
  }
})();
