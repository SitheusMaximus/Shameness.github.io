import assert from 'node:assert/strict';
import { BOARD, PIECES } from '../solver.js';
import { locateBoard, classifyBoard, boardPoint } from '../detector.js';

const width=920,height=760;
const pixels=new Uint8ClampedArray(width*height*4);
function hexColor(hex){const v=hex.slice(1);return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16),255];}
function setPixel(x,y,rgba){if(x<0||y<0||x>=width||y>=height)return;const i=(y*width+x)*4;pixels[i]=rgba[0];pixels[i+1]=rgba[1];pixels[i+2]=rgba[2];pixels[i+3]=rgba[3];}
function fillHex(cx,cy,size,rgba){
  const minX=Math.floor(cx-size),maxX=Math.ceil(cx+size),minY=Math.floor(cy-size),maxY=Math.ceil(cy+size);
  const pts=[];for(let i=0;i<6;i++){const a=Math.PI/2+i*Math.PI/3;pts.push([cx+(size-2)*Math.cos(a),cy+(size-2)*Math.sin(a)]);}
  for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++){
    let inside=true;
    for(let i=0;i<6;i++){const a=pts[i],b=pts[(i+1)%6];if((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])<0){inside=false;break;}}
    if(inside)setPixel(x,y,rgba);
  }
}
const bg=hexColor('#161a20');for(let y=0;y<height;y++)for(let x=0;x<width;x++)setPixel(x,y,bg);
const center={x:460,y:380}, size=24;
const tile=hexColor('#c9bea2');
for(const cell of BOARD.cells){const p=boardPoint(center,size,cell);fillHex(p.x,p.y,size,tile);}
const pal={
  [PIECES.AIR]:'#73c2fb',[PIECES.FIRE]:'#fc6600',[PIECES.WATER]:'#4f97a3',[PIECES.EARTH]:'#4cbb17',
  [PIECES.LEAD]:'#4682b4',[PIECES.TIN]:'#a9ba9d',[PIECES.IRON]:'#702963',[PIECES.COPPER]:'#ca3433',
  [PIECES.SILVER]:'#696980',[PIECES.GOLD]:'#f9a602',[PIECES.MORS]:'#222021',[PIECES.VITAE]:'#fdb9c8'
};
const placements=[[0,PIECES.AIR],[1,PIECES.AIR],[2,PIECES.FIRE],[4,PIECES.WATER],[7,PIECES.EARTH],[10,PIECES.LEAD],[13,PIECES.TIN],[16,PIECES.IRON],[20,PIECES.COPPER],[24,PIECES.SILVER],[28,PIECES.GOLD],[32,PIECES.MORS],[36,PIECES.VITAE]];
for(const [idx,type] of placements){const p=boardPoint(center,size,BOARD.cells[idx]);fillHex(p.x,p.y,size*.56,hexColor(pal[type]));}
const imageData={width,height,data:pixels};
const located=locateBoard(imageData);
assert.ok(located,'board located');
assert.ok(Math.abs(located.center.x-center.x)<12,`center x ${located.center.x}`);
assert.ok(Math.abs(located.center.y-center.y)<12,`center y ${located.center.y}`);
assert.ok(Math.abs(located.hexSize-size)/size<0.12,`hex size ${located.hexSize}`);

// Classification is tested against the exact known geometry. Real screenshot
// imports pass through locateBoard first, while the UI exposes the detected
// board for human review when an image is unusual.
const detected=classifyBoard(imageData,{center,hexSize:size});
const found=placements.filter(([idx,type])=>detected.cells[idx]===type).length;
assert.equal(found,placements.length,`found ${found}/${placements.length}`);
assert.equal(detected.ambiguous,0,'synthetic palette should not create pale ambiguity');
console.log(`PASS: screenshot locator + classifier tests; ${found}/${placements.length} synthetic marbles classified`);
