// PondFlow — the pond wash re-sampled through a drifting noise field (WebGL2), so it moves continuously.
import { P } from './config.js';

export var PondFlow = {
  canvas: null, gl: null, prog: null, tex: null, ok: false, w: 0, h: 0, u: {},
  init: function () {
    if (this.ok) return true;
    var c = document.createElement('canvas'), gl = c.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
    if (!gl) return false;
    var vs = '#version 300 es\nin vec2 p; out vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
    var fs = '#version 300 es\nprecision highp float; in vec2 v; out vec4 o; uniform sampler2D tex; uniform float t; uniform vec2 drift; uniform float amp; uniform float scl; uniform float spd; uniform float breathe; uniform vec2 res;\n' +
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
      'float fbm(vec2 p){ return noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.1; }\n' +
      'void main(){ vec2 px = vec2(v.x, 1.0 - v.y) * res; vec2 q = px * scl / 400.0;\n' +
      '  vec2 w1 = vec2(fbm(q + vec2(t * spd, 0.0)), fbm(q + vec2(5.2, -t * spd * 0.8))) - 0.5;\n' +
      '  vec2 w2 = vec2(fbm(q * 0.7 + vec2(-t * spd * 0.6, 2.0)), fbm(q * 0.7 + vec2(7.3, t * spd * 0.5))) - 0.5;\n' +
      '  vec2 uvA = (px + drift * t + w1 * amp * 2.0) / res; vec2 uvB = (px - drift * t * 0.6 + w2 * amp * 2.0 + vec2(230.0, 140.0)) / res;\n' +
      '  vec4 a = texture(tex, uvA), b = texture(tex, uvB); float k = 0.5 + 0.5 * sin(t * 0.21);\n' +
      '  vec4 c = mix(a, b, 0.2 + 0.6 * k);\n' +
      '  c *= 1.0 - breathe * 0.5 * (0.5 + 0.5 * sin(t * 0.17 + fbm(q * 0.5) * 6.2831));\n' +
      '  o = c; }';
    function sh(type, src) { var h = gl.createShader(type); gl.shaderSource(h, src); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(h)); return null; } return h; }
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs); if (!v || !f) return false;
    var prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['tex', 't', 'drift', 'amp', 'scl', 'spd', 'breathe', 'res'].forEach(function (n) { PondFlow.u[n] = gl.getUniformLocation(prog, n); });
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.canvas = c; this.gl = gl; this.prog = prog; this.ok = true; return true;
  },
  setTexture: function (src) {
    if (!this.init()) return;
    var gl = this.gl; this.w = src.width; this.h = src.height; this.canvas.width = this.w; this.canvas.height = this.h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.src = src;
  },
  render: function (tSec) {
    if (!this.ok || !this.src) return null;
    var gl = this.gl, u = this.u, ang = 20 * Math.PI / 180, k = 0.5, flow = P.pondFlow; // the pond layer is painted at half resolution
    gl.viewport(0, 0, this.w, this.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.tex, 0); gl.uniform1f(u.t, tSec);
    gl.uniform2f(u.drift, Math.cos(ang) * 16 * flow * k, Math.sin(ang) * 16 * flow * k);
    gl.uniform1f(u.amp, P.pondSwirl * k); gl.uniform1f(u.scl, P.pondSwirlSize / k); gl.uniform1f(u.spd, flow); gl.uniform1f(u.breathe, P.pondBreathe);
    gl.uniform2f(u.res, this.w, this.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  },
};
