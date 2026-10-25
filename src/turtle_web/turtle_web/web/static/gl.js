/* TurtleGL - renderer WebGL cho ban do turtlesim.
 *
 * Y tuong:
 *  - Moi thu la "capsule" hoac "SDF" tinh trong fragment shader, nen net o moi DPR,
 *    khong co bitmap nao bi phong to.
 *  - Luoi + vet di: moi doan thang la 1 quad (2 tam giac). Fragment tinh khoang cach
 *    toi doan thang -> vien tron, khu rang cua. Vet di luu san trong VBO tren GPU,
 *    moi frame chi 1 draw call cho toan bo vet.
 *  - Rua: 1 quad / con. Fragment shader ve mai, dau, chan, duoi, hoa van bang
 *    signed distance field trong he toa do cuc bo cua rua.
 *  - Chu (ten rua, so truc) van ve bang canvas 2D phu len tren (WebGL khong co text).
 *
 * API:
 *   const R = TurtleGL.create(canvas)   // null neu khong co WebGL
 *   R.resize(sizeCss, dpr)
 *   R.setBackground('#rrggbb')
 *   R.addSegment({x0,y0,x1,y1,color,w})  // toa do the gioi, w = px
 *   R.clearTrails()
 *   R.render(turtles, selectedName)      // turtles: {name: {x,y,theta}}
 */
'use strict';
window.TurtleGL = (function () {
  const WORLD = 11.0;

  // ---------------------------------------------------------------- shaders
  const VS_SEG = `
    precision highp float;
    attribute vec2 aA;        // dau doan (toa do the gioi)
    attribute vec2 aB;        // cuoi doan
    attribute vec2 aCorner;   // (t: 0|1 doc theo doan, s: -1|1 ngang)
    attribute float aHW;      // nua do rong, don vi px CSS
    attribute vec4 aColor;
    attribute float aT;       // thoi diem tao (giay), <0 = khong mo
    uniform float uSize;      // kich thuoc ban do, px CSS
    uniform float uNow;       // giay hien tai
    uniform float uFadeSec;   // moi uFadeSec giay, do dam giam mot nua
    varying vec2 vP, vA, vB;
    varying float vHW;
    varying vec4 vColor;
    vec2 w2p(vec2 w) { return vec2(w.x, ${WORLD.toFixed(1)} - w.y) * (uSize / ${WORLD.toFixed(1)}); }
    void main() {
      vec2 A = w2p(aA), B = w2p(aB);
      vec2 d = B - A;
      float len = length(d);
      vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
      vec2 n = vec2(-dir.y, dir.x);
      float pad = aHW + 1.5;                      // them vien de khu rang cua
      vec2 p = mix(A, B, aCorner.x) + dir * (aCorner.x * 2.0 - 1.0) * pad + n * aCorner.y * pad;
      float fade = 1.0;
      if (aT >= 0.0) {
        float level = floor(max(0.0, uNow - aT) / uFadeSec);   // 0,1,2,... theo tung phut
        fade = max(0.12, pow(0.5, level));
      }
      vP = p; vA = A; vB = B; vHW = aHW; vColor = vec4(aColor.rgb, aColor.a * fade);
      vec2 clip = p / uSize * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }`;
  const FS_SEG = `
    precision highp float;
    varying vec2 vP, vA, vB;
    varying float vHW;
    varying vec4 vColor;
    uniform float uAA;        // be rong khu rang cua, px CSS (= 1/dpr)
    void main() {
      vec2 ab = vB - vA;
      float l2 = dot(ab, ab);
      float t = l2 > 1e-6 ? clamp(dot(vP - vA, ab) / l2, 0.0, 1.0) : 0.0;
      float d = length(vP - (vA + ab * t)) - vHW;
      float a = 1.0 - smoothstep(-uAA * 0.5, uAA * 0.5, d);
      if (a <= 0.001) discard;
      gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    }`;

  const VS_TURTLE = `
    precision highp float;
    attribute vec2 aCorner;   // -1..1
    uniform vec2 uCenter;     // px CSS
    uniform float uTheta, uR, uSize;
    varying vec2 vL;          // toa do cuc bo, don vi = r, x huong ve phia truoc
    void main() {
      vL = aCorner * 2.1;
      float c = cos(uTheta), s = sin(uTheta);
      // y canvas huong xuong => quay -theta
      vec2 off = vec2(vL.x * c + vL.y * s, -vL.x * s + vL.y * c) * uR;
      vec2 p = uCenter + off;
      vec2 clip = p / uSize * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }`;
  const FS_TURTLE = `
    precision highp float;
    varying vec2 vL;
    uniform float uAA;        // be rong AA trong don vi cuc bo (= 1/(r*dpr))
    uniform vec3 uShell, uShellDark, uSkin;
    uniform float uSelected, uTime;

    float sdEllipse(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
    float sdEllipseRot(vec2 p, vec2 c, vec2 r, float ang) {
      vec2 q = p - c; float ca = cos(ang), sa = sin(ang);
      q = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
      return sdEllipse(q, vec2(0.0), r);
    }
    float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - (a + ab * t)); }
    float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {   // tam giac, am ben trong
      vec2 e0 = b - a, e1 = c - b, e2 = a - c;
      vec2 v0 = p - a, v1 = p - b, v2 = p - c;
      vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
      vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
      vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
      float s = sign(e0.x * e2.y - e0.y * e2.x);
      vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                       vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                       vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
      return -sqrt(d.x) * sign(d.y);
    }
    float cov(float d) { return 1.0 - smoothstep(-uAA, uAA, d); }
    // to mau: fill + vien
    void paint(inout vec4 col, float d, vec3 fill, vec3 line, float lw) {
      float a = cov(d);
      col = mix(col, vec4(fill, 1.0), a);
      float e = cov(abs(d) - lw * 0.5);
      col = mix(col, vec4(line, 1.0), e);
    }

    void main() {
      vec2 p = vL;
      vec4 col = vec4(0.0);
      vec3 skinDark = uSkin * 0.55;

      // bong
      col = mix(col, vec4(0.0, 0.0, 0.0, 0.28), cov(sdEllipse(p, vec2(0.08, 0.12), vec2(1.02, 0.86))));

      // 4 chan
      paint(col, sdEllipseRot(p, vec2( 0.55,  0.62), vec2(0.34, 0.20),  0.6), uSkin, skinDark, 0.07);
      paint(col, sdEllipseRot(p, vec2( 0.55, -0.62), vec2(0.34, 0.20), -0.6), uSkin, skinDark, 0.07);
      paint(col, sdEllipseRot(p, vec2(-0.55,  0.62), vec2(0.34, 0.20),  2.4), uSkin, skinDark, 0.07);
      paint(col, sdEllipseRot(p, vec2(-0.55, -0.62), vec2(0.34, 0.20), -2.4), uSkin, skinDark, 0.07);
      // duoi
      paint(col, sdTri(p, vec2(-0.85, -0.12), vec2(-1.3, 0.0), vec2(-0.85, 0.12)), uSkin, skinDark, 0.07);
      // dau + mat
      paint(col, sdEllipse(p, vec2(1.05, 0.0), vec2(0.36, 0.30)), uSkin, skinDark, 0.07);
      col = mix(col, vec4(0.07, 0.07, 0.07, 1.0), cov(length(p - vec2(1.18, -0.12)) - 0.06));
      col = mix(col, vec4(0.07, 0.07, 0.07, 1.0), cov(length(p - vec2(1.18,  0.12)) - 0.06));

      // mai
      float dShell = sdEllipse(p, vec2(0.0), vec2(1.0, 0.82));
      paint(col, dShell, uShell, uShellDark, 0.12);
      // hoa van: vong trong + 6 nan
      float dRing = abs(sdEllipse(p, vec2(0.0), vec2(0.42, 0.34)));
      float dSpoke = 1e9;
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.0471976 + 0.5235988;
        vec2 ca = vec2(cos(a), sin(a));
        dSpoke = min(dSpoke, sdSeg(p, ca * vec2(0.42, 0.34), ca * vec2(0.94, 0.77)));
      }
      float pat = cov(min(dRing, dSpoke) - 0.035);
      pat *= step(dShell, -0.04);                         // chi ve trong mai
      col = mix(col, vec4(uShellDark, 1.0), pat);
      // diem sang
      col = mix(col, vec4(1.0, 1.0, 1.0, 0.22), cov(sdEllipseRot(p, vec2(-0.25, -0.3), vec2(0.3, 0.16), -0.5)) * col.a);

      // vong chon net dut, xoay cham
      if (uSelected > 0.5) {
        float dr = abs(length(p) - 1.6) - 0.03;
        float ang = atan(p.y, p.x) + uTime * 0.8;
        float dash = step(0.5, fract(ang * 12.0 / 6.2831853));
        col = mix(col, vec4(1.0), cov(dr) * dash * 0.95);
      }
      if (col.a <= 0.002) discard;
      gl_FragColor = col;
    }`;

  // ---------------------------------------------------------------- helpers
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, a = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
    return { p, u, a };
  }
  function hexToRgb01(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }

  // Bo dem doan thang (float per vertex: A2 B2 corner2 hw1 rgba4 t1 = 12), 6 dinh / doan
  const FLOATS_V = 12, FLOATS_SEG = FLOATS_V * 6;
  const CORNERS = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
  function SegBuffer(gl, capacitySegs) {
    this.gl = gl; this.cap = capacitySegs; this.n = 0;
    this.cpu = new Float32Array(capacitySegs * FLOATS_SEG);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.cpu.byteLength, gl.DYNAMIC_DRAW);
    this.dirtyFrom = 0; this.dirtyTo = 0;
  }
  SegBuffer.prototype.push = function (x0, y0, x1, y1, hw, r, g, b, a, t) {
    if (this.n >= this.cap) {                       // vong tron: ghi de doan cu nhat
      this.cpu.copyWithin(0, FLOATS_SEG, this.cpu.length);
      this.n = this.cap - 1; this.dirtyFrom = 0;
    }
    let o = this.n * FLOATS_SEG;
    for (const [t, s] of CORNERS) {
      this.cpu[o++] = x0; this.cpu[o++] = y0; this.cpu[o++] = x1; this.cpu[o++] = y1;
      this.cpu[o++] = t; this.cpu[o++] = s; this.cpu[o++] = hw;
      this.cpu[o++] = r; this.cpu[o++] = g; this.cpu[o++] = b; this.cpu[o++] = a;
      this.cpu[o++] = (t === undefined ? -1 : t);
    }
    this.dirtyFrom = Math.min(this.dirtyFrom, this.n); this.n++; this.dirtyTo = this.n;
  };
  SegBuffer.prototype.clear = function () { this.n = 0; this.dirtyFrom = 0; this.dirtyTo = 0; };
  SegBuffer.prototype.upload = function () {
    if (this.dirtyTo <= this.dirtyFrom) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const sub = this.cpu.subarray(this.dirtyFrom * FLOATS_SEG, this.dirtyTo * FLOATS_SEG);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.dirtyFrom * FLOATS_SEG * 4, sub);
    this.dirtyFrom = this.n; this.dirtyTo = this.n;
  };

  // ---------------------------------------------------------------- renderer
  function create(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    let segP, turtleP;
    try { segP = program(gl, VS_SEG, FS_SEG); turtleP = program(gl, VS_TURTLE, FS_TURTLE); }
    catch (e) { console.error(e); return null; }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    const grid = new SegBuffer(gl, 64);
    const trails = new SegBuffer(gl, 60000);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

    let size = 560, dpr = 1, bg = [0.27, 0.34, 1.0], fadeSec = 60;
    const t0 = performance.now();

    function buildGrid() {
      grid.clear();
      for (let i = 1; i < WORLD; i++) {
        const a = (i === 5 || i === 6) ? 0.22 : 0.11;
        grid.push(i, 0, i, WORLD, 0.5, 1, 1, 1, a);
        grid.push(0, i, WORLD, i, 0.5, 1, 1, 1, a);
      }
    }
    buildGrid();

    function bindSeg(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
      const S = FLOATS_V * 4, a = segP.a;
      gl.enableVertexAttribArray(a.aA);      gl.vertexAttribPointer(a.aA, 2, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(a.aB);      gl.vertexAttribPointer(a.aB, 2, gl.FLOAT, false, S, 8);
      gl.enableVertexAttribArray(a.aCorner); gl.vertexAttribPointer(a.aCorner, 2, gl.FLOAT, false, S, 16);
      gl.enableVertexAttribArray(a.aHW);     gl.vertexAttribPointer(a.aHW, 1, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(a.aColor);  gl.vertexAttribPointer(a.aColor, 4, gl.FLOAT, false, S, 28);
      gl.enableVertexAttribArray(a.aT);      gl.vertexAttribPointer(a.aT, 1, gl.FLOAT, false, S, 44);
    }
    function drawSegs(buf) {
      if (!buf.n) return;
      buf.upload(); bindSeg(buf);
      gl.drawArrays(gl.TRIANGLES, 0, buf.n * 6);
    }

    const api = {
      gl,
      resize(sizeCss, devicePixelRatio) {
        size = sizeCss; dpr = devicePixelRatio;
        canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      setBackground(hex) { bg = hexToRgb01(hex); },
      setFade(sec) { fadeSec = sec > 0 ? sec : 1e9; },
      addSegment(sg) {
        const c = hexToRgb01(sg.color);
        trails.push(sg.x0, sg.y0, sg.x1, sg.y1, (sg.w || 2) / 2, c[0], c[1], c[2], 1, (performance.now() - t0) / 1000);
      },
      clearTrails() { trails.clear(); },
      segmentCount() { return trails.n; },
      render(turtles, selected) {
        gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);

        // luoi + vet
        gl.useProgram(segP.p);
        gl.uniform1f(segP.u.uSize, size);
        gl.uniform1f(segP.u.uAA, 1 / dpr);
        gl.uniform1f(segP.u.uNow, (performance.now() - t0) / 1000);
        gl.uniform1f(segP.u.uFadeSec, fadeSec);
        drawSegs(grid);
        drawSegs(trails);
        for (const k in segP.a) gl.disableVertexAttribArray(segP.a[k]);

        // rua
        const cell = size / WORLD, r = Math.max(12, cell * 0.45);
        gl.useProgram(turtleP.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(turtleP.a.aCorner);
        gl.vertexAttribPointer(turtleP.a.aCorner, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(turtleP.u.uSize, size);
        gl.uniform1f(turtleP.u.uR, r);
        gl.uniform1f(turtleP.u.uAA, 1 / (r * dpr));
        gl.uniform1f(turtleP.u.uTime, (performance.now() - t0) / 1000);
        for (const [name, p] of Object.entries(turtles)) {
          const sel = name === selected;
          gl.uniform2f(turtleP.u.uCenter, p.x / WORLD * size, (WORLD - p.y) / WORLD * size);
          gl.uniform1f(turtleP.u.uTheta, p.theta);
          gl.uniform1f(turtleP.u.uSelected, sel ? 1 : 0);
          if (sel) { gl.uniform3f(turtleP.u.uShell, 0.18, 0.80, 0.56); gl.uniform3f(turtleP.u.uShellDark, 0.10, 0.56, 0.38); gl.uniform3f(turtleP.u.uSkin, 0.61, 0.91, 0.77); }
          else     { gl.uniform3f(turtleP.u.uShell, 0.50, 0.72, 0.49); gl.uniform3f(turtleP.u.uShellDark, 0.31, 0.50, 0.31); gl.uniform3f(turtleP.u.uSkin, 0.73, 0.85, 0.66); }
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        gl.disableVertexAttribArray(turtleP.a.aCorner);
      },
    };
    return api;
  }

  return { create, WORLD };
})();
