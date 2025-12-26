/**
 * WebGL2 Utilities for Leak-Proof Coloring Canvas
 */

export interface GLResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  labelsTex: WebGLTexture;
  wallTex: WebGLTexture;
  paletteTex: WebGLTexture;
  uLabels: WebGLUniformLocation;
  uWall: WebGLUniformLocation;
  uPalette: WebGLUniformLocation;
  uSize: WebGLUniformLocation;
}

const VERT_SHADER = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = (aPos + 1.0) * 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SHADER = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 vUV;
out vec4 outColor;
uniform usampler2D uLabels;  // R16UI
uniform sampler2D  uPalette; // RGBA8, width=regionCount, height=1
uniform sampler2D  uWall;    // R8, 0/1
uniform vec2 uSize;

vec4 paletteFetch(uint id) {
  ivec2 tc = ivec2(int(id), 0);
  return texelFetch(uPalette, tc, 0);
}

void main() {
  float w = texture(uWall, vUV).r;
  if (w > 0.5) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  
  ivec2 p = ivec2(int(vUV.x * uSize.x), int(vUV.y * uSize.y));
  p.x = clamp(p.x, 0, int(uSize.x) - 1);
  p.y = clamp(p.y, 0, int(uSize.y) - 1);
  uint regionId = texelFetch(uLabels, p, 0).r;
  vec4 c = paletteFetch(regionId);
  outColor = c;
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  
  return program;
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create texture");
  
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
  return tex;
}

export function initGL(canvas: HTMLCanvasElement): GLResources {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL2 not supported");
  
  const program = createProgram(gl, VERT_SHADER, FRAG_SHADER);
  
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to create VAO");
  
  gl.bindVertexArray(vao);
  
  // Fullscreen quad
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const verts = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  
  const labelsTex = makeTexture(gl);
  const wallTex = makeTexture(gl);
  const paletteTex = makeTexture(gl);
  
  gl.useProgram(program);
  
  const uLabels = gl.getUniformLocation(program, "uLabels");
  const uWall = gl.getUniformLocation(program, "uWall");
  const uPalette = gl.getUniformLocation(program, "uPalette");
  const uSize = gl.getUniformLocation(program, "uSize");
  
  if (!uLabels || !uWall || !uPalette || !uSize) {
    throw new Error("Failed to get uniform locations");
  }
  
  // Set texture units
  gl.uniform1i(uLabels, 0);
  gl.uniform1i(uPalette, 1);
  gl.uniform1i(uWall, 2);
  
  return {
    gl,
    program,
    vao,
    labelsTex,
    wallTex,
    paletteTex,
    uLabels,
    uWall,
    uPalette,
    uSize,
  };
}

export function uploadLabels(glr: GLResources, labels: Uint16Array, w: number, h: number) {
  const { gl, labelsTex } = glr;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, labelsTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R16UI,
    w,
    h,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_SHORT,
    labels
  );
}

export function uploadWall(glr: GLResources, wall: Uint8Array, w: number, h: number) {
  const { gl, wallTex } = glr;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, wallTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    w,
    h,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    wall
  );
}

export function uploadPalette(glr: GLResources, palette: Uint8Array, regionCount: number) {
  const { gl, paletteTex } = glr;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, paletteTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    regionCount,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    palette
  );
}

export function draw(glr: GLResources, w: number, h: number) {
  const { gl, program, vao, uSize } = glr;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uSize, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

export function hexToRgba8(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "").trim();
  const expanded = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h;
  const n = parseInt(expanded, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r, g, b, 255];
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
