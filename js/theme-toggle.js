// Theme toggle — the drawstring sun/moon (ART-984). Light→dark: the sun retracts its arms,
// spins in place morphing into the moon (overshoot + wobble), hops, and pulls a drawstring;
// the lamp (css #lamp + the canvas blend in js/pond/book.js) comes on when the string lands.
// Dark→light: pull the string down, rise + morph back to a sphere, roll left, grow the arms.
// All numbers were tuned in lab/theme-toggle.html on feature/art-984-theme-toggle-animation.
(function () {
  'use strict';

  var btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  /* ---------- tuned values (the lab's readout JSON, baked) ---------- */
  var K = {
    spd: 1.95, stroke: 1.7, strX: -4, sndOn: 0.76, sndOff: 0, swOn: 0.45, lightAt: 0.66,
    arms: [570, 1], roll: [450, 0], wobble: [990, 0.3], hop: [295, -1], fall: [100, 1], ret: [700, -1],
    rpull: [140, 0], rrise: [220, -1], rroll: [200, 0], rarms: [225, -1]
  };

  /* ---------- fixed geometry (viewBox px) ---------- */
  var CY = 22, R = 7;
  var SUN_X = 20, MOON_X = 20;       // no lateral travel — the roll is a spin in place
  var RAY_IN = 11, RAY_LEN = 4.5;
  var BITE_R = 6.7;                  // bite circle radius — ratio copied from the old moon icon (6.6/6.9)
  var HOP = 4, OVERFALL = 3;

  /* ---------- easing + keyframe tracks ---------- */
  var E = {
    lin: function (u) { return u; },
    inQ: function (u) { return u * u; },
    outQ: function (u) { return u * (2 - u); }
  };
  // accel -1..1: -1 = ease-out (fast start), 0 = smooth in-out, +1 = ease-in (slow start)
  function curve(a) {
    var w = (a + 1) / 2, p = 2.4;
    return function (u) { return (1 - w) * (1 - Math.pow(1 - u, p)) + w * Math.pow(u, p); };
  }
  function track() {
    var keys = [].slice.call(arguments);
    return function (t) {
      if (t <= keys[0][0]) return keys[0][1];
      for (var i = 1; i < keys.length; i++) {
        if (t <= keys[i][0]) {
          var a = keys[i - 1], b = keys[i];
          var u = (t - a[0]) / (b[0] - a[0]);
          return a[1] + (b[1] - a[1]) * (b[2] || E.lin)(u);
        }
      }
      return keys[keys.length - 1][1];
    };
  }

  /* light→dark (T) and dark→light (TR) timelines, each normalised 0→1 */
  var armsEnd = K.arms[0];
  var rollStart = K.arms[0] * 0.4;         // rolling begins while the arms are still coming in
  var rollEnd = rollStart + K.roll[0];
  var wobEnd = rollEnd + K.wobble[0];
  var hopEnd = wobEnd + K.hop[0];
  var fallEnd = hopEnd + K.fall[0];
  var retEnd = fallEnd + K.ret[0];
  var TOTAL = Math.max(armsEnd, retEnd);
  var n = 1 / TOTAL, w = K.wobble[0] * n, r = K.ret[0] * n;
  rollStart *= n; rollEnd *= n; wobEnd *= n; hopEnd *= n; fallEnd *= n;
  var apexT = hopEnd;
  var T = {
    ray: track([0, 1], [armsEnd * n, 0, curve(K.arms[1])]),
    cx: track([rollStart, SUN_X], [rollEnd, MOON_X, curve(K.roll[1])]),
    bite: track([rollStart, 14], [rollEnd, 7.0, curve(K.roll[1])]),
    rot: track([rollStart, 0], [rollEnd, 138, curve(K.roll[1])],
               [rollEnd + 0.26 * w, 148, curve(K.wobble[1])],
               [rollEnd + 0.58 * w, 126, E.outQ],
               [rollEnd + 0.81 * w, 131, E.outQ],
               [wobEnd, 130, E.outQ]),
    dy: track([wobEnd, 0], [hopEnd, -HOP, curve(K.hop[1])],
              [fallEnd, OVERFALL, curve(K.fall[1])],
              [fallEnd + 0.7 * r, -0.6, curve(K.ret[1])],
              [retEnd * n, 0, E.outQ])
  };
  var pEnd = K.rpull[0], riEnd = pEnd + K.rrise[0], roEnd = riEnd + K.rroll[0];
  var TOTALR = roEnd + K.rarms[0];
  var m = 1 / TOTALR;
  pEnd *= m; riEnd *= m; roEnd *= m;
  var TR = {
    stringEnd: riEnd,   // the string exists until the moon reaches the top of it
    dy: track([0, 0], [pEnd, OVERFALL, curve(K.rpull[1])],
              [riEnd, -HOP, curve(K.rrise[1])],
              [roEnd, 0, curve(K.rroll[1])]),
    bite: track([pEnd, 7.0], [riEnd, 14, curve(K.rrise[1])]),   // morphs on the way up
    cx: track([riEnd, MOON_X], [roEnd, SUN_X, curve(K.rroll[1])]),
    rot: track([riEnd, 130], [roEnd, 0, curve(K.rroll[1])]),
    ray: track([roEnd, 0], [1, 1, curve(K.rarms[1])])
  };

  /* ---------- the widget ---------- */
  function crescentPath(d) {
    if (d >= R + BITE_R - 0.05) {
      return 'M 0 ' + -R + ' A ' + R + ' ' + R + ' 0 1 1 0 ' + R +
             ' A ' + R + ' ' + R + ' 0 1 1 0 ' + -R + ' Z';
    }
    var x = (BITE_R * BITE_R - R * R - d * d) / (2 * d);   // bite center at (-d, 0)
    var y = Math.sqrt(Math.max(0, R * R - x * x));
    return 'M ' + x + ' ' + -y + ' A ' + R + ' ' + R + ' 0 1 1 ' + x + ' ' + y +
           ' A ' + BITE_R + ' ' + BITE_R + ' 0 0 0 ' + x + ' ' + -y + ' Z';
  }
  var rays = '';
  for (var i = 0; i < 8; i++) {
    rays += '<line y1="' + -RAY_IN + '" y2="' + -(RAY_IN + RAY_LEN) + '" transform="rotate(' + i * 45 + ')"/>';
  }
  btn.innerHTML =
    '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true">' +
      '<line class="string" x1="0" y1="0" x2="0" y2="0"' +
        ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0"/>' +
      '<g class="raysG" stroke="currentColor" stroke-width="' + K.stroke + '" stroke-linecap="round">' + rays + '</g>' +
      '<g class="bodyG"><path class="body" fill="none" stroke="currentColor"' +
        ' stroke-width="' + K.stroke + '" stroke-linejoin="round" stroke-linecap="round"/></g>' +
    '</svg>';
  var svg = btn.firstChild;
  var W = {
    raysG: svg.querySelector('.raysG'),
    rayEls: svg.querySelectorAll('.raysG line'),
    bodyG: svg.querySelector('.bodyG'),
    body: svg.querySelector('.body'),
    string: svg.querySelector('.string')
  };

  function render(rev, v) {
    var S = rev ? TR : T;
    var cx = S.cx(v), dy = S.dy(v), ray = S.ray(v);
    W.bodyG.setAttribute('transform',
      'translate(' + cx + ' ' + (CY + dy) + ') rotate(' + S.rot(v) + ')');
    W.body.setAttribute('d', crescentPath(S.bite(v)));
    W.raysG.setAttribute('transform', 'translate(' + cx + ' ' + CY + ')');
    W.raysG.setAttribute('opacity', Math.min(1, ray * 4));
    for (var i = 0; i < W.rayEls.length; i++) {
      W.rayEls[i].setAttribute('y2', -(RAY_IN + RAY_LEN * ray));
    }
    var strung = rev ? v <= TR.stringEnd : v >= apexT;
    W.string.setAttribute('opacity', strung ? 1 : 0);
    if (strung) {
      var sx = cx + K.strX;
      var lift = Math.sqrt(Math.max(0, R * R - K.strX * K.strX));  // ride the moon's edge
      W.string.setAttribute('x1', sx); W.string.setAttribute('x2', sx);
      W.string.setAttribute('y1', CY - HOP - lift);
      W.string.setAttribute('y2', CY + dy - lift);
    }
  }

  /* ---------- the pull-string clicks, trimmed from one freesound recording (38279).
     Web Audio, not <audio>: decoded from base64, so a delayed trigger is never
     autoplay-blocked — only the context resume needs a gesture (the press provides it). */
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = AC ? new AC() : null;
  var SND = {};
  function decodeClip(name, b64) {
    if (!actx) return;
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    actx.decodeAudioData(bytes.buffer).then(function (d) { SND[name] = d; }).catch(function () {});
  }
  decodeClip('switch', 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMQAAAAAAAAAAAAAA//twwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAMPgAzMzMzMzMzMzMzM0xMTExMTExMTExMZmZmZmZmZmZmZmaAgICAgICAgICAgJmZmZmZmZmZmZmZs7Ozs7Ozs7Ozs7PMzMzMzMzMzMzMzObm5ubm5ubm5ubm//////////////8AAAAATGF2YzYyLjI4AAAAAAAAAAAAAAAAJAPMAAAAAAAADD55FrXfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7cMQAA4AAAaQAAAAiB52Thp7wAEf//40/VkEv5c3IfAOQORSg5BYGEg5C1tSIY4NicQxkay3j1kvXhNyXvjkNBUVY2eJl+zzsByKBdj0HAuzTOuEch0PTkUEFXq+eA8ielKe7+Ph/H9KU+b6///79QRU+dbsvgtg/FyGoHAynOXNR2eRN4ILBAuH/9QYEhwH1HGf//DAOi2Wu4WzyZiwWCQOAP//MwgAUI/4fRMWHGRLWBgwkLCANQTZ93nmUBiSB6lQZQH//ysIBIimgZ6GiTr3v+DAQ2drNxRUVhouMJezaxkyED//57NAuDmIgZqBoBjCEJqKQMSDhow////dsDCiRDJKesFAcyoWHAkxENXRBf////w4+7T6R2E/wcFl4wcKoLPa85gwgakdf/////pqTLvl8HEv/+3LEUQAeJZc5ub2AEv4spe+xgAAUUNxceHAMGBwaBAoFDjyFmwgAWv///////2MOTncPzzscg9coFAQECsXLvuwuichtZf///////////////////791amdHO26komXcjEstu/1EBgAbDssEbC5bOS4y7m8fCHG+bBTv6KkBQhaTG2YurK09W2whl0leSm1di0bdj3kgZeJdlT0OvOxWxC4tKX4rWoNYzYeBpIKKruxKpq7F5qVTbcWUsMh2AKVxKKs/8YksqjcRhiU23ejV+ms401FYhUidGHItuQz8qzcp/pdqs+07rO1XlsslVberPbFfUioMc/ysd3epcru93/5Xz1lf7q/l3v8/f63+sef+X//93+8d1LyJoidCqUtW7FCNJ0yAAAA1r7Pi8tyrN9dqFQ7YUyQMdP/7cMQLAZItHy1nsNwCPyOk8PYPkCRjqpUyMcqp1IPBgYcoc6UVFaeSNYjPhsTEzq1Ti0p2sdVkBIlUK86kQ2smp1TlGDfTaGFcJAIsJkR2NSVwtxG5mSSCdWieABoaEhaA4FJAg1EeRPPbiTbJb2PHCgUZ5o1ku1ubk/t8yYSMoJCoKE0lp0kKMXWe0UP7IsHYWA2sQ2Ermg8j3gnoozx3Me4QoNU2l6hwufOCMIQ0vz6atsMVtka5Vaugkk7BRuPJARTqOl2TFAPUKdhgD1UZVqJNcZwfqFpcG8I/RnxQFIGFl2fWOusFseCqigOFp/BxsXsSUIRkwdsJeMsnTuvbdqerUSiG8Tb3F2qyw6wpt67CMq0zckVAXIrz2tzylSoNxNAAAABWvdxjViq2ZJIpCHFxPUR0v6r/+3LEDAGQUP8nh7DcAkWj46GGC5BQ9Tsl21huqU4WPTzPWYDY3TYiPjFfI9UqUwXqBbYKG7fGatncuB4dafUlRKRL/GKx8KjBewYmqYv8aHBvu1oBNEByxxFJf4ckvwOBtjVKSM/tGW77W0b9culrRBFaJkMhIiIVLPayW5Du0aAHLtekYvFKS7Vhp18pA+0Ap/JpqkbZuExL31lsAu5XZfYgOmyd19bEQjrcoZUBf1rUAOnROlEdNwgNu6uJc9aH7OhJ7LGQN/nMuTK86J9jsHB2B0cUA8HI+HW5dWBL55HDic2bueKzl5kk3KxmnsXyKmbKhaf5qLVuUbOXGyILYrlZ/4MLZHhi0eVZZvLHr9MWxAAAAvmMYjk3RtAfuD4OanWoYbZCIJizVTKQaowyUSGJx1rtM7cce//7cMQUgJKtKxksMF5CaKHiHYYPyGKUbIG6Vaspb6VRuFR+dhLcICdNmMdiK8ZC768YdToHlNypZY17nvy++U4t+9J5XFOZ0ebXaSXvLJErVR8gNliEfllYYlkyuLLPsswHO1TpTFe8hpnsb69vOxKXR/PIcwNfogULC6Lv4ipTxKIAAC8oKrIoJlKsTivvQsxvy2ZvkTUcWFpEvJy67Tqrxfx5ZdLmtzrPuwmQP+wbBuZYMmfIGaTNC0eELpmXQXsxwvEvZkynCB6gCr7My5Lvq6gZxlpKGwhL5uVA6UPtxYamC4rsSmBSwZgZqtgsIR0SyTzZ4rUYU154msnUtGMavGHmjJ6WZkM9hQCDURB+YZZKmgSocpv8j/lVIgA0zcdx3BeI9MtRutKOiFtVqLSYLwTJCxYkIUj/+3LEDoCSJREOp70vylMhoUT8PwGLNBSoN8tq5XMTxaKBkRc5Kj+OE/FWrx9l1JYMtKnihxrm4hg+AJUfxLi5ANUzW2KY8CamgXMNWQwu2E8f6Gn+X5rjm7WEKzoENjJlNddhckOookLg+pRMoiSGEaE1RmH85QUgwqoqu7cYf1upJLz+SfaXUgoh6GYmCTDrQxMDfU9E4dzMfIB6iRDS/Ge4pA/SCK5Gm4fFmU4FycsQ72ptRYjwF5ka0S3uSp449kaay/48ZnMtTABigsCfgrkCjEozDqVZKU6aZIUokUS9d5eD/WzxpDJYVR2KZJKV7aG+TEzhrDXXEVvTtmJXv5XjdEZqTXbbsV633alsyY8/c6RJYAkO96ILNy3KMIAAADBz54sBgJx0YF+NP3MQDkDdeH4YH5aicP/7cMQOAI5o9RLmPToJzRuhmJelubpcTmrVY1fGG2Ol4isKFVlrC1ezY+NcdPmEPULcVimj0qzqlocCdhD0LiFZAjNmaLuXMBoESWWVslXK3q8YW0wuQakqxXuPt/8Yu7bKoND9/e/c3J0eFsCAORYGUQNNFlOGiBc6hbcCiFCYyenkc3rLdBKOWSKnn9WxPOLAjRizuKiisquZnVnrkzrT5JhWqgsSLht8sU/zdaGP2RfUZVQnVcqaKDYZVkdgxFkgNGZOTgeWg2wyvBVXGvyUX+8ZY/0gskD7f+M/aLjaBEW0gABPDVk9AWUtCw5OsXtHkb8HARUtnhAhB82hNfGFqrXHoMybOPmrFGzHmTi8xkWLlpfz9J4dpun2cNe+spBubuM8PGryvZuXEHZj4REhIjgJ75jUpXD/+3LELIALnNsTR6TRQgMd38GHsfHLjodXOt1EJV8KlfKKw87sbdCLx6JOg28Ya6qzhZ2iA4JAXdgNuSDY/pETGUahN87VUo3kNsdE7VBkqhiVLcI0VyKDiF0JSv1tKrhZinYWwSUo2KjRYPC0HLbFi0wDUnH5uklDMWjg7ND50nIjneZcO0TLKIkx5N3Hv3HtoeKSwkPcbgONAAAAlIRoTdbZbFZcKiVYuAkPcHoDyNblisIz65c9lt6z2kkm0+tDJczR6yYQgbCMfQEonIZNYen0wJD8yjJpFkZbTUacjppEFAKq/NRannPUsSdGTUXVuqPd0Su+SYM/9gxCWjEJaM2v6wqzUoMJMuNjcmnjc+yhLJpJpJnBkFQeGyi5w6HhsPjBdBOE4TnCbmkJEVOFjpxMsIQWA8HAOP/7cMRQAg1A1v5ksM3BiRoVWGSZ8Gyi8XFwzs+bLPebn9ScDCSiyixQGBCgMw+AcBwVFTIxtILCwqI4qzWKi3/61UxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=');   // the wall switch: lights-out, plays the instant dark begins
  decodeClip('on', 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMQAAAAAAAAAAAAAA//t0wAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAYAAAcIAAUFBQUHh4eHigoKCgzMzMzPT09PUdHR0dRUVFRUVxcXFxmZmZmcHBwcHp6enqFhYWFj4+Pj4+ZmZmZo6Ojo66urq64uLi4wsLCwszMzMzM19fX1+Hh4eHr6+vr9fX19f////8AAAAATGF2YzYyLjI4AAAAAAAAAAAAAAAAJAKgAAAAAAAAHCBnSMvtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//t0xAAAAFACAA2AACF/qOEoYYrzPKrQoT0KKLckHkM55WFeC1w+w9LQ55wQDnKIH7D0QLTA2J4lA4Lgii08IKAEJzz/Qg5hBFT/zSiHhbu5hx0porx9Cp/1zTpxDSxPDsLABAcXE3z2VyMdn//cgMcWRLGfSGKqAAAJCldjQBRxTIAWTymXxtnceii+hICNoB3Ll17eco3VizEThlQ4CJwXAAwZoMAowEFBY8EyBHisBsQOs+DqUk/xscXRSMcE1zTPZNFsSGZ8LACgD8mdgPWqiS4cOB4fhlIsCCBAErGQTHLBS6C5f9h7y01DPzeeFwWItENXR0zLgiFcd44s5LCOBRC7T4d7l/PfeOtEIKUXREinn4Tcs/oXiv//xSSx//t0xFQCFf1dB6yxHgskqCI1vLKg8QKZA77yx6wAdjkZJATrEhGBrUSdRlERi8FLdtxKLRS3u5Yfys0kGj5lpODQk1ONO7HRxYNIaDWhgylDk2MJ8lDGjAMGvsvsuFh0EuRE1NXHjaNodOayzvGYcdWyGpnmggVbJgAojtxQkPOo4EQAKdMxbgNNAAEOSJThhbfvuwxy7M2/BiURwkOCktjBY1Q7rHeXD2P8SIJ0xVDdDHdYsjeLeFiOImOrVb5geb6cniWOhTQoUNcek9RXKcdxtsQdKRm/9NKb9LOg64WkDhFvqBMEWQAMKsx4cvrv5EKsqlFG6tYVM4Lc6ljKU2ZBYbiFnNMAyFalpJTraP5Wg9g61lBEoMQnjK6nY42n//t0xB0AlblRGQw9FcneI6SQ9hqYM90EjBjtQiphEyC7LgcE7Uk5rj6Js+KEt6+pVTSaF5Y+Ic2XJlfJyyomZ1bPed5qU5U5p3KyKVucdq52pVhwy9YEooS9i5iJnip1G9TvaobqEyvkS5NTY0N8e5NFESpIWOMERbGj3/uP5/F1Sv6HW9xmuxEpGwyAOwyn8cfbI9Pw95bE8M065Cbt0FuOS8A5E6oCdmIKWm0mdgyEhjHXCYlUVfbcfWLm1kA0BIVD5KvMXVmRYAg1AQGho8s51Pbemixg3g7SEk4zT88S2xlyUPiIr5eGuqzzP3Ma0/65f9zpiP7GBwJj7U1/xWpoyMUADLB5mWTEEaJJCi/U1GGiIvoJmSPq98/hMRSI//t0xA+AkNklJIww1wItpOVysPAAWmOIYKUOSLLQEN3f9MSJQLeh+8YeH6x7kEsDvp0MDAak1QAi2HjZ60uyEtFo4QxJojH95PEhUmZn4XFullzW3Y2u2ZLYxlnSA2YeytypTzTC6XE7LBZtQhGact3RjG9fGRNjHO6NFSFTYQQAAwIUREh5/JOs142qiQHu5ElF2ltzdWLxs77vXcZILaKMU0AlZMCeDCMVcwXyuYSFnRjw5WJIIFTmMqGRCiSmhpPN2vBYLIZMyql9GRz+W1cf0/7JZ9FzNibcKBnf3u1tSfLyzykPThqD6W98y4+v/62qz/cHdc+Hq+/Nbci7ZAyB17Ohdd311QBY2w2EAiABCKgQHABFHtTaGrnMeA7U//t0xAuAEc13Sbj5gAoKKG33GTADYx2TUOKp1GYHVFwWeAakspoGhuwA3w/YDZAwKrLPQGIAaUgFP5DzTdE8SQbYWoeAxMjBzZbWXhgMW8lBKBUOOZpOpSVbapOInzQ3Fxr/dqH6YguHzjJougXNFeuU9aLp8qJEAKhUM3QQYoL////y+pBi+mqtyfHyOJtJgIAAEAgIAgIGIBXcBzAYaEg0NE0vlGoiAFYvggKBtqsVrLAYODLQcuKaSRATM+6hgJEaQas6xuOtiRHWicPpEz03IEKUNyDoHiKpJJHDhw8/J8ghsOsrEmbuZfrV5MHDxbPZtUbdSNT/KhFyWTQQ17I0deiqv3oJaabmblx+ZAaWQAIgAAALE6FCHTFLCi1K//t0xAiAkGEnTdz3gAHrJSfxhg6gJ6ZwzRRK4vyqjobHzPM2OQ3hNmIXINSHVBgPl2TmTC7nUzEh18RpWXcF7FzWCsnKijyZJ0CiWXLM3Pt4g19IdvvDDFxeDWtc/5+bfNrWzi1s6i4vXXxvWP8Z+rZpDrn41929paxcWtjEK2/WDT/3f1WpGcQKAAFKDDXWLSCCZyJuC4MYHlVYGrUcZfPWderGHJUvaW840li1LAqYd2mWRBAMO6w9payluBnzo6OjmAKgWOzQAUQiQ8BMdvqpapEuWLjx7+ahFsGFiQpM3eOGEoMtJYVyouSOvscmcF2KpWMzm4QpRh2Bs9okv9BKD9AJABJMTKmtSprLC8ey6sOl9DjhONT0kDSrONMz//t0xA8BkWELMow9NMnqIeXtpg7ghtNIJoNnRSYGnsvNO4gIHwf6qbz7RRzITDcW9GxHGR3GcH8h+misRVgcQ8wpiuUjkWwkIGWBQTSFIKGxSNQ6EwPMkQyBkhif82DxYni61CGI50KTREutupuV7MGlcnNZZeLOKf/02soLYssMBQ7QDiOKyVe0RQ7tdjEPRlHVVkQruXuOS+k3VhT+l9Ag8XtJQrTHYYG7DXV7vFD9mCB7PyYSTAvvdBLS1Kv5IlbxQHRYQwPB8OzIBH/SL2UIutoNIpm3pzlcxa0+7voSr9swJwTuMEFT0f+TDHkgqwYOJz/Igq8EHnf+ij4pAAAABMEXlGNk1DR3/qVmjzr5NNmYOiF/kxG52SLyLokQ//t0xBGAjkD9K00weIGplqRht7JQQlCMEZS7svcKFUsUsxZcr7wLZlMojNI79WXPMa9q3x4FYlh4lJqirnNussue3SP2bmKD6ucI2dyNnz9VhPNSX/z+RurwGHVRx3kSX//9zRkiAAYleiz3B0+y2S/fsNZcaXO9O00SmbHaKq2FMSIixCQEALNN6V4KUymFqVR3jeOqnYlZWXvmT3TpVEYHKUJhKMxpcLA5LdtE2t72q4u+u53wT/UvWrIuk7AR4itz9doNDxwdUBRh5/JVABIAADFsMpl3VhqGY1e3LWtuhD7dWsZP9PRKlmn9SpcVCQxEwcBMEEQ4CXdGG6rVmq0tZirqMQqH8Z7HDY4K8vWJ0xN6A6jOjoeymAM8hcv4//t0xCiADcz3GQ2wuIGpl2KZt5qY5K3vrnvzJKFCQcOacuzt6Kat1RS1bv7IZhIGOr1gcBFAzF7M+cCksbobnMJQjLTV39kUsnL1FK6aT8XkQBaIkJIh5Y0ZThLaKYfb2RJn+jm6rnj6rWseA1Q3+oEKz8V1FKR2bpsoMFXIw88AGUl96F9uTx88R9SJPJkSqf3KUeSp/9///OcPoQDMwfT7QhJF5nVm6XOddNmli7AOUu5YoK9JNPs0EoCQMGjwUma6tUUAiWq/zK9ckgKrlfs1Wi21Kcrg0xEVaOTYcnB4hqEhitq4Y0BzXjU1h/0bn/2XznyutHJ/e/OV7iw90gI0hKDUIqCAKrqy81LWrNxajNxj7UZ/Cnoqe7FwSpCg//t0xEGDjGzFEC2wdNGdlKGFzDC6CmA6rLiSogjc/t4m4UxeeR41j7jfWfurPmLv4Th+cMB+EqFxxpbf/tDb5n6dLS8LG4WJya3Sbj4g7QRM/cVOytUkSOqnv7ulIAyGoJiz5ZrVjtSXcqMocyNzyv8bywJ2U5DgM9mHICkH5Apg5F83QFsRs/GiO8iXfnWwJRdpejw00aPtBoYsn+l3BRtrAKBKAcHA8c9kM347fgwaLkA0BoP3ZEk9+xiFn6JZAoo+FPe//9Bfp34MsJAAJsIlyi3h18keaEeymiXg5gQICcbhJmCYuA+zJRxFrzZEbFExK9Sy7hyx8q1KlaTFjlPVmPcyEhAYnajUceRWjCRMDBDEvkR9vT04QpKGQr5K//t0xGGATfEPFC29DdHCpONU8wuYGZl7sQhtkybRZ8EPFa7du+3Z7lkzwsnRUdmb6DOqAFAaYAWgLjUHE3z5fQyl95AeXyxnB21CHxMiVmkYxnDGPRGR5FpUSFtTlmKtKiUFh5gLhQKDwIt8RtpT7ZAISUQLilnz3/8qSGPsN6mfzI1yv51uEo7dRSctLhwQdmRW93M2mkwcFF8HSMgXEKuAyAdO32f8wtYlmOjSZvZ9FYbpMm5sqw5DlGFeFcoQ2ozA1T/zfrFZt98dFYA4OwPcaxKFGYtNoM+a/8YQUyJFe3Cq0pZzjCmHQ2XRyHnFXBIhSPrKi7Y8ZdDzV9v/lMUHgEBHv9XpAR5AAD/B4V1vMJ7rXhnspkZh72Rnla0P//t0xHaAzYELIIek1sGkJKRg9iJYH2fpahViwBwC2HSlnzLHnfq+lqaxeDvPvO1l72eDC0uLlmWshzpawsETFHr+bPv9gcRkmPkRHPdF474fpsQhYonjVGCuDwmQA8C557DboUMN0/3vvx7l3cmVKCo4CRrk5fL8pzGrZyxj87RS3LG5lLI7PthfxjZElVigbKwY6XVHYcVji3uzvnKJyuNIGi9GfIb2Iz5seSCYDo86DG/i11Ip529rMqkIoQWlzcJYLEOBw8dCDSJo4JTmqT66GVaMbDV4p1uXbOcJ0gYyFABt5t9bCOieGX53taiKnNFRX7iXgMicEsfpbQ/AqiwHIc8a1J8P9a1T7f3mu/RTemxJII9ZoKizyVjjOL5x//t0xJGAzlUtIQeZHIm8pSRhhiKYgaTbVO/CcmIIAnhUrRHgtyFUauOgu5U1Mk8crLIxwDjyCXH+MG7f98B23P2syBOUV2h0UgAQkYDNxm712XJXG7yqrCYc+neiXs7i1OfYSGAKDrWHoeQ+AZAnI42GkesaDorue1GQ+lTxGGgd5/UtZlLD8sblAIhGP1Ti/2V6Tv2MYcqUbd/1MbLNEEELplb0z6JebqzNvhkn9+xn9zfsYaDvDMJl89WZiIV3VSFDFSFktqpMiIeImtPuLb0qRqeqgxozBQcKmmXs9Q3MYKS4PbTMcRFgDMyQAEjWDfhk5Og3hNAKAGodZOl0xi8QokiAFeKSMfsTkvXRwIdIaBLxMx1MUpBhM1guESC5//t0xKYADhEpJow9DcHapSa6sLABvGcKNoJ6CgLehSOPd66ZstioL0Qhxjk8faL8uYjQeeoUkWCzPokiscB4F/c1PFy0qkgci2WH5e6k3BwDfTYSslCUJYsXODRdkUGsSM00LVr9BzbhQo9Yng76HkIVqrZzsJIQhCMuo+o8NlW2JEIvyuD2MnEWdtIiIICACEHmEhUzprzT5eymzp0W+poLnNxGeyUkZJogBuOFMcpkWmboFMySWs1R9SazGUB3jxJYlgR4dpemSSa2Mka1JqWiukv+7O3Uz9vrNVoqSNlOmZO9ReRb6kzZNmMja6LGznrm04cUaodhVHBgAQRHp15FKaSEVILf1O97uNJeG1i53KW+7M1NgiLyl/QCmLEc//t0xLeAGxVfZ/mngBGxJKq7stAAe4LljFnrFmv+fu3blUyssRSiOwFfWve7rvIo4wUhQFG/w3Fy1fWbMq/n+dQKmZqqqDOtRvNMGKCmZIzBwdAZDCrgyBmlCkjAQAGgZQNRQa6EtW26rlw1eZtSMzoHz1VsWKvBFZizq9DQhIXpy3PtrZbv1/bbafPxBQ1hTYDoqMP97z8CPZ7kVDjjWLz/l5elo5L39u51ku7R+jtaiyMVllJt3kjXIkXbaSwMms4kaiaqDwmxF1BqQcAACN8PbTRmD38caI3Hhc2zQQVAscgb86WtPcIs2OvvIbcONKiTA7eH39jC1IwWgkkFWkQCsLioiEQdPxT6Ncp2SMHBj1POf/Nf9uSqv/3qs/ef//t0xJqAjZklRcw8cwHEouc5hhphZsGwjXdclay/4FWRhj0SZRqgqedfQzKN4aT/6RtUBAUts7PapaSlmKVuri0WUMzset/VrV8GwmPFb6l2L/GeNxvG+jWGmV6Lqjq0VqWrx4IGVD1GX9gXO1IcpilugwWGInUiRzhUaOq/9iv3qZ+kaev5aB6D7OxhYVmBa3TQRTOCSatLdVHVZIgrJsC0jShYuhVqhAACAPPwJj2drOaxw06L5Y43Zp6L+6a9+MBAEg8zAYhGo7DqFMGZNSQ+Ue1JE1kThO0aCT0SmpEX19TfLY+BV1tf+HZPJt+MmpK5OFsIJ/n/UJtTT+r7HD9o1ljjWYbyyckgN3/Z+cSQABhOAzJ0RZc5OUOzVFrP//t0xLEATmEdMYyk1oHUJOSht6JgCxYlMpryr/yqYVtCMWx1MqmGkS8VjtEKPWL297f2xbEjgVxnRoKTOOe73eIu9Q8lWqCQVqH/UAQ//+RSwV8n9u+4UMQVSh73qUJRCNSaLAudb/1Gf4oqAE8RG0wlB4HAK1p0ZQ/M9UemTX5dBWH48uy6gIsIaV45D9in8n8sx4vnz1INjflmysMTOpVofZoWI2XFCyaJuGk1BDVUkdtOhreYaGaAocRtS6/jRwdk/8iMhONHHZw6coYTqHMYIkUPeJSBgdDBGwkLvdSDv/Lh75CPcfNDEGQDAMv1AMDQxTS+9QQJFNzNFd59LnNWapCAhPKA24yOjPVw1z0V0OZmSSuZnGFM7UhMVUgE//t0xMKAjWElJU0kdVGUm2Mlp45gycEJzLFo90g0ppwXKlTIV8GwcOA3PT+dG89L/rB5XlwQPg4N4qFTD7uAn/S/NQEIfDDD+lF8h5Tpn5eQ6zUPDuMBQCkBAPAIAFiRflwoDc+HX5jFNFeyXVI7eyuKpAB4zA6jlSybZ+kIDPAVt3NEuMrEz6RTVIIOyOkykp0Cxx3x6w21lpVUxV46kNRmEK7lr+NpG6C0RYSFqvvw6gtvEBZCOQxBFhlkYzYQdvK3Vxucj9yN/mKZ87ozDkF3VNHznfGLfYGeBURlYaiwuWm2daqtzda0HxqdnIawlmVi7KtR6mMDAWL0Hg5bjL6YSrWyjKQRI5XQ26wcgVMDE4JRcPTE6cVXUIl5KNQk//t0xN+Dj5EjCi68r8HSJKEB545gcGxqnM/+6VvctVY/gfon+kzdavQsxJsD4ncXya9lr/k/9L/klPk2a/9T65MTzJLFabi/xYWr2PE97UdJzKdjKllWU8oamTgoHOY8UOw1jI6aXU927di0ivWqtylmhkBUFXVkLMbrV73o9Ku0pLKzw8sAohkh8KG/fdhs4tiU+UVUwkSR1f1aU4mqGEFHo9RyvmNOxKEVpTvIdkdT9GkIpyT1efGjyZGQk+JBMTRUPmEW/7iHlK044TDz5IAxCkmm1GT0lMDKClNPN1JLTUt/Knr3N0uVPhV5csJLxmuBahYf5q+opyqmwIgGh610KrVyV3UOYfE1KuMuLf/kQwljBhA0XOKf+XUrGqcW//t0xOyD0QV7AA88r8oWsZ/BxiJgGK+qAb0eYSj5XQMBKEWi7kCDQTVSgpGF7/50MZ+RsGBJXVarox1c56kHAVVluX5fDVulZz1PwvN08zq1OJb7XRMmNo/3iHe0RTU3IeiPiUp8aQkIOoXz4gWSjiCBdEVJUSR/0wafv0hxTP+jMYlO6mU2aXgizRXVrz3qIH06a8zAvZAxBQxYhb9nyRBn//Tl7bNqmahqkU2EfegUz/lHKtdRNd8IUntBmZG9uJP23W8lik6QAZIcWchm0lAUAo+osOKgiYIQq5ycn8o1Ok2BEHLZOpFrOKsyhb5Gop5xE7mFBQYjoYpY7QIOiENhCUdNRkvFaYnrH6zi0P6loTQpX8FBcaaJ7OiXzFlE//t0xOsAD2l9Ak4wswHFr2EptApothNiSD0mR0P6PUV4FL7wfUZ2i7I0opHvAFBR2PVuhqCHPOnCA3UDj5HhyBRiAyTSIAhwVYGHHfTCIpwsidYTD8qI1wnJQN0et87zFnKjAgNaCJ6IBUaIXVOkqI+KFWO0xZKcuEKaH1bZgZAkgEYUj7uQLezsGJEqysLA+GRv9kphLA+fSiW42FOi1t9lX2ZwSHCHV63ZCcLp6oy3p0Cd0fPg847uUX8RtKU67JoZ0piHKibXhSRiYRJJ73AKMW1CfNJJIKPyYtLVKfYmmBgSQjXri6gNMqYCa8ae2bckgX16xy6MSzJMKkbqS2CkR5NGXjTKYYmcSrIlj4ZKQWgsWJNlU34ezYOrG1nc//t0xPoDEoWA/k09KcpLMZ8Bx5i4O3CCoqfI7xvypzCrnQpRnEWnLzeWxwtZvjEf5JkYxpxtt5ClP/+Oq+jh/4raIOaFWIpVNiB4LJJVP4nGEZmSKwyRCKDUVh13vwztndG/DkOC4JkgjBM+IAUZIyc8jFbziAwujJC5G2kKHLkeTRo2EDNtsTXbggq22KBnBCVxFd4g1dK4uIIrlu8SVytdkLMbc2EEtS14EQ3m7xEUGW4eQuiN3TTdK/6Vy6fjZk1pwlyJ6ZTpdM0JFEZnwOmR+GYdPgeZH4Zh0/Ay7jxWR7MINCl6FAmDFMEh2KYIjqhCUTmzIybJJZYMgosGJWChMEiVnErIhMEknOSsiixyW0lpqIENCkooKTDQVENh//t0xOwCERGK+i2kycnyr2BZtiCxJRQUmGgqIaFNigpobFYCoTYoKaGxWBsJs3IoNisDYXioTxsVg7hwrJ8LFwVk8VwoNxcFZPFZHDcXBWTxWRw3roRMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//t0xO6D0eGPBA0kbcoPjt/Blhjpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
  decodeClip('off', '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');
  document.addEventListener('pointerdown', function () {
    if (actx && actx.state === 'suspended') { actx.resume().catch(function () {}); }
  }, { once: true });
  function pull(name, rate) {
    if (!actx || !SND[name]) return;
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    var src = actx.createBufferSource();
    src.buffer = SND[name];
    src.playbackRate.value = rate || 1;
    src.connect(actx.destination);
    src.start();
  }

  /* ---------- controller (same contract as the old two-button toggle) ---------- */
  var root = document.documentElement;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t = 0, raf = null;   // 0 = light rest, 1 = dark rest, -1 = animating

  function setTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('site-theme', theme); } catch (e) {}
    window.dispatchEvent(new Event('themechange'));
    btn.setAttribute('aria-pressed', theme === 'dark');
  }

  function play(dir, done, snd, trigs) {
    cancelAnimationFrame(raf);
    var rev = dir < 0;
    var dur = (rev ? TOTALR : TOTAL) / K.spd;
    var start = performance.now();
    var fired = false;
    t = -1;
    (function step(now) {
      var v = Math.min(1, (now - start) / dur);
      render(rev, v);
      if (snd && !fired && v >= snd.frac) { fired = true; pull(snd.clip); }
      if (trigs) for (var i = 0; i < trigs.length; i++) {
        if (!trigs[i].done && v >= trigs[i].frac) { trigs[i].done = true; trigs[i].fn(); }
      }
      if (v < 1) { raf = requestAnimationFrame(step); }
      else { t = rev ? 0 : 1; if (done) { done(); } }
    })(start);
  }

  function toDark() {
    setTheme('dark');                       // the screen fades dark the moment it starts
    pull('switch');                         // ...and the wall switch clicks with it
    root.classList.remove('lamp-on');
    if (reduced) { t = 1; render(false, 1); root.classList.add('lamp-on'); pull('on'); return; }
    play(1, function () { root.classList.add('lamp-on'); },
         { frac: K.sndOn, clip: 'on' });
  }
  function toLight() {
    root.classList.remove('lamp-on');
    if (reduced) { t = 0; render(false, 0); setTheme('light'); pull('off'); pull('switch'); return; }
    play(-1, null, { frac: K.sndOff, clip: 'off' }, [
      { frac: K.swOn, fn: function () { pull('switch'); } },      // switch-on, shortly after the pull
      { frac: K.lightAt, fn: function () { setTheme('light'); } } // dawn breaks early, mid-roll
    ]);
  }
  btn.addEventListener('click', function () {
    if (root.dataset.theme === 'dark' && t === 1) { toLight(); }
    else if (t === 0 || t === 1) { toDark(); }
  });

  /* initial pose: the inline head script already applied the saved/OS theme before paint */
  var theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
  btn.setAttribute('aria-pressed', theme === 'dark');
  t = theme === 'dark' ? 1 : 0;
  render(false, t);
  if (theme === 'dark') root.classList.add('lamp-on');
})();
