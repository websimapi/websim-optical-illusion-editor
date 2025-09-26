// Simple optical-illusion WebGL renderer with controls.
// Uses a fragment shader that composes swirl, wave, symmetry, tiling/recursion, and perspective skew.

const canvas = document.getElementById('illusion');
const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true});
if(!gl) throw new Error('WebGL not available');

const vsSource = `
attribute vec2 a_position;
varying vec2 v_uv;
void main(){
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Fragment shader implements multiple illusion transforms.
// - swirl (angle by radius)
// - wave distortions
// - tiling recursion
// - symmetry modes
// - perspective skew
const fsSource = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_swirl;
uniform float u_wave;
uniform int u_tiles;
uniform int u_symmetry; // 1 none, 2 mirrorX, 3 mirrorY, 4 rot4, 6 rot6
uniform float u_skew;
varying vec2 v_uv;

vec2 rotate(vec2 p, float a){
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * p;
}

vec2 applySymmetry(vec2 uv, int mode){
  vec2 p = uv - 0.5;
  if(mode == 2) { p.x = abs(p.x); } // mirror X
  else if(mode == 3) { p.y = abs(p.y); } // mirror Y
  else if(mode == 4) { // rotational 4
    float a = atan(p.y,p.x);
    float r = length(p);
    float step = 3.14159265*0.5;
    a = mod(a + step*0.5, step) - step*0.5;
    p = vec2(cos(a), sin(a))*r;
  } else if(mode == 6) {
    float a = atan(p.y,p.x);
    float r = length(p);
    float step = 3.14159265*(2.0/6.0);
    a = mod(a + step*0.5, step) - step*0.5;
    p = vec2(cos(a), sin(a))*r;
  }
  return p + 0.5;
}

vec2 tile(vec2 uv, int tiles){
  if(tiles <= 1) return uv;
  vec2 t = uv * float(tiles);
  vec2 id = floor(t);
  vec2 f = fract(t) - 0.5;
  // flip every other tile for recursion effect
  if(mod(id.x + id.y, 2.0) > 0.5) f.x = -f.x;
  return f + 0.5;
}

void main(){
  vec2 uv = v_uv;
  // apply tiling recursion first for fractal repetition
  uv = tile(uv, u_tiles);

  // center coordinates
  vec2 c = uv - 0.5;

  // perspective skew (subtle)
  c.x += u_skew * c.y;

  // swirl: angle increases with radius
  float r = length(c);
  float angle = u_swirl * pow(r, 0.8) * 3.14159;
  c = rotate(c, angle);

  // fine waves to create motion/depth illusions
  c.x += u_wave * sin(20.0 * c.y + u_time * 0.7 + r * 12.0);
  c.y += u_wave * cos(20.0 * c.x + u_time * 0.6 + r * 12.0);

  // apply symmetry that can create impossible joins
  uv = applySymmetry(c + 0.5, u_symmetry);

  // subtle vignette to emphasize depth
  float vign = smoothstep(0.8, 0.3, length((uv - 0.5)*vec2(1.0,1.0)));

  // sample texture with safe coords (clamp)
  vec4 color = texture2D(u_image, clamp(uv, 0.0, 1.0));

  // blend with mirrored recursion around center for Escher-like recursion
  if(u_tiles > 2){
    vec2 ruv = 1.0 - uv;
    vec4 c2 = texture2D(u_image, clamp(ruv, 0.0, 1.0));
    color = mix(color, c2, 0.25);
  }

  // final tweaks: increase contrast slightly and apply vignette
  color.rgb = pow(color.rgb, vec3(0.95));
  color.rgb *= mix(1.0, vign, 0.15);

  gl_FragColor = color;
}
`;

// --- WebGL helper functions
function createShader(gl, type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    console.error(gl.getShaderInfoLog(s));
    throw new Error('Shader compile error');
  }
  return s;
}
function createProgram(gl, vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.error(gl.getProgramInfoLog(p));
    throw new Error('Program link error');
  }
  return p;
}

const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
const prog = createProgram(gl, vs, fs);
gl.useProgram(prog);

// quad
const posLoc = gl.getAttribLocation(prog, 'a_position');
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1,  1,-1,  -1,1,
   1,-1,  1,1,   -1,1
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

// uniforms
const uni = {
  u_image: gl.getUniformLocation(prog, 'u_image'),
  u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
  u_time: gl.getUniformLocation(prog, 'u_time'),
  u_swirl: gl.getUniformLocation(prog, 'u_swirl'),
  u_wave: gl.getUniformLocation(prog, 'u_wave'),
  u_tiles: gl.getUniformLocation(prog, 'u_tiles'),
  u_symmetry: gl.getUniformLocation(prog, 'u_symmetry'),
  u_skew: gl.getUniformLocation(prog, 'u_skew')
};

// create a placeholder texture (solid gray) so shader has something before upload
function createTextureFromImage(img){
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  return tex;
}
const placeholder = new Uint8Array([128,128,128,255]);
const placeholderTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, placeholderTex);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,placeholder);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

let activeTexture = placeholderTex;

// --- UI bindings
const fileInput = document.getElementById('file');
const swirlEl = document.getElementById('swirl');
const swirlOut = document.getElementById('swirlOut');
const waveEl = document.getElementById('wave');
const waveOut = document.getElementById('waveOut');
const tilesEl = document.getElementById('recursion');
const tilesOut = document.getElementById('recurOut');
const symmetryEl = document.getElementById('symmetry');
const skewEl = document.getElementById('skew');
const skewOut = document.getElementById('skewOut');
const randomBtn = document.getElementById('random');
const downloadBtn = document.getElementById('download');

swirlEl.addEventListener('input', ()=> swirlOut.value =(parseFloat(swirlEl.value)).toFixed(2));
waveEl.addEventListener('input', ()=> waveOut.value = parseFloat(waveEl.value).toFixed(3));
tilesEl.addEventListener('input', ()=> tilesOut.value = tilesEl.value);
skewEl.addEventListener('input', ()=> skewOut.value = parseFloat(skewEl.value).toFixed(3));

fileInput.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = ()=>{
    // create power-of-two canvas scaled to fit for decent sampling
    const w = img.width;
    const h = img.height;
    // create a temporary canvas to resize image to shader-friendly dimensions
    const tmp = document.createElement('canvas');
    // keep aspect ratio but fit within 2048 for memory safety
    const max = 2048;
    let scale = Math.min(1, max / Math.max(w, h));
    tmp.width = Math.max(1, Math.floor(w * scale));
    tmp.height = Math.max(1, Math.floor(h * scale));
    const ctx = tmp.getContext('2d');
    ctx.drawImage(img, 0, 0, tmp.width, tmp.height);
    activeTexture = createTextureFromImage(tmp);
  };
  img.src = URL.createObjectURL(f);
});

// Randomize button: picks pleasing combinations
randomBtn.addEventListener('click', ()=>{
  swirlEl.value = (Math.random()*4+0.4).toFixed(2);
  waveEl.value = (Math.random()*0.12).toFixed(3);
  tilesEl.value = String(Math.floor(Math.random()*6)+1);
  symmetryEl.value = [1,2,3,4,6][Math.floor(Math.random()*5)];
  skewEl.value = (Math.random()*1-0.5).toFixed(3);
  swirlOut.value = swirlEl.value;
  waveOut.value = waveEl.value;
  tilesOut.value = tilesEl.value;
  skewOut.value = skewEl.value;
});

// Download PNG
downloadBtn.addEventListener('click', ()=>{
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'illusion.png';
  a.click();
});

// resize handling
function resizeCanvasToDisplaySize(){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const displayWidth  = Math.floor(canvas.clientWidth  * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight){
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    gl.viewport(0,0,canvas.width,canvas.height);
  }
}
window.addEventListener('resize', ()=> resizeCanvasToDisplaySize());
resizeCanvasToDisplaySize();

// Render loop
let start = performance.now();
function render(time){
  resizeCanvasToDisplaySize();
  const t = (time - start) * 0.001;

  // set uniforms
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, activeTexture);
  gl.uniform1i(uni.u_image, 0);
  gl.uniform2f(uni.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(uni.u_time, t);
  gl.uniform1f(uni.u_swirl, parseFloat(swirlEl.value));
  gl.uniform1f(uni.u_wave, parseFloat(waveEl.value));
  gl.uniform1i(uni.u_tiles, parseInt(tilesEl.value,10));
  gl.uniform1i(uni.u_symmetry, parseInt(symmetryEl.value,10));
  gl.uniform1f(uni.u_skew, parseFloat(skewEl.value));

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

