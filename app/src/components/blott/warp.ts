/*
 * The Blott warp — the stat-driven morph applied to a RENDERED character.
 *
 * Founder 2026-09-09: "we are still lacking the high resolution, well
 * designed blotto character that we see in the higgsfield assets". The
 * drawn SVG (blot/BlotMorph.tsx) could not reach that finish. This module
 * keeps the one rule that matters from the architect brief — THE BLOTT IS
 * THE ALLOCATION MADE FLESH: five corners, top = Strength then clockwise
 * Speed, Heart, Wit, Durability, a continuous function of the allocation,
 * no sprite swap along the way — and paints it with the real render
 * (public/blott/hero.webp, generated from the founder's own character) by
 * warping that image radially, per corner, on the GPU.
 *
 * PHASE-N-REVIEW: the brief's line "nothing may substitute a pre-rendered
 * image for the live outline" is consciously superseded by the founder's
 * direction of 2026-09-09; the LIVE OUTLINE survives as the warp field the
 * image is pushed through, so the readout stays continuous and honest.
 * PID §4.3 still holds: nothing here sets an allocation from a shape.
 *
 * Pure parts (unit-tested): the per-corner radial factors and the framing
 * fit. GL parts: one full-screen quad, one fragment shader that, for every
 * output pixel, finds the texture pixel that would land there under the
 * warp — inverse mapping, so there are never holes.
 */

import { cornerDistance } from '@/components/blot/blotGeometry';

/** Where the body's centre sits in the hero render, in texture units. */
export const BODY_CENTRE = { x: 0.5, y: 0.47 } as const;
/** Where the belly glow sits in the hero render, in texture units. */
export const GLOW_CENTRE = { x: 0.6, y: 0.6 } as const;

/**
 * Radial factor per corner: the brief's corner distance relative to the
 * even split, softened by a 0.6 power so a 100-point spike stretches the
 * pixels about 2.2× rather than 3.6× — still unmistakably the readout,
 * still a sharp picture. Even split → exactly 1 on every corner.
 */
export function radialFactors(allocation: readonly number[]): number[] {
  const base = cornerDistance(20);
  return allocation.map((v) => Math.pow(cornerDistance(v) / base, 0.6));
}

/**
 * Framing: the largest corner decides how far the whole figure is zoomed
 * out so nothing leaves the window. 1 for any ordinary shape.
 */
export function fitFor(factors: readonly number[]): number {
  const max = Math.max(...factors);
  return 1 / Math.max(1, max * 0.78);
}

export interface WarpParams {
  /** The (possibly mid-spring, fractional) allocation to draw. */
  display: readonly number[];
  /** Overall inflation multiplier (idle breathe rides on this). */
  puff: number;
  /** Horizontal shear, −0.15..0.15 — the lean toward a dragged dial. */
  lean: number;
  /** Extra belly glow, 0..1, on top of what Heart already gives. */
  glowBoost: number;
  /** 0 = the hero frame, 1 = the second frame (a lock-in cheer). */
  mix: number;
}

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_mix;
uniform float u_factors[5];
uniform float u_puff;
uniform float u_fit;
uniform float u_lean;
uniform float u_glow;
uniform vec2 u_centre;
uniform vec2 u_glowCentre;

const float PI = 3.141592653589793;

float radialAt(float theta) {
  // Corners at -90deg + 72deg * i, y down; theta from atan2(dy, dx).
  float u = mod((theta + PI * 0.5) / (2.0 * PI) * 5.0 + 5.0, 5.0);
  float i0 = floor(u);
  float t = smoothstep(0.0, 1.0, u - i0);
  float f0 = 1.0; float f1 = 1.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) == i0) f0 = u_factors[i];
    if (float(i) == mod(i0 + 1.0, 5.0)) f1 = u_factors[i];
  }
  return mix(f0, f1, t);
}

void main() {
  vec2 d = v_uv - u_centre;
  // Shear: the lean toward the dial under the hand.
  d.x -= u_lean * d.y;
  float theta = atan(d.y, d.x);
  float s = radialAt(theta) * u_puff * u_fit;
  vec2 uv = u_centre + d / s;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 c = mix(texture2D(u_texA, uv), texture2D(u_texB, uv), u_mix);
  // Heart: the belly glow brightens (or cools) with the stat, premultiplied.
  float g = exp(-dot(uv - u_glowCentre, uv - u_glowCentre) / (2.0 * 0.14 * 0.14));
  vec3 pink = vec3(1.0, 0.42, 0.78);
  vec3 warm = vec3(1.0, 0.72, 0.18);
  if (u_glow >= 0.0) {
    c.rgb += pink * g * u_glow * c.a * 0.55;
  } else {
    c.rgb = mix(c.rgb, warm * c.a, g * (-u_glow) * 0.5);
  }
  gl_FragColor = c;
}`;

export interface WarpProgram {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  loc: {
    factors: WebGLUniformLocation | null;
    puff: WebGLUniformLocation | null;
    fit: WebGLUniformLocation | null;
    lean: WebGLUniformLocation | null;
    glow: WebGLUniformLocation | null;
    mix: WebGLUniformLocation | null;
    centre: WebGLUniformLocation | null;
    glowCentre: WebGLUniformLocation | null;
    texA: WebGLUniformLocation | null;
    texB: WebGLUniformLocation | null;
  };
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('blott warp: cannot create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error(`blott warp: shader failed: ${log}`);
  }
  return sh;
}

/** Build the program once per context; returns null when WebGL is unavailable. */
export function createWarp(canvas: HTMLCanvasElement | OffscreenCanvas, preserve = false): WarpProgram | null {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: preserve,
    powerPreference: 'low-power',
  }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`blott warp: link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const u = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    program,
    loc: {
      factors: u('u_factors[0]'),
      puff: u('u_puff'),
      fit: u('u_fit'),
      lean: u('u_lean'),
      glow: u('u_glow'),
      mix: u('u_mix'),
      centre: u('u_centre'),
      glowCentre: u('u_glowCentre'),
      texA: u('u_texA'),
      texB: u('u_texB'),
    },
  };
}

/** Upload a decoded image as a premultiplied, mipmapped texture. */
export function uploadTexture(gl: WebGLRenderingContext, image: TexImageSource): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('blott warp: cannot create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

/** The Heart stat as a glow term: −0.6 (cold, 0 points) … +1 (100 points); 20 points = 0. */
export function glowFor(heart: number): number {
  return heart >= 20 ? Math.min(1, (heart - 20) / 80) : Math.max(-0.6, (heart - 20) / 33);
}

/** Draw one frame. The caller has already sized the canvas. */
export function drawWarp(
  w: WarpProgram,
  texA: WebGLTexture,
  texB: WebGLTexture,
  params: WarpParams,
  clear: [number, number, number, number] = [0, 0, 0, 0]
): void {
  const { gl, loc } = w;
  const factors = radialFactors(params.display);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(w.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(loc.texA, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.uniform1i(loc.texB, 1);
  gl.uniform1fv(loc.factors, new Float32Array(factors));
  gl.uniform1f(loc.puff, params.puff);
  gl.uniform1f(loc.fit, fitFor(factors));
  gl.uniform1f(loc.lean, params.lean);
  const heart = params.display[2] ?? 20;
  gl.uniform1f(loc.glow, Math.min(1, glowFor(heart) + params.glowBoost));
  gl.uniform1f(loc.mix, params.mix);
  gl.uniform2f(loc.centre, BODY_CENTRE.x, BODY_CENTRE.y);
  gl.uniform2f(loc.glowCentre, GLOW_CENTRE.x, GLOW_CENTRE.y);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ---------- shared image loading (one decode per URL per page) ---------- */

const images = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`blott: could not load ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** The two frames the machine draws: the hero and the lock-in cheer. */
export const HERO_URL = '/blott/hero.webp';
export const CHEER_URL = '/blott/cheer.webp';
