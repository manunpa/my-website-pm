/* พื้นหลังแถบเส้นใยจุดบิดพลิ้ว (หน้าเข้าสู่ระบบ)
 * แนวคิดจาก reactbits.dev/backgrounds/ghost-fibers เขียนใหม่เป็น WebGL ล้วน ไม่พึ่ง React/ไลบรารี
 * เมาส์: มุมมองเอียงตาม + แถบใต้เคอร์เซอร์คมชัดขึ้น · คลิก: แสงวิ่งไปตามเส้นใย
 * ตั้งค่า "ลดการเคลื่อนไหว" จะวาดภาพนิ่ง
 */
(function () {
  "use strict";

  var canvas = document.createElement("canvas");
  var gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return;

  // z-index -2 : อยู่หลังลูกเล่นเทศกาล (-1) และเนื้อหาทั้งหมด
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-2;pointer-events:none";

  var RIBBONS = 3, THREADS = 54, DOTS = 260;

  var VERT = [
    "attribute vec3 p;",                       // u (ตามยาว 0..1), v (ตามกว้าง -1..1), หมายเลขแถบ
    "uniform float time,aspect,px,intro,hover;uniform vec2 mouse;uniform vec2 pulse;",
    "varying float vA,vSoft,vHot;",
    "void main(){",
    "  float u=p.x,v=p.y,i=p.z;",
    "  float flow=fract(u+time*.012*(1.+i*.25));",
    "  float len=max(aspect,1.)*1.35;",
    "  float x=(flow*2.-1.)*len;",
    "  float tw=flow*6.5+i*2.1+time*(.12+i*.025);",
    "  float wid=(.27+.07*sin(flow*5.+i*3.+time*.2))*(1.-.12*i);",
    "  float y=(1.-i)*.62+sin(flow*4.2+i*1.7+time*.22)*.22+v*wid*cos(tw);",
    "  float z=v*wid*sin(tw)*1.6+sin(flow*3.1+i*2.4-time*.15)*.35+(flow-.5)*(i-1.)*.7;",
    "  vec2 q=vec2(x,y);",
    "  float c=cos(.32),s=sin(.32);",
    "  q=vec2(q.x*c-q.y*s,q.x*s+q.y*c);",
    "  q+=mouse*(.03+z*.07);",
    "  float persp=2.6/(2.6+z);",
    "  q*=persp;",
    "  gl_Position=vec4(q.x/aspect,q.y,0.,1.);",
    "  float near=hover*exp(-dot(q-mouse,q-mouse)*5.);",
    "  float blur=clamp(abs(z)*1.5-near,0.,1.);",       // ห่างจุดโฟกัส = เบลอ
    "  float fold=pow(abs(sin(tw)),8.);",  // ช่วงพับตะแคง
    "  float wave=exp(-pow(abs(x-pulse.x)-pulse.y*2.2,2.)*30.)*max(1.-pulse.y/1.8,0.);",
    "  float twinkle=pow(max(sin(time*1.7+u*913.+v*377.),0.),40.);",
    "  vHot=clamp(fold*.6+wave+twinkle+near*.4,0.,1.);",
    "  vSoft=blur;",
    "  float draw=smoothstep(0.,.15,intro*1.2-flow);",
    "  float ends=smoothstep(0.,.06,flow)*smoothstep(1.,.94,flow);",  // กันจุดกระโดดตอนวนรอบ
    "  vA=draw*ends*mix(.62,.2,blur)*(1.+vHot*.8)*(1.-.35*abs(v)*abs(v));",
    "  gl_PointSize=px*persp*(2.1+blur*4.5+wave*2.+twinkle*2.);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "varying float vA,vSoft,vHot;",
    "void main(){",
    "  float d=length(gl_PointCoord-.5)*2.;",
    "  float a=vA*(1.-smoothstep(mix(.6,0.,vSoft),1.,d));",
    "  a=clamp(a,0.,1.);",
    "  vec3 col=mix(vec3(.424,.698,0.),vec3(.18,.43,0.),vHot);",  // เขียวป้ายบางจาก -> เขียวเข้ม
    "  gl_FragColor=vec4(col*a,a);}"
  ].join("\n");

  function shader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var data = new Float32Array(RIBBONS * THREADS * DOTS * 3), n = 0;
  for (var r = 0; r < RIBBONS; r++) {
    for (var t = 0; t < THREADS; t++) {
      for (var d = 0; d < DOTS; d++) {
        data[n++] = (d + (t % 2) * 0.5) / DOTS;
        data[n++] = t / (THREADS - 1) * 2 - 1;
        data[n++] = r;
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  var U = {};
  ["time", "aspect", "px", "intro", "hover", "mouse", "pulse"].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var time = 0, age = still ? 9 : 0, last = 0;
  var mouse = [0, 0], target = [0, 0], hover = 0, hovering = false;
  var pulse = [0, 9], ratio = 1;

  // จุดบนจอ -> พิกัดเดียวกับใน shader (ครึ่งความสูงจอ = 1)
  function point(e) {
    return [(e.clientX * 2 - innerWidth) / innerHeight, 1 - e.clientY * 2 / innerHeight];
  }

  function draw() {
    gl.uniform1f(U.time, time);
    gl.uniform1f(U.aspect, innerWidth / innerHeight);
    gl.uniform1f(U.px, ratio * Math.max(0.8, Math.min(innerHeight / 800, 1.4)));
    gl.uniform1f(U.intro, Math.min(age / 2.4, 1));
    gl.uniform1f(U.hover, hover);
    gl.uniform2f(U.mouse, mouse[0], mouse[1]);
    gl.uniform2f(U.pulse, pulse[0], pulse[1]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, n / 3);
  }

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 32) return;            // ~30 fps ประหยัดแบต
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;
    age += dt;
    pulse[1] += dt;
    var k = 1 - Math.exp(-dt * 5);
    mouse[0] += (target[0] - mouse[0]) * k;
    mouse[1] += (target[1] - mouse[1]) * k;
    hover += ((hovering ? 1 : 0) - hover) * k;
    draw();
  }

  document.body.insertBefore(canvas, document.body.firstChild);
  resize();
  window.addEventListener("resize", resize);

  if (still) return;

  window.addEventListener("pointermove", function (e) {
    target = point(e);
    hovering = true;
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) {
    var q = point(e);
    pulse = [q[0] * Math.cos(0.32) + q[1] * Math.sin(0.32), 0];
  }, { passive: true });
  function leave() { hovering = false; }
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("pointerup", function (e) { if (e.pointerType === "touch") leave(); });
  window.addEventListener("pointercancel", leave);
  requestAnimationFrame(frame);
})();
