import { BOARD, PIECE_INFO } from './solver.js';
import { GAME_ICONS } from './game-icons.js';
import { locateBoard, boardPoint } from './detector.js?v=20260920-8';

const STYLE = `
.companionModal{position:fixed;inset:0;background:rgba(3,5,7,.78);backdrop-filter:blur(7px);display:none;place-items:center;z-index:30;padding:20px}
.companionModal.open{display:grid}
.companionBox{width:min(980px,96vw);max-height:92vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#0f141a;border:1px solid #2a333d;border-radius:14px;overflow:hidden;box-shadow:0 30px 100px rgba(0,0,0,.5)}
.companionHead{display:flex;justify-content:space-between;align-items:center;padding:15px 17px;border-bottom:1px solid #27303a}
.companionHead h2{margin:5px 0 0;font-size:18px}
.companionBody{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px;padding:14px;min-height:0;overflow:auto}
.companionBoard{border:1px solid #27303a;border-radius:11px;background:#090c10;padding:12px;display:grid;place-items:center;min-height:430px}
.companionBoard canvas{width:100%;height:auto;max-height:58vh;object-fit:contain}
.companionSide{display:flex;flex-direction:column;gap:10px;min-width:0}
.companionMove{border:1px solid #343d47;background:#151b22;border-radius:11px;padding:13px}
.companionMove .label{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#8e969f;font-weight:800}
.companionMove .pair{display:flex;align-items:center;gap:7px;margin-top:10px;font-weight:800;font-size:14px;flex-wrap:wrap}
.companionMove img{width:30px;height:30px;object-fit:contain}
.companionMove .plus{color:#747d87}
.companionCoords{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8e969f;margin-top:8px}
.companionInstruction{font-size:12px;line-height:1.45;color:#c9c8c1}
.companionStatus{border:1px solid #27303a;background:#0c1117;border-radius:9px;padding:9px 10px;color:#aeb5bd;font-size:11px;line-height:1.4}
.companionStatus.ok{color:#5eead4;border-color:rgba(94,234,212,.28)}
.companionStatus.warn{color:#f4c95d;border-color:rgba(244,201,93,.28)}
.companionStatus.error{color:#f87171;border-color:rgba(248,113,113,.28)}
.companionActions{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.companionActions .wide{grid-column:1/-1}
.companionCapture{border:1px solid #27303a;border-radius:10px;background:#090c10;padding:9px}
.companionCapture video{display:block;width:100%;border-radius:7px;aspect-ratio:16/9;object-fit:contain;background:#050709}
.companionCapture small{display:block;color:#747d87;font-size:9px;margin-top:6px;line-height:1.35}
.companionFoot{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid #27303a}
.companionFoot .hint{color:#6f7882;font-size:10px;line-height:1.35}
@media(max-width:780px){.companionBody{grid-template-columns:1fr}.companionSide{order:-1}.companionBoard{min-height:300px}.companionBox{max-height:96vh}}
`;

const root = window.__SIGMAR__;
if (!root) {
  window.addEventListener('load', () => window.__SIGMAR__ && init(window.__SIGMAR__), { once:true });
} else {
  init(root);
}

function init(api) {
  if (document.getElementById('companionOpenBtn')) return;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const openButton = document.createElement('button');
  openButton.id = 'companionOpenBtn';
  openButton.className = 'button';
  openButton.textContent = 'Companion mode';
  document.querySelector('.topActions')?.prepend(openButton);

  const modal = document.createElement('div');
  modal.className = 'companionModal';
  modal.innerHTML = `
    <div class="companionBox">
      <div class="companionHead">
        <div><div class="sectionKicker">COMPANION MODE</div><h2>Play with the solver beside the game</h2></div>
        <button class="iconButton" data-close aria-label="Close">×</button>
      </div>
      <div class="companionBody">
        <div class="companionBoard"><canvas data-board width="700" height="700"></canvas></div>
        <div class="companionSide">
          <div class="companionMove">
            <div class="label" data-step>Load a solution first</div>
            <div class="pair" data-pair></div>
            <div class="companionCoords" data-coords></div>
          </div>
          <div class="companionInstruction" data-instruction>
            Companion mode does not trust screenshot recognition. It uses the board currently in the solver and guides you through the moves while you play them in Opus Magnum.
          </div>
          <div class="companionStatus" data-status>Ready.</div>
          <div class="companionActions">
            <button class="button primary wide" data-solve>Solve current board</button>
            <button class="button" data-done>Move completed</button>
            <button class="button" data-back>Previous move</button>
            <button class="button" data-watch>Watch game window</button>
            <button class="button" data-stop-watch disabled>Stop watching</button>
          </div>
          <div class="companionCapture" data-capture hidden>
            <video data-video autoplay muted playsinline></video>
            <small>Select the Opus Magnum window when the browser asks what to share. The companion only watches pixels locally and uses the expected move's two cells to detect that the move was made.</small>
          </div>
        </div>
      </div>
      <div class="companionFoot">
        <div class="hint">The companion never clicks the game. You stay in control.</div>
        <div><button class="button" data-close>Close companion</button></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const boardCanvas = modal.querySelector('[data-board]');
  const boardCtx = boardCanvas.getContext('2d');
  const stepEl = modal.querySelector('[data-step]');
  const pairEl = modal.querySelector('[data-pair]');
  const coordsEl = modal.querySelector('[data-coords]');
  const statusEl = modal.querySelector('[data-status]');
  const solveEl = modal.querySelector('[data-solve]');
  const doneEl = modal.querySelector('[data-done]');
  const backEl = modal.querySelector('[data-back]');
  const watchEl = modal.querySelector('[data-watch]');
  const stopWatchEl = modal.querySelector('[data-stop-watch]');
  const captureEl = modal.querySelector('[data-capture]');
  const videoEl = modal.querySelector('[data-video]');

  let captureStream = null;
  let captureCanvas = null;
  let captureCtx = null;
  let captureLocated = null;
  let captureBaseline = null;
  let watchTimer = 0;
  let watchBusy = false;
  let stableHits = 0;

  function occupiedCount() {
    return Array.from(api.state.board).filter((v) => v >= 0).length;
  }

  function currentStep() {
    const solution = api.state.solution;
    if (!solution) return null;
    const index = Math.max(0, Math.min(api.state.solutionIndex, solution.steps.length));
    if (index >= solution.steps.length) return null;
    return solution.steps[index];
  }

  function setStatus(text, tone='') {
    statusEl.textContent = text;
    statusEl.className = 'companionStatus' + (tone ? ' ' + tone : '');
  }

  function drawCompanionBoard() {
    const w = boardCanvas.width;
    const h = boardCanvas.height;
    boardCtx.clearRect(0,0,w,h);
    boardCtx.fillStyle = '#090c10';
    boardCtx.fillRect(0,0,w,h);

    const size = Math.min(w / (16 * Math.sqrt(3)), h / 17) * 0.82;
    const center = { x:w/2, y:h/2 };
    const solution = api.state.solution;
    const display = solution?.initialBoard
      ? new Int8Array(solution.initialBoard)
      : new Int8Array(api.state.board);
    if (solution) {
      const applied = Math.max(0, Math.min(api.state.solutionIndex, solution.steps.length));
      for (let i=0;i<applied;i++) {
        const s=solution.steps[i];
        if (s?.a >= 0) display[s.a] = -1;
        if (s?.b >= 0) display[s.b] = -1;
      }
    }
    const step = currentStep();

    for (const cell of BOARD.cells) {
      const p = boardPoint(center,size,cell);
      const occupied = display[cell.index] >= 0;
      const pts=[];
      for(let i=0;i<6;i++){
        const a=Math.PI/2+i*Math.PI/3;
        pts.push([p.x+(size-2)*Math.cos(a),p.y+(size-2)*Math.sin(a)]);
      }
      boardCtx.beginPath();
      boardCtx.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++) boardCtx.lineTo(pts[i][0],pts[i][1]);
      boardCtx.closePath();
      boardCtx.fillStyle=occupied?'#c5b895':'#252b33';
      boardCtx.globalAlpha=occupied?1:.65;
      boardCtx.fill();
      boardCtx.globalAlpha=1;
      boardCtx.strokeStyle='#5a5f66';
      boardCtx.lineWidth=1.2;
      boardCtx.stroke();

      if (occupied) {
        const type=display[cell.index];
        const img=GAME_ICONS[type] ? getImage(GAME_ICONS[type]) : null;
        const r=size*.56;
        if(img?.complete && img.naturalWidth) boardCtx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
        else {
          boardCtx.fillStyle=PIECE_INFO[type]?.color || '#888';
          boardCtx.beginPath(); boardCtx.arc(p.x,p.y,r,0,Math.PI*2); boardCtx.fill();
        }
      }
      if(step && (step.a===cell.index || step.b===cell.index)) {
        boardCtx.beginPath();
        boardCtx.strokeStyle='#f4c95d';
        boardCtx.lineWidth=5;
        boardCtx.arc(p.x,p.y,size*.64,0,Math.PI*2);
        boardCtx.stroke();
      }
    }
  }

  const imageCache=new Map();
  function getImage(src) {
    if(imageCache.has(src)) return imageCache.get(src);
    const img=new Image();
    img.src=src;
    imageCache.set(src,img);
    return img;
  }

  function render() {
    const solution=api.state.solution;
    const step=currentStep();
    if(!solution) {
      stepEl.textContent='No solution loaded';
      pairEl.innerHTML='';
      coordsEl.textContent='';
      solveEl.disabled=occupiedCount()===0;
      doneEl.disabled=true;
      backEl.disabled=true;
      drawCompanionBoard();
      return;
    }
    const index=Math.max(0,Math.min(api.state.solutionIndex,solution.steps.length));
    if(!step) {
      stepEl.textContent='Complete';
      pairEl.innerHTML='<span>Board cleared</span>';
      coordsEl.textContent=`${solution.steps.length} moves completed`;
      solveEl.disabled=false;
      doneEl.disabled=true;
      backEl.disabled=index<=0;
      setStatus('Solution complete. Clear the board in the game.', 'ok');
      drawCompanionBoard();
      return;
    }
    stepEl.textContent=`Move ${index+1} of ${solution.steps.length}`;
    const initial=solution.initialBoard || api.state.board;
    const aType=initial[step.a];
    const bType=step.b>=0 ? initial[step.b] : -1;
    const aName=PIECE_INFO[aType]?.name || 'Marble';
    const bName=step.b>=0 ? (PIECE_INFO[bType]?.name || 'Marble') : '';
    pairEl.innerHTML=`<img src="${GAME_ICONS[aType]}" alt=""><span>${aName}</span>${step.b>=0 ? `<span class="plus">+</span><img src="${GAME_ICONS[bType]}" alt=""><span>${bName}</span>` : ''}`;
    const ac=BOARD.cells[step.a];
    const bc=step.b>=0?BOARD.cells[step.b]:null;
    coordsEl.textContent=`[ ${ac.q}, ${ac.r} ]${bc ? `  +  [ ${bc.q}, ${bc.r} ]` : ''}`;
    solveEl.disabled=false;
    doneEl.disabled=false;
    backEl.disabled=index<=0;
    if(!captureStream) setStatus('Play the highlighted move in Opus Magnum, then confirm it here.', '');
    drawCompanionBoard();
  }

  async function solveCurrent() {
    if(!occupiedCount()) return;
    if(api.state.detectedDetails) {
      const review=Object.values(api.state.detectedDetails).filter(d=>d?.type>=0 && d.needsReview);
      if(review.length) {
        setStatus(`${review.length} cells are still marked for review. Correct them in the main board first.`, 'warn');
        return;
      }
    }
    setStatus('Solving current board…','warn');
    solveEl.disabled=true;
    const worker=new Worker('./solver.worker.js',{type:'module'});
    const id=Date.now();
    try {
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{worker.terminate();reject(new Error('Solver timed out after 60 seconds.'));},60000);
        worker.onmessage=(event)=>{
          if(event.data?.id!==id)return;
          clearTimeout(timer);
          worker.terminate();
          event.data.ok?resolve(event.data.result):reject(new Error(event.data.error||'Solver failed.'));
        };
        worker.postMessage({id,board:Array.from(api.state.board),timeLimitMs:55000});
      });
      if(!result.solved) {
        api.state.solution=null;
        api.state.solutionIndex=-1;
        setStatus(`No solution found after ${result.stats.exploredStates.toLocaleString()} dead states.`,'error');
      } else {
        api.state.solution={...result,initialBoard:new Int8Array(api.state.board)};
        api.state.solutionIndex=0;
        api.state.editing=false;
        window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
        setStatus(`Solution ready: ${result.steps.length} moves.`,'ok');
      }
    } catch(error) {
      setStatus(error.message,'error');
    } finally {
      solveEl.disabled=false;
      window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
      render();
    }
  }

  function markDone() {
    const solution=api.state.solution;
    if(!solution) return;
    if(api.state.solutionIndex < solution.steps.length) {
      api.state.solutionIndex += 1;
      window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
      render();
      resetWatchBaseline();
    }
  }

  function goBack() {
    if(!api.state.solution) return;
    api.state.solutionIndex=Math.max(0,api.state.solutionIndex-1);
    window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
    render();
    resetWatchBaseline();
  }

  function resetWatchBaseline() {
    stableHits=0;
    if(captureStream && captureCanvas) captureBaseline=grabFrame();
  }

  function grabFrame() {
    if(!captureStream || !captureCanvas || videoEl.readyState < 2) return null;
    captureCtx.drawImage(videoEl,0,0,captureCanvas.width,captureCanvas.height);
    return captureCtx.getImageData(0,0,captureCanvas.width,captureCanvas.height);
  }

  function patchDifference(a,b,cx,cy,r) {
    if(!a||!b) return 0;
    const x0=Math.max(0,Math.floor(cx-r)), x1=Math.min(a.width-1,Math.ceil(cx+r));
    const y0=Math.max(0,Math.floor(cy-r)), y1=Math.min(a.height-1,Math.ceil(cy+r));
    let sum=0,n=0;
    const rr=r*r;
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const dx=x-cx,dy=y-cy;
      if(dx*dx+dy*dy>rr) continue;
      const i=(y*a.width+x)*4;
      sum += Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2]);
      n++;
    }
    return n ? sum/(n*3) : 0;
  }

  function expectedChanged(frame, step) {
    if(!captureLocated || !captureBaseline || !frame) return false;
    const a=BOARD.cells[step.a];
    const pa=boardPoint(captureLocated.center,captureLocated.hexSize,a);
    const da=patchDifference(captureBaseline,frame,pa.x,pa.y,captureLocated.hexSize*.34);
    if(step.b<0) return da>10;
    const b=BOARD.cells[step.b];
    const pb=boardPoint(captureLocated.center,captureLocated.hexSize,b);
    const db=patchDifference(captureBaseline,frame,pb.x,pb.y,captureLocated.hexSize*.34);
    return da>10 && db>10;
  }

  async function startWatch() {
    if(!navigator.mediaDevices?.getDisplayMedia) {
      setStatus('This browser does not expose screen capture. Use Move completed instead.','error');
      return;
    }
    if(!api.state.solution || !currentStep()) {
      setStatus('Solve the board before starting the watcher.','warn');
      return;
    }
    try {
      captureStream=await navigator.mediaDevices.getDisplayMedia({
        video:{frameRate:{ideal:6,max:10}},
        audio:false,
        selfBrowserSurface:'exclude',
        surfaceSwitching:'include',
      });
      videoEl.srcObject=captureStream;
      await videoEl.play();
      captureCanvas=document.createElement('canvas');
      captureCanvas.width=videoEl.videoWidth;
      captureCanvas.height=videoEl.videoHeight;
      captureCtx=captureCanvas.getContext('2d',{willReadFrequently:true});
      const first=grabFrame();
      captureLocated=first ? locateBoard(first) : null;
      if(!captureLocated) throw new Error('I could not find the Sigmar board in the shared window. Select the Opus Magnum game window, not this solver.');
      captureBaseline=first;
      captureEl.hidden=false;
      watchEl.disabled=true;
      stopWatchEl.disabled=false;
      setStatus('Watching the game. Make the highlighted move there.','ok');
      const track=captureStream.getVideoTracks()[0];
      track.addEventListener('ended',stopWatch,{once:true});
      watchTimer=window.setInterval(watchTick,220);
      render();
    } catch(error) {
      stopWatch();
      setStatus(error.message || 'Screen capture was cancelled.','error');
    }
  }

  function stopWatch() {
    if(watchTimer){clearInterval(watchTimer);watchTimer=0;}
    if(captureStream){captureStream.getTracks().forEach(t=>t.stop());captureStream=null;}
    videoEl.srcObject=null;
    captureLocated=null;
    captureBaseline=null;
    captureCanvas=null;
    captureCtx=null;
    watchBusy=false;
    stableHits=0;
    captureEl.hidden=true;
    watchEl.disabled=false;
    stopWatchEl.disabled=true;
    if(modal.classList.contains('open')) render();
  }

  function watchTick() {
    if(watchBusy || !captureStream || !currentStep()) return;
    watchBusy=true;
    try {
      const frame=grabFrame();
      const step=currentStep();
      if(expectedChanged(frame,step)) stableHits++; else stableHits=0;
      if(stableHits>=2) {
        stableHits=0;
        api.state.solutionIndex += 1;
        window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
        captureBaseline=frame;
        render();
      }
    } finally {
      watchBusy=false;
    }
  }

  function close() {
    stopWatch();
    modal.classList.remove('open');
    if(api.state.solution) {
      api.state.editing=false;
      window.dispatchEvent(new CustomEvent('sigmar:companion:update'));
    }
  }

  openButton.addEventListener('click',()=>{
    modal.classList.add('open');
    render();
  });
  modal.querySelectorAll('[data-close]').forEach((b)=>b.addEventListener('click',close));
  solveEl.addEventListener('click',solveCurrent);
  doneEl.addEventListener('click',markDone);
  backEl.addEventListener('click',goBack);
  watchEl.addEventListener('click',startWatch);
  stopWatchEl.addEventListener('click',stopWatch);
  window.addEventListener('sigmar:companion:update',()=>{ if(modal.classList.contains('open')) render(); });
  window.addEventListener('beforeunload',stopWatch);
}
