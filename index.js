
document.body.style.margin = 0;
document.body.style.padding = 0;

const width = window.innerWidth;
const height = window.innerHeight;

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const context = canvas.getContext('webgl')
  || canvas.getContext('experimental-webgl')
  || canvas.getContext('webgl-experimental')
  || canvas.getContext('moz-webgl')
  || canvas.getContext('webkit-3d');

const fit = require('canvas-fit');
const bezier = require('adaptive-bezier-curve');

const chroma = require('chroma-js');

const d3 = require('d3-shape');
const scale = require('d3-scale');

const x = scale.scaleLinear().domain([-1024 * 0.75, 1024 * 0.75]).range([1, -1]);
const yRangeScale = scale.scaleLinear().domain([0, 256 * 1024]).range([0.0, 1.0]);
const y = scale.scaleLinear().domain([0, 256 * 2]).range([0.0, -0.5]);

const audio = new Audio();
audio.crossOrigin = 'Anonymous';

audio.loop = false;
var analyser;

audio.addEventListener('canplay', function() {
  analyser = require('web-audio-analyser')(audio, { audible: true, stereo: true });
  audio.play();
});

const scb = require('soundcloud-badge');
const songQuery = getParameterByName('song');
scb({
    client_id: '596b2beb928d826f92ee9807351fa9fd',
    song: songQuery ? songQuery : 'https://soundcloud.com/xeni_kott/jan-jelinek-loop-finding-jazz-records',
    dark: false,
    getFonts: false
}, function(err, src, data, div) {
  if (err) {
    alert('Problem fetching song from soundcloud. Check the URL, if this problem persists try a different song. Not all have correct permissions to be streamed.')
    throw err
  }
  audio.src = src;
})

const CurveContext = function () {
  this.location = [0, 0];
  this.lines = [];
  return this;
};

CurveContext.prototype.moveTo = function (x, y) {
  this.location = [x, y];
};

CurveContext.prototype.lineTo = function (x, y) {
  this.lines.push(this.location);
  this.lines.push([x, y]);
  this.location = [x, y];
};

CurveContext.prototype.bezierCurveTo = function (cx1, cy1, cx2, cy2, ex, ey) {
  const bezierPoints = bezier(this.location, [cx1, cy1], [cx2, cy2], [ex, ey]);//, Math.max(width, height) / 2);
  bezierPoints.forEach((point, i) => {
    if (i > 0) {
      this.lines.push(this.location);
      this.lines.push(point);
    }
    this.location = point;
  });
};

CurveContext.prototype.getLinePoints = function () {
  return this.lines;
};
CurveContext.prototype.clear = function () {
  this.location = [0, 0];
  this.lines = [];
};


const curveContext = new CurveContext();

const lineGenerator = d3.line()
    .x(function(d) {
      return x(d[0]);
    })
    .y(function(d) {
      return y(d[1]);
    })
    // .curve(d3.curveBasis)
    .context(curveContext);


window.addEventListener('resize', fit(canvas), false)

const regl = require('regl')(context || canvas);
var tween = require('regl-tween')(regl);

const generatePoints = () => {
  curveContext.clear();
  const newPoints = []
  for (let i = 0; i < 100; i++) {
    newPoints.push([i / 100, Math.random()]);
  }
  lineGenerator(newPoints);
  console.log('output length: ' + curveContext.getLinePoints().length);
};

// generatePoints();
// var positionBuffer = tween.buffer(curveContext.getLinePoints(), { duration: 0 });
// console.log(positionBuffer);
//
// setInterval(() => {
//   generatePoints();
//   positionBuffer.update(curveContext.getLinePoints());
// }, 1000);

const createFramebuffer = () => {
  return regl.framebuffer({
    color: regl.texture({
      width: width,
      height: height,
      min: 'linear',
      max: 'linear'
    }),
    depth: false
  });
}


const backbuffer = createFramebuffer();
const fbo1 = createFramebuffer();
const fbo2 = createFramebuffer();


const blurFrag = `
  precision mediump float;

  vec4 blur(sampler2D image, vec2 uv, vec2 resolution, vec2 d) {
    vec4 color = vec4(0.0);
    vec2 off1 = vec2(1.3846153846) * d;
    vec2 off2 = vec2(3.2307692308) * d;
    color += texture2D(image, uv) * 0.3270270270;
    color += texture2D(image, uv + (off1 / resolution)) * 0.4262162162;
    color += texture2D(image, uv - (off1 / resolution)) * 0.4262162162;
    color += texture2D(image, uv + (off2 / resolution)) * 0.0802702703;
    color += texture2D(image, uv - (off2 / resolution)) * 0.0802702703;

    return color;
  }

  uniform sampler2D fbo;
  uniform vec2 resolution;
  uniform vec2 direction;
  varying vec2 uv;

  void main() {
    gl_FragColor = blur(fbo, uv, resolution.xy, direction);
  }
`;

const blur = regl({
  frag: blurFrag,
  uniforms: {
    fbo: regl.prop('fbo'),
    resolution: regl.prop('resolution'),
    direction: regl.prop('direction')
  },

  vert: `
  precision mediump float;
  attribute vec2 position;
  varying vec2 uv;
  void main () {
    uv = position;
    gl_Position = vec4(1.0 - 2.0 * position, 0, 1);
  }`,

  attributes: {
    position: [
      -2, 0,
      0, -2,
      2, 2]
  },

  count: 3,
  framebuffer: regl.prop('framebuffer')
});

const blend = regl({
  frag: `
    precision mediump float;
    uniform sampler2D backbuffer;
    uniform sampler2D blur;
    varying vec2 uv;

    void main() {
      vec4 bb = texture2D(backbuffer, uv);
      vec4 bl = texture2D(blur, uv);
      gl_FragColor = 0.5 * bl + bb;
    }

  `,
  uniforms: {
    backbuffer: regl.prop('backbuffer'),
    blur: regl.prop('blur')
  },

  vert: `
  precision mediump float;
  attribute vec2 position;
  varying vec2 uv;
  void main () {
    uv = position;
    gl_Position = vec4(1.0 - 2.0 * position, 0, 1);
  }`,

  attributes: {
    position: [
      -2, 0,
      0, -2,
      2, 2]
  },

  count: 3
});


const vert = `
  precision mediump float;
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0, 1);
  }
`;
const lineFrag = `
  precision mediump float;
  uniform vec4 color;

  void main() {
    gl_FragColor = color;
  }
`;
const line = regl({
  vert: vert,
  frag: lineFrag,
  attributes: {
    position: regl.prop('position')
  },
  uniforms: {
    color: regl.prop('color')
  },
  count: regl.prop('count'),
  primitive: 'lines',
  lineWidth: regl.prop('lineWidth'),
  framebuffer: regl.prop('framebuffer')
});


let linePoints;
let i = 0;
const colorScale = chroma.scale(['green', 'white']).domain([0, 256 * 1.5 * 1024]);

const lineLims = regl.limits.lineWidthDims;
const lineScale = scale.scaleLinear().domain([0, 256 * 1024]).range([Math.min(Math.max(lineLims[0], 2), lineLims[1]), Math.min(5, lineLims[1])]);
var size, wm, anim, sum, col;

const waveform = new Uint8Array(1024);

const iterations = 4;
regl.frame(({ time, viewportWidth, viewportHeight }) => {

  regl.clear({
    color: [0, 0, 0, 1],
    // depth: 1
  })



  regl({framebuffer: backbuffer})(() => { regl.clear({ color: [0, 0, 0, 1] });  });
  regl({framebuffer: fbo2 })(() => { regl.clear({ color: [0, 0, 0, 1] });  });
  // regl({framebuffer: fbo1},  () => { regl.clear({ color: [0, 0, 0, 1] });  });
  // regl({framebuffer: fbo2},  () => { regl.clear({ color: [0, 0, 0, 1], depth: 1 });  });

  for (var i = -0.5; i < 0.45; i += 0.05) {
    line({
      framebuffer: backbuffer,
      position: [[-1, i], [1, i]],
      // color: colors,
      lineWidth: 1,
      color: [0.01, 0.01, 0.01, 0.15],
      count: 2
    });
  }
  for (var i = -1; i < 1; i += 0.25 / 8) {
    line({
      framebuffer: backbuffer,
      position: [[i, 0.45], [i, -0.5]],
      // color: colors,
      lineWidth: 1,
      color: [0.01, 0.01, 0.01, 0.15],
      count: 2
    });
  }

  if (analyser) {
    for (var channel = 0; channel < 2; channel++ ) {
      analyser.frequencies(waveform, channel);
      size = waveform.length;
      curveContext.clear();
      // console.log(waveform);
      // if (i === 0) {
      //   console.log(waveform);
      //   i = 1;
      // }

      wm = [];
      sum = 0;
      waveform.forEach((d, i) => {

        wm.push([ channel === 1 ? -i : i, d ]);
        sum += d;
        // wm.push([ -i, d ]);
      });

      // console.log('sum: ' + sum + ' / ' + (256 * 2 * 1024));
      col = colorScale(sum);
      y.range([yRangeScale(sum), -0.5 - yRangeScale(sum)]);
      lineGenerator(wm);

      linePoints = curveContext.getLinePoints();
      // const colors = linePoints.map((point) => {
      //   return colorScale(point[1]).rgb().concat(1.0);
      // })

      line({
        framebuffer: backbuffer,
        position: linePoints,
        // color: colors,
        lineWidth: Math.round(lineScale(sum)),
        color: col.rgb().map((d) => (d / 255)).concat(0.85),//[0.0, 0.8, 0, 0.85],
        count: linePoints.length
      });
      // wm = [];
      // waveform.forEach((d, i) => {
      //   wm.push([ -1 * (i),  (d) ]);
      //   // wm.push([ -i, d ]);
      // });
      //
      // lineGenerator(wm);
      //
      // linePoints = curveContext.getLinePoints();
      // // const colors = linePoints.map((point) => {
      // //   return colorScale(point[1]).rgb().concat(1.0);
      // // })
      //
      //
      // line({
      //   framebuffer: backbuffer,
      //   position: linePoints,
      //   // color: colors,
      //   lineWidth: 2,
      //   color: [0.0, 0.8, 0, 0.85],
      //   count: linePoints.length
      // });

    }
  }

  anim = (Math.sin(time) * 0.5 + 0.5);

  for (var i = 0; i < iterations; i++) {
    // we will approximate a larger blur by using
    // multiple iterations starting with a very wide radius
    var radius = (iterations - i - 1) * 0.55;
    // var radius = 2.2;

    if (i === 0) {
      blur({
        fbo: backbuffer,
        direction: [radius, 0],
        resolution: [viewportWidth, viewportHeight],
        framebuffer: fbo1
      });
    } else if (i % 2 === 0) {
      blur({
        fbo: fbo2,
        direction: [radius, 0],
        resolution: [viewportWidth, viewportHeight],
        framebuffer: fbo1
      });
    } else {
      blur({
        fbo: fbo1,
        direction: [0, radius],
        resolution: [viewportWidth, viewportHeight],
        framebuffer: fbo2
      });
    }
  }


  blend({
    backbuffer: backbuffer,
    blur: fbo2
  });
})


const div = document.createElement('div');
div.style.position = 'absolute';
div.style.bottom = '120px';
div.style.left = '40%';
div.style.width = '20%';

const input = document.createElement('input');
input.type = 'text';
input.style.width = '100%';
input.style.backgroundColor = 'black';
input.style.color = 'white';
input.style.borderBottomColor = 'white';
input.style.borderWidth = 0;
input.style.paddingBottom = '7px';
input.style.borderBottomStyle = 'solid';
input.style.borderBottomWidth = '1px';
input.placeholder = 'Enter SoundCloud track URL'

div.appendChild(input);

const enterDiv = document.createElement('div');
enterDiv.style.position = 'absolute';
enterDiv.style.bottom = '90px';
enterDiv.style.left = '45%';
enterDiv.style.width = '10%';

const submit = document.createElement('input');
submit.type = 'submit';
submit.style.width = '100%';
submit.style.backgroundColor = 'black';
submit.style.color = 'white';
submit.style.borderWidth = 0;
submit.value = 'Go';
submit.style.cursor = 'pointer';

submit.onclick = function () {
  console.log('submit click');
  window.location = '.?song=' + input.value;
  // scb({
  //     client_id: '596b2beb928d826f92ee9807351fa9fd',
  //     song: 'https://soundcloud.com/xeni_kott/jan-jelinek-loop-finding-jazz-records',
  //     dark: false,
  //     getFonts: true
  // }, function(err, src, data, div) {
  //   if (err) throw err
  //   audio.src = src;
  // })

}

enterDiv.appendChild(submit);

document.body.appendChild(div);
document.body.appendChild(enterDiv);
